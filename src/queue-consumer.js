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

async function scanFolderInQueue(env, db, folderId, accountId, depth = 0, maxDepth = 10, totalScanned = { count: 0 }, maxItems = 100) {
  const allFiles = [];
  const allFolders = [];
  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  if (depth > maxDepth) {
    console.log(`Queue: Max depth (${maxDepth}) reached for folder ${folderId}`);
    return { files: allFiles, folders: allFolders };
  }

  if (totalScanned.count >= maxItems) {
    console.log(`Queue: Max items (${maxItems}) reached, stopping scan`);
    return { files: allFiles, folders: allFolders };
  }

  try {
    // Scan current folder
    const children = await drive.listFiles(env, db, accountId, folderId); // Single page only

    for (const child of children) {
      if (totalScanned.count >= maxItems) break;

      const childAccountId = await resolveFileOwnerAccountId(env, db, child.id);
      const childAccount = childAccountId || accountId;

      if (child.mimeType === FOLDER_MIME) {
        allFolders.push({
          id: child.id,
          name: child.name,
          depth: depth + 1,
          accountId: childAccount
        });

        // Recursively scan subfolder
        const subScan = await scanFolderInQueue(env, db, child.id, childAccount, depth + 1, maxDepth, totalScanned, maxItems);
        allFiles.push(...subScan.files);
        allFolders.push(...subScan.folders);
      } else {
        allFiles.push({
          id: child.id,
          name: child.name,
          accountId: childAccount
        });
      }

      totalScanned.count++;
    }

    return { files: allFiles, folders: allFolders };
  } catch (err) {
    console.error(`Queue: Scan error for folder ${folderId}:`, err.message);
    throw err;
  }
}

