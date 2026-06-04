import * as drive from './services/google-drive.js';
import { logActivity } from './services/logger.js';
import { refreshTokenIfNeeded } from './services/token-manager.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';

async function getAuthHeaders(env, db, accountId) {
  let account = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(accountId).first();
  if (!account) throw new Error('Account not found');
  account = await refreshTokenIfNeeded(env, db, account);
  return { Authorization: `Bearer ${account.access_token}` };
}

async function listAllFilesUnlimited(env, db, accountId, folderId) {
  const headers = await getAuthHeaders(env, db, accountId);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType)');

  const allFiles = [];
  let pageToken = null;

  do {
    let url = `${DRIVE_API}/files?q=${q}&fields=${fields}&pageSize=1000`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`List files failed: ${res.status}`);

    const data = await res.json();
    if (data.files && data.files.length > 0) {
      allFiles.push(...data.files);
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  console.log(`Queue: Listed ${allFiles.length} items in folder ${folderId}`);
  return allFiles;
}

async function resolveFileOwnerAccountId(env, db, fileId) {
  const owner = await db.prepare('SELECT account_id FROM file_owners WHERE file_id = ?').bind(fileId).first();
  if (owner) return owner.account_id;

  const primaryRow = await db.prepare('SELECT id FROM accounts WHERE is_primary = 1').first();
  const primaryId = primaryRow?.id;
  if (!primaryId) return null;

  const ownerEmail = await drive.getFileOwnerEmail(env, db, primaryId, fileId);
  if (ownerEmail) {
    const matchedAccount = await db.prepare('SELECT id FROM accounts WHERE email = ?').bind(ownerEmail).first();
    if (matchedAccount) {
      await db.prepare('INSERT OR REPLACE INTO file_owners (file_id, account_id) VALUES (?, ?)').bind(fileId, matchedAccount.id).run();
      return matchedAccount.id;
    }
  }

  return primaryId;
}

async function deleteOneFile(env, db, fileId, accountId) {
  await drive.deleteFile(env, db, accountId, fileId);
  await db.prepare('DELETE FROM file_owners WHERE file_id = ?').bind(fileId).run();
}

async function scanFolderTreeUnlimited(env, db, rootFolderId, rootAccountId, depth = 0) {
  try {
    const children = await listAllFilesUnlimited(env, db, rootAccountId, rootFolderId);
    const scannedFiles = [];
    const scannedFolders = [];

    const childrenWithOwners = [];
    for (const child of children) {
      const childAccountId = await resolveFileOwnerAccountId(env, db, child.id);
      if (!childAccountId) {
        throw new Error('No primary account set');
      }
      childrenWithOwners.push({ ...child, accountId: childAccountId });
    }

    for (const child of childrenWithOwners) {
      if (child.mimeType !== FOLDER_MIME) {
        scannedFiles.push({
          id: child.id,
          name: child.name,
          accountId: child.accountId
        });
      }
    }

    for (const child of childrenWithOwners) {
      if (child.mimeType === FOLDER_MIME) {
        scannedFolders.push({
          id: child.id,
          name: child.name,
          depth: depth + 1,
          accountId: child.accountId
        });

        const nested = await scanFolderTreeUnlimited(env, db, child.id, child.accountId, depth + 1);
        scannedFiles.push(...nested.files);
        scannedFolders.push(...nested.folders);
      }
    }

    return { files: scannedFiles, folders: scannedFolders };
  } catch (err) {
    throw err;
  }
}

