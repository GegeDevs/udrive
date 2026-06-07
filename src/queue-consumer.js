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

async function processDeleteJob(env, db, job) {
  const { folderId, folderName, accountId, userId, username, files, folders } = job;
  const jobId = `delete_${folderId}_${Date.now()}`;

  console.log(`Queue: Starting delete job for folder ${folderId}`);

  // Create job record
  await db.prepare(
    'INSERT INTO queue_jobs (job_id, folder_id, folder_name, user_id, username, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(jobId, folderId, folderName, userId, username, 'processing').run();

  try {
    // Use pre-scanned items from job (no need to scan again)
    const scanned = { files: files || [], folders: folders || [] };

    console.log(`Queue: Processing ${scanned.files.length} files, ${scanned.folders.length} folders (pre-scanned)`);

    const totalItems = scanned.files.length + scanned.folders.length + 1; // +1 for root folder

    // Update job with total items
    await db.prepare(
      'UPDATE queue_jobs SET total_items = ?, started_at = datetime(?) WHERE job_id = ?'
    ).bind(totalItems, 'now', jobId).run();

    // Sort folders deepest first
    const sortedFolders = scanned.folders.sort((a, b) => b.depth - a.depth);

    let deletedFiles = 0;
    let deletedFolders = 0;
    const errors = [];

    // Delete files one by one (sequential to avoid subrequest limit)
    for (let i = 0; i < scanned.files.length; i++) {
      const file = scanned.files[i];
      try {
        await deleteOneFile(env, db, file.id, file.accountId);
        deletedFiles++;
      } catch (err) {
        console.error(`Queue: Failed to delete file ${file.id} (${file.name}):`, err.message);
        errors.push({ id: file.id, name: file.name, error: err.message });
      }

      // Update progress every 10 files
      if (i % 10 === 0 || i === scanned.files.length - 1) {
        await db.prepare(
          'UPDATE queue_jobs SET processed_items = ?, failed_items = ?, error_details = ? WHERE job_id = ?'
        ).bind(deletedFiles + deletedFolders, errors.length, JSON.stringify(errors.slice(0, 10)), jobId).run();
      }
    }

    // Delete folders one by one (sequential to avoid subrequest limit)
    for (let i = 0; i < sortedFolders.length; i++) {
      const folder = sortedFolders[i];
      try {
        await deleteOneFile(env, db, folder.id, folder.accountId);
        deletedFolders++;
      } catch (err) {
        console.error(`Queue: Failed to delete folder ${folder.id} (${folder.name}):`, err.message);
        errors.push({ id: folder.id, name: folder.name, error: err.message });
      }

      // Update progress every 10 folders
      if (i % 10 === 0 || i === sortedFolders.length - 1) {
        await db.prepare(
          'UPDATE queue_jobs SET processed_items = ?, failed_items = ?, error_details = ? WHERE job_id = ?'
        ).bind(deletedFiles + deletedFolders, errors.length, JSON.stringify(errors.slice(0, 10)), jobId).run();
      }
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
