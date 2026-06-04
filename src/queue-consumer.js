import * as drive from './services/google-drive.js';
import { logActivity } from './services/logger.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';

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
    const children = await drive.listAllFiles(env, db, rootAccountId, rootFolderId);
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

  console.log(`Queue: Starting delete job for folder ${folderId}`);

  try {
    // Scan entire tree without limits
    const scanned = await scanFolderTreeUnlimited(env, db, folderId, accountId);

    console.log(`Queue: Scanned ${scanned.files.length} files, ${scanned.folders.length} folders`);

    // Sort folders deepest first
    const sortedFolders = scanned.folders.sort((a, b) => b.depth - a.depth);

    let deletedFiles = 0;
    let deletedFolders = 0;
    const errors = [];

    // Delete files in batches of 10
    for (let i = 0; i < scanned.files.length; i += 10) {
      const batch = scanned.files.slice(i, i + 10);
      for (const file of batch) {
        try {
          await deleteOneFile(env, db, file.id, file.accountId);
          deletedFiles++;
        } catch (err) {
          errors.push({ id: file.id, name: file.name, error: err.message });
        }
      }
      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Delete folders in batches of 10
    for (let i = 0; i < sortedFolders.length; i += 10) {
      const batch = sortedFolders.slice(i, i + 10);
      for (const folder of batch) {
        try {
          await deleteOneFile(env, db, folder.id, folder.accountId);
          deletedFolders++;
        } catch (err) {
          errors.push({ id: folder.id, name: folder.name, error: err.message });
        }
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Delete root folder
    try {
      await deleteOneFile(env, db, folderId, accountId);
      deletedFolders++;
    } catch (err) {
      errors.push({ id: folderId, error: err.message });
    }

    console.log(`Queue: Completed - ${deletedFiles} files, ${deletedFolders} folders deleted, ${errors.length} failed`);

    // Log activity
    await logActivity(db, userId, username, 'delete_async', `${folderName || folderId} (${deletedFiles} files, ${deletedFolders} folders, ${errors.length} failed)`);

    return { success: errors.length === 0, deletedFiles, deletedFolders, failed: errors.length, errors: errors.slice(0, 10) };
  } catch (err) {
    console.error(`Queue: Delete job failed - ${err.message}`);
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