async function processDeleteJob(env, db, job) {
  const { folderId, accountId, userId, username, folderName } = job;
  const jobId = `delete_${folderId}_${Date.now()}`;

  console.log(`Queue: Starting delete job for folder ${folderId}`);

  // Create job record
  await db.prepare(
    'INSERT INTO queue_jobs (job_id, folder_id, folder_name, user_id, username, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(jobId, folderId, folderName, userId, username, 'scanning').run();

  try {
    // Scan entire tree without limits
    const scanned = await scanFolderTreeUnlimited(env, db, folderId, accountId);

    console.log(`Queue: Scanned ${scanned.files.length} files, ${scanned.folders.length} folders`);

    const totalItems = scanned.files.length + scanned.folders.length + 1; // +1 for root folder

    // Update job with total items
    await db.prepare(
      'UPDATE queue_jobs SET status = ?, total_items = ?, started_at = datetime(?) WHERE job_id = ?'
    ).bind('processing', totalItems, 'now', jobId).run();

    // Sort folders deepest first
    const sortedFolders = scanned.folders.sort((a, b) => b.depth - a.depth);

    let deletedFiles = 0;
    let deletedFolders = 0;
    const errors = [];

    // Delete files in batches of 10
    for (let i = 0; i < scanned.files.length; i += 10) {
      const batch = scanned.files.slice(i, i + 10);
      await Promise.allSettled(batch.map(async (file) => {
        try {
          await deleteOneFile(env, db, file.id, file.accountId);
          deletedFiles++;
        } catch (err) {
          console.error(`Queue: Failed to delete file ${file.id} (${file.name}):`, err.message);
          errors.push({ id: file.id, name: file.name, error: err.message });
        }
      }));

      await db.prepare(
        'UPDATE queue_jobs SET processed_items = ?, failed_items = ?, error_details = ? WHERE job_id = ?'
      ).bind(deletedFiles + deletedFolders, errors.length, JSON.stringify(errors.slice(0, 10)), jobId).run();

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Delete folders in batches of 10
    for (let i = 0; i < sortedFolders.length; i += 10) {
      const batch = sortedFolders.slice(i, i + 10);
      await Promise.allSettled(batch.map(async (folder) => {
        try {
          await deleteOneFile(env, db, folder.id, folder.accountId);
          deletedFolders++;
        } catch (err) {
          console.error(`Queue: Failed to delete folder ${folder.id} (${folder.name}):`, err.message);
          errors.push({ id: folder.id, name: folder.name, error: err.message });
        }
      }));

      await db.prepare(
        'UPDATE queue_jobs SET processed_items = ?, failed_items = ?, error_details = ? WHERE job_id = ?'
      ).bind(deletedFiles + deletedFolders, errors.length, JSON.stringify(errors.slice(0, 10)), jobId).run();

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Delete root folder
    try {
      await deleteOneFile(env, db, folderId, accountId);
      deletedFolders++;
    } catch (err) {
      errors.push({ id: folderId, error: err.message });
    }

    console.log(`Queue: Completed - ${deletedFiles} files, ${deletedFolders} folders deleted, ${errors.length} failed`);

    // Log first few errors for debugging
    if (errors.length > 0) {
      console.error('Queue: First 5 errors:', errors.slice(0, 5));
    }

    // Update job status to completed
    await db.prepare(
      'UPDATE queue_jobs SET status = ?, processed_items = ?, failed_items = ?, error_details = ?, completed_at = datetime(?) WHERE job_id = ?'
    ).bind('completed', deletedFiles + deletedFolders, errors.length, JSON.stringify(errors.slice(0, 10)), 'now', jobId).run();

    // Log activity
    await logActivity(db, userId, username, 'delete_async', `${folderName || folderId} (${deletedFiles} files, ${deletedFolders} folders, ${errors.length} failed)`);

    return { success: errors.length === 0, deletedFiles, deletedFolders, failed: errors.length, errors: errors.slice(0, 10) };
  } catch (err) {
    console.error(`Queue: Delete job failed - ${err.message}`);

    // Update job status to failed
    await db.prepare(
      'UPDATE queue_jobs SET status = ?, error_details = ?, completed_at = datetime(?) WHERE job_id = ?'
    ).bind('failed', JSON.stringify({ error: err.message }), 'now', jobId).run();

    throw err;
  }
}

export default {
  async queue(batch, env) {
    const db = env.DB;

    for (const message of batch.messages) {
      try {
        await processDeleteJob(env, db, message.body);
        message.ack();
      } catch (err) {
        console.error('Queue consumer error:', err);
        message.retry();
      }
    }
  }
};