async function processDeleteJob(env, db, job) {
  const { folderId, folderName, accountId, userId, username, files, folders, skipScan } = job;
  const jobId = `delete_${folderId}_${Date.now()}`;

  console.log(`Queue: Starting delete job for folder ${folderId}${skipScan ? ' (will scan in queue)' : ' (pre-scanned)'}`);

  // Debug: Check if env variables exist
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.error('Queue: Missing Google OAuth credentials in environment');
    console.error('GOOGLE_CLIENT_ID:', env.GOOGLE_CLIENT_ID ? 'exists' : 'MISSING');
    console.error('GOOGLE_CLIENT_SECRET:', env.GOOGLE_CLIENT_SECRET ? 'exists' : 'MISSING');
  }

  let remainingFiles = files || [];
  let remainingFolders = folders || [];

  // If skipScan=true, we need to scan the folder here in queue consumer
  if (skipScan || (remainingFiles.length === 0 && remainingFolders.length === 0)) {
    console.log(`Queue: Scanning folder ${folderId} in queue consumer...`);
    try {
      const scanned = await scanFolderInQueue(env, db, folderId, accountId);
      remainingFiles = scanned.files;
      remainingFolders = scanned.folders;
      console.log(`Queue: Scanned ${remainingFiles.length} files, ${remainingFolders.length} folders`);
    } catch (err) {
      console.error(`Queue: Scan failed - ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // Chunk size: process max 15 items per invocation to stay under subrequest limit
  const CHUNK_SIZE = 15;

  // If more than 15 files, process chunk and requeue remaining FILES ONLY (no folders yet)
  if (remainingFiles.length > CHUNK_SIZE) {
    const chunk = remainingFiles.slice(0, CHUNK_SIZE);
    const remaining = remainingFiles.slice(CHUNK_SIZE);

    console.log(`Queue: Processing chunk of ${chunk.length} files, ${remaining.length} remaining`);

    let deletedFiles = 0;
    const errors = [];

    for (let i = 0; i < chunk.length; i++) {
      const file = chunk[i];
      try {
        await deleteOneFile(env, db, file.id, file.accountId);
        deletedFiles++;
      } catch (err) {
        console.error(`Queue: Failed to delete file ${file.id} (${file.name}):`, err.message);
        errors.push({ id: file.id, name: file.name, error: err.message });
      }

      // Small delay every 3 files
      if ((i + 1) % 3 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    console.log(`Queue: Chunk completed - ${deletedFiles} files deleted, ${errors.length} failed. Requeuing remaining ${remaining.length} files (folders will be processed after all files done)`);

    // Requeue remaining files ONLY - keep folders for the final invocation
    await env.DELETE_QUEUE.send({
      folderId,
      folderName,
      accountId,
      userId,
      username,
      files: remaining,
      folders: remainingFolders  // Pass folders along but they won't be processed until files array is empty
    });

    return { success: true, deletedFiles, deletedFolders: 0, failed: errors.length, chunked: true };
  }

  // If we reach here, remainingFiles.length <= CHUNK_SIZE
  // Only process folders if files array is completely empty
  if (remainingFiles.length > 0) {
    console.log(`Queue: Processing final ${remainingFiles.length} files before folders`);

    let deletedFiles = 0;
    const errors = [];

    for (let i = 0; i < remainingFiles.length; i++) {
      const file = remainingFiles[i];
      try {
        await deleteOneFile(env, db, file.id, file.accountId);
        deletedFiles++;
      } catch (err) {
        console.error(`Queue: Failed to delete file ${file.id} (${file.name}):`, err.message);
        errors.push({ id: file.id, name: file.name, error: err.message });
      }

      if ((i + 1) % 3 === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    // After processing all remaining files, requeue to process folders
    console.log(`Queue: All files processed (${deletedFiles} deleted, ${errors.length} failed). Requeuing to process ${remainingFolders.length} folders`);

    await env.DELETE_QUEUE.send({
      folderId,
      folderName,
      accountId,
      userId,
      username,
      files: [],  // Empty files array signals that folders can now be processed
      folders: remainingFolders
    });

    return { success: true, deletedFiles, deletedFolders: 0, failed: errors.length, chunked: true };
  }

  // If we reach here, files array is empty - now process folders
  console.log(`Queue: All files completed. Now processing ${remainingFolders.length} folders`);

  // All files fit in one chunk, process normally
  await db.prepare(
    'INSERT INTO queue_jobs (job_id, folder_id, folder_name, user_id, username, status) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(jobId, folderId, folderName, userId, username, 'processing').run();

  try {
    console.log(`Queue: Processing ${remainingFiles.length} files, ${remainingFolders.length} folders (pre-scanned)`);

    const totalItems = remainingFiles.length + remainingFolders.length + 1;

    await db.prepare(
      'UPDATE queue_jobs SET total_items = ?, started_at = datetime(?) WHERE job_id = ?'
    ).bind(totalItems, 'now', jobId).run();

    const sortedFolders = remainingFolders.sort((a, b) => b.depth - a.depth);

    let deletedFiles = 0;
    let deletedFolders = 0;
    const errors = [];

    // Delete remaining files
    for (let i = 0; i < remainingFiles.length; i++) {
      const file = remainingFiles[i];
      try {
        await deleteOneFile(env, db, file.id, file.accountId);
        deletedFiles++;
      } catch (err) {
        console.error(`Queue: Failed to delete file ${file.id} (${file.name}):`, err.message);
        errors.push({ id: file.id, name: file.name, error: err.message });
      }

      // Delay every 3 files to avoid hitting subrequest limit
      if ((i + 1) % 3 === 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      // Update progress every 10 files
      if (i % 10 === 0 || i === remainingFiles.length - 1) {
        await db.prepare(
          'UPDATE queue_jobs SET processed_items = ?, failed_items = ?, error_details = ? WHERE job_id = ?'
        ).bind(deletedFiles + deletedFolders, errors.length, JSON.stringify(errors.slice(0, 10)), jobId).run();
      }
    }

    // Delete folders one by one with delay every 3 folders (avoid subrequest limit)
    for (let i = 0; i < sortedFolders.length; i++) {
      const folder = sortedFolders[i];
      try {
        await deleteOneFile(env, db, folder.id, folder.accountId);
        deletedFolders++;
      } catch (err) {
        console.error(`Queue: Failed to delete folder ${folder.id} (${folder.name}):`, err.message);
        errors.push({ id: folder.id, name: folder.name, error: err.message });
      }

      // Delay every 3 folders to avoid hitting subrequest limit
      if ((i + 1) % 3 === 0) {
        await new Promise(resolve => setTimeout(resolve, 200));
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
