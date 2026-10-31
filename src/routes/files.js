import { Hono } from 'hono';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { selectAccount } from '../services/account-selector.js';
import { logActivity, logSystem } from '../services/logger.js';
import { mapWithConcurrency, getConcurrencyLimit } from '../services/concurrency.js';
import * as drive from '../services/google-drive.js';
import { registerJobHandler, enqueueJob, JobCancelled } from '../services/job-queue.js';

const files = new Hono();
const FOLDER_MIME = 'application/vnd.google-apps.folder';

// Search rescans the folder tree, so repeat keywords are cached briefly.
const SEARCH_CACHE_TTL = 5 * 60 * 1000;
const SEARCH_CACHE_MAX = 50;
const searchCache = new Map();

function clearSearchCache() {
  searchCache.clear();
}

async function getSharedFolderId(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").first();
  return row?.value || null;
}

async function getPrimaryAccountId(db) {
  const row = await db.prepare('SELECT id FROM accounts WHERE is_primary = 1').first();
  return row?.id || null;
}

async function resolveFileOwnerAccountId(c, db, fileId) {
  const owner = await db.prepare('SELECT account_id FROM file_owners WHERE file_id = ?').bind(fileId).first();
  if (owner) return owner.account_id;

  const primaryId = await getPrimaryAccountId(db);
  if (!primaryId) return null;

  const ownerEmail = await drive.getFileOwnerEmail(c.env, db, primaryId, fileId);
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
  clearSearchCache();
}

// Walk the folder tree and collect every file/folder with its owning account.
// Owner lookups are parallelised; tree recursion stays depth-first because each
// folder listing depends on its parent.
async function scanFolderTree(env, db, rootFolderId, rootAccountId, depth = 0, acc = { files: [], folders: [] }, onProgress = async () => {}) {
  const children = await drive.listAllFiles(env, db, rootAccountId, rootFolderId);
  const limit = await getConcurrencyLimit(db);

  const withOwners = await mapWithConcurrency(children, limit, async (child) => {
    const childAccountId = await resolveFileOwnerAccountId({ env }, db, child.id);
    if (!childAccountId) throw new Error('No primary account set');
    return { ...child, accountId: childAccountId };
  });

  for (const child of withOwners) {
    if (child.mimeType !== FOLDER_MIME) {
      acc.files.push({
        id: child.id,
        name: child.name,
        mimeType: child.mimeType,
        depth: depth + 1,
        accountId: child.accountId
      });
    }
  }

  await onProgress(acc.files.length + acc.folders.length);

  for (const child of withOwners) {
    if (child.mimeType === FOLDER_MIME) {
      acc.folders.push({
        id: child.id,
        name: child.name,
        mimeType: child.mimeType,
        depth: depth + 1,
        accountId: child.accountId
      });
      await scanFolderTree(env, db, child.id, child.accountId, depth + 1, acc, onProgress);
    }
  }

  return acc;
}

function buildFolderDeletePlan(scannedItems) {
  const filesToDelete = scannedItems.files;
  const foldersToDelete = scannedItems.folders.sort((a, b) => b.depth - a.depth);
  return { filesToDelete, foldersToDelete };
}

// Files first, then folders deepest-first, then the root folder. Deletions run
// in parallel (limited by the account concurrency setting).
async function executeFolderDeletePlan(env, db, plan, rootFolderId, rootAccountId, { progress = async () => {}, isCancelled = () => false } = {}) {
  const limit = await getConcurrencyLimit(db);
  const errors = [];
  let deletedFiles = 0;
  let deletedFolders = 0;
  const total = plan.filesToDelete.length + plan.foldersToDelete.length + 1;

  const remove = async (item, isFolder) => {
    if (isCancelled()) throw new JobCancelled();
    try {
      await deleteOneFile(env, db, item.id, item.accountId);
      if (isFolder) deletedFolders++;
      else deletedFiles++;
    } catch (err) {
      errors.push({ id: item.id, name: item.name, error: err.message });
    }
    await progress({ done: deletedFiles + deletedFolders, total, failed: errors.length });
  };

  await mapWithConcurrency(plan.filesToDelete, limit, item => remove(item, false));
  await mapWithConcurrency(plan.foldersToDelete, limit, item => remove(item, true));
  await remove({ id: rootFolderId, accountId: rootAccountId }, true);

  return { deletedFiles, deletedFolders, failed: errors.length, errors };
}

async function deleteTree(env, db, fileId, accountId, { onScan, execute } = {}) {
  const scanned = await scanFolderTree(env, db, fileId, accountId, 0, { files: [], folders: [] }, onScan);
  const plan = buildFolderDeletePlan(scanned);
  return executeFolderDeletePlan(env, db, plan, fileId, accountId, execute);
}

registerJobHandler('delete-folder', async ({ db, env, payload, progress, isCancelled }) => {
  await progress({ message: 'Scanning folder…', done: 0, total: 0 });

  const scanned = await scanFolderTree(
    env, db, payload.fileId, payload.accountId, 0, { files: [], folders: [] },
    async (count) => progress({ message: `Scanning: ${count} item(s) found` })
  );

  if (isCancelled()) throw new JobCancelled();

  const plan = buildFolderDeletePlan(scanned);
  const total = plan.filesToDelete.length + plan.foldersToDelete.length + 1;
  await progress({ total, done: 0, message: 'Deleting…' });

  return executeFolderDeletePlan(env, db, plan, payload.fileId, payload.accountId, { progress, isCancelled });
});

registerJobHandler('delete-items', async ({ db, env, payload, progress, isCancelled }) => {
  const ids = payload.fileIds || [];
  const errors = [];
  let deletedFiles = 0;
  let deletedFolders = 0;

  for (let i = 0; i < ids.length; i++) {
    if (isCancelled()) throw new JobCancelled();

    try {
      const accountId = await resolveFileOwnerAccountId({ env }, db, ids[i]);
      if (!accountId) throw new Error('Owner account not found');

      const info = await drive.getFileInfo(env, db, accountId, ids[i]);

      if (info.mimeType === FOLDER_MIME) {
        const summary = await deleteTree(env, db, ids[i], accountId, {
          onScan: async (count) => progress({ message: `Scanning ${info.name}: ${count} item(s)` }),
          execute: {
            isCancelled,
            progress: async ({ done }) => progress({
              message: `Deleting… ${deletedFiles + deletedFolders + done} item(s)`
            })
          }
        });
        deletedFiles += summary.deletedFiles;
        deletedFolders += summary.deletedFolders;
        errors.push(...summary.errors);
      } else {
        await deleteOneFile(env, db, ids[i], accountId);
        deletedFiles++;
      }
    } catch (err) {
      if (err instanceof JobCancelled) throw err;
      errors.push({ id: ids[i], error: err.message });
    }

    await progress({
      done: i + 1,
      total: ids.length,
      failed: errors.length,
      message: `${deletedFiles} file(s), ${deletedFolders} folder(s) deleted`
    });
  }

  return { deletedFiles, deletedFolders, failed: errors.length, errors };
});

// Empty every account's trash. Listing and deleting both run in parallel;
// permanent deletes are single API calls, so batching them is the whole win.
registerJobHandler('empty-trash', async ({ db, env, progress, isCancelled }) => {
  const { results: accounts } = await db.prepare('SELECT id, email FROM accounts').all();
  const limit = Math.max(5, await getConcurrencyLimit(db));

  await progress({ message: 'Scanning trash…', done: 0, total: 0 });

  const listings = await mapWithConcurrency(accounts, Math.max(8, limit), async (acc) => {
    try {
      return { acc, trashed: await drive.listTrash(env, db, acc.id) };
    } catch {
      return { acc, trashed: [] };
    }
  });

  const items = listings.flatMap(({ acc, trashed }) => trashed.map(f => ({ ...f, accountId: acc.id })));
  if (isCancelled()) throw new JobCancelled();

  const total = items.length;
  await progress({ total, done: 0, message: `Deleting ${total} item(s)…` });

  let deleted = 0;
  let failed = 0;
  const errors = [];

  await mapWithConcurrency(items, limit, async (item) => {
    if (isCancelled()) return;
    try {
      await drive.permanentDeleteFile(env, db, item.accountId, item.id);
      deleted++;
    } catch (err) {
      failed++;
      errors.push({ id: item.id, name: item.name, error: err.message });
    }
    await progress({
      done: deleted + failed,
      total,
      failed,
      message: `Deleted ${deleted} of ${total}${failed ? ` · ${failed} failed` : ''}`
    });
  });

  clearSearchCache();
  return { deleted, failed, total, errors };
});

files.get('/dlink/:token', async (c) => {
  const db = c.get("db");
  const token = c.req.param('token');

  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(`dl_token:${token}`).first();
  if (!row) return c.json({ error: 'Invalid or expired download link' }, 403);

  const data = JSON.parse(row.value);
  if (new Date(data.expiresAt) < new Date()) {
    await db.prepare("DELETE FROM settings WHERE key = ?").bind(`dl_token:${token}`).run();
    return c.json({ error: 'Download link expired' }, 403);
  }

  const { metadata, body } = await drive.downloadFile(c.env, db, data.accountId, data.fileId);
  return new Response(body, {
    headers: {
      'Content-Type': metadata.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(data.fileName)}"`,
      ...(metadata.size ? { 'Content-Length': metadata.size } : {})
    }
  });
});

files.get('/trash/list', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'trash:view');
  if (err) return err;

  const db = c.get("db");
  const { results: accounts } = await db.prepare('SELECT id, email, display_name FROM accounts').all();

  // Query all accounts with parallel workers. Trash only does one lightweight
  // API call per account, so it tolerates more concurrency than deletes; keep
  // 8 as the floor but honour a higher configured limit.
  const settled = await mapWithConcurrency(accounts, Math.max(8, await getConcurrencyLimit(db)), async (acc) => {
    try {
      return { acc, trashed: await drive.listTrash(c.env, db, acc.id) };
    } catch {
      return { acc, trashed: [] };
    }
  });

  const allTrash = [];
  for (const { acc, trashed } of settled) {
    for (const file of trashed) {
      allTrash.push({ ...file, ownerEmail: acc.email, ownerName: acc.display_name, accountId: acc.id });
    }
  }

  allTrash.sort((a, b) => new Date(b.trashedTime || 0) - new Date(a.trashedTime || 0));
  return c.json(allTrash);
});

// Search by name across the whole shared folder tree. Breadth-first walk with
// parallel folder listings; bounded so a huge drive cannot hang the request.
files.get('/search', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:view');
  if (err) return err;

  const q = (c.req.query('q') || '').trim();
  if (q.length < 2) return c.json({ error: 'Enter at least 2 characters' }, 400);

  const db = c.get('db');
  const rootId = await getSharedFolderId(db);
  if (!rootId) return c.json({ error: 'No shared folder configured' }, 400);

  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const needle = q.toLowerCase();
  const cacheKey = `${rootId}:${needle}`;
  const hit = searchCache.get(cacheKey);
  if (hit && Date.now() - hit.at < SEARCH_CACHE_TTL) {
    return c.json({ ...hit.data, cached: true });
  }

  const limit = Math.max(8, await getConcurrencyLimit(db));
  const MAX_RESULTS = 200;
  const MAX_FOLDERS = 600;

  const matches = [];
  let frontier = [{ id: rootId, path: '', trail: [] }];
  let scannedFolders = 0;
  let truncated = false;

  while (frontier.length) {
    if (matches.length >= MAX_RESULTS || scannedFolders >= MAX_FOLDERS) {
      truncated = true;
      break;
    }

    const listings = await mapWithConcurrency(frontier, limit, async (folder) => {
      try {
        return { folder, children: await drive.listAllFiles(c.env, db, accountId, folder.id) };
      } catch {
        return { folder, children: [] };
      }
    });

    frontier = [];
    for (const { folder, children } of listings) {
      scannedFolders++;
      for (const child of children) {
        if (child.name.toLowerCase().includes(needle)) {
          matches.push({
            id: child.id,
            name: child.name,
            mimeType: child.mimeType,
            size: child.size,
            modifiedTime: child.modifiedTime,
            parentId: folder.id,
            path: folder.path,
            // Ancestors of the containing folder, plus the folder itself.
            trail: folder.id === rootId ? [] : [...folder.trail, { id: folder.id, name: folder.name }]
          });
        }
        if (child.mimeType === FOLDER_MIME) {
          frontier.push({
            id: child.id,
            name: child.name,
            path: folder.path ? `${folder.path}/${child.name}` : child.name,
            // Ancestors below the shared root, so the breadcrumb can be
            // rebuilt when a search result folder is opened.
            trail: folder.id === rootId ? [] : [...folder.trail, { id: folder.id, name: folder.name }]
          });
        }
      }
    }
  }

  const payload = { matches: matches.slice(0, MAX_RESULTS), scannedFolders, truncated };
  if (!truncated) {
    searchCache.set(cacheKey, { at: Date.now(), data: payload });
    if (searchCache.size > SEARCH_CACHE_MAX) {
      searchCache.delete(searchCache.keys().next().value);
    }
  }
  return c.json(payload);
});


files.get('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:view');
  if (err) return err;

  const db = c.get("db");
  const folderId = c.req.query('folderId') || await getSharedFolderId(db);
  if (!folderId) return c.json({ error: 'No shared folder configured' }, 400);

  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.listFiles(c.env, db, accountId, folderId);

  // Hide share folder from root listing for slave users without share permission
  if (!c.req.query('folderId') && user.role !== 'master') {
    const shareFolderRow = await db.prepare("SELECT value FROM settings WHERE key = 'share_folder_id'").first();
    if (shareFolderRow?.value) {
      return c.json(result.filter(f => f.id !== shareFolderRow.value));
    }
  }

  return c.json(result);
});

files.post('/upload', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:upload');
  if (err) return err;

  const db = c.get("db");
  const formData = await c.req.formData();
  const file = formData.get('file');
  const folderId = formData.get('folderId') || await getSharedFolderId(db);
  if (!file) return c.json({ error: 'No file provided' }, 400);
  if (!folderId) return c.json({ error: 'No shared folder configured' }, 400);

  const buffer = await file.arrayBuffer();
  const account = await selectAccount(db, buffer.byteLength);
  if (!account) return c.json({ error: 'Insufficient storage across all accounts' }, 507);

  // Ensure the selected account has access to the shared folder
  const hasAccess = await drive.ensureAccountFolderAccess(c.env, db, account.id, folderId);
  if (!hasAccess) {
    await logSystem(db, 'error', `Upload failed: account ${account.email} cannot access shared folder`, `file: ${file.name}, folder: ${folderId}`);
    return c.json({ error: 'Shared folder not found or account has no write access. Check Settings > Shared Folder ID.' }, 500);
  }

  const result = await drive.uploadFile(c.env, db, account.id, folderId, buffer, { name: file.name, type: file.type });

  clearSearchCache();

  await db.prepare("UPDATE accounts SET storage_used = storage_used + ?, updated_at = datetime('now') WHERE id = ?")
    .bind(buffer.byteLength, account.id).run();
  await db.prepare('INSERT OR REPLACE INTO file_owners (file_id, account_id) VALUES (?, ?)')
    .bind(result.id, account.id).run();

  await logActivity(db, user.id, user.username, 'upload', `${file.name} (${account.email})`);
  return c.json(result);
});

files.get('/:fileId/info', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const primaryId = await getPrimaryAccountId(db);
  if (!primaryId) return c.json({ error: 'No primary account set' }, 400);

  const fileInfo = await drive.getFileInfo(c.env, db, primaryId, fileId);

  let uploaderEmail = null;
  let uploaderName = null;

  const canViewUploader = user.role === 'master' || user.permissions.includes('drive:view_uploader');

  if (canViewUploader) {
    const owner = await db.prepare('SELECT account_id FROM file_owners WHERE file_id = ?').bind(fileId).first();
    if (owner) {
      const acc = await db.prepare('SELECT email, display_name FROM accounts WHERE id = ?').bind(owner.account_id).first();
      if (acc) { uploaderEmail = acc.email; uploaderName = acc.display_name; }
    } else {
      const ownerEmail = await drive.getFileOwnerEmail(c.env, db, primaryId, fileId);
      if (ownerEmail) {
        uploaderEmail = ownerEmail;
        const acc = await db.prepare('SELECT display_name FROM accounts WHERE email = ?').bind(ownerEmail).first();
        if (acc) uploaderName = acc.display_name;
      }
    }
  }

  return c.json({ ...fileInfo, uploaderEmail, uploaderName });
});

files.get('/:fileId/download', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:download_background');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const { metadata, body } = await drive.downloadFile(c.env, db, accountId, fileId);

  await logActivity(db, user.id, user.username, 'download', metadata.name);
  return new Response(body, {
    headers: {
      'Content-Type': metadata.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(metadata.name)}"`,
      ...(metadata.size ? { 'Content-Length': metadata.size } : {})
    }
  });
});

files.post('/:fileId/download-token', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:download_browser');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  // Get file size to calculate expiry
  const fileInfo = await drive.getFileInfo(c.env, db, accountId, fileId);
  const fileSize = parseInt(fileInfo.size || '0');

  // Get avg download speed from settings (default 1 MBps)
  const speedSetting = await db.prepare("SELECT value FROM settings WHERE key = 'download_speed_mbps'").first();
  const speedMBps = speedSetting ? parseFloat(speedSetting.value) : 1;

  // Calculate expiry: (fileSize / speed) * 2, minimum 60 seconds
  const downloadTimeSec = fileSize / (speedMBps * 1024 * 1024);
  const expirySec = Math.max(60, Math.ceil(downloadTimeSec * 2));
  const expiresAt = new Date(Date.now() + expirySec * 1000).toISOString();

  // Generate token
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  const token = Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');

  await db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(`dl_token:${token}`, JSON.stringify({ fileId, accountId, expiresAt, fileName: fileInfo.name })).run();

  await logActivity(db, user.id, user.username, 'download', fileInfo.name);
  return c.json({ token, expiresAt, fileName: fileInfo.name, fileSize });
});

files.get('/:fileId/thumbnail', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const size = parseInt(c.req.query('size') || '200');
  const accountId = await resolveFileOwnerAccountId(c, db, fileId);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.getThumbnail(c.env, db, accountId, fileId, size);
  if (!result) return c.json({ error: 'No thumbnail available' }, 404);

  return new Response(result.body, {
    headers: {
      'Content-Type': result.contentType || 'image/png',
      'Cache-Control': 'private, max-age=3600',
      ...(result.contentLength ? { 'Content-Length': result.contentLength } : {})
    }
  });
});

files.get('/:fileId/preview', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:preview');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const accountId = await resolveFileOwnerAccountId(c, db, fileId);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const rangeHeader = c.req.header('Range');

  if (rangeHeader) {
    const { metadata, body } = await drive.downloadFileRange(c.env, db, accountId, fileId, rangeHeader);
    const totalSize = parseInt(metadata.size);
    const parts = rangeHeader.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0]);
    const end = parts[1] ? parseInt(parts[1]) : totalSize - 1;
    const chunkSize = end - start + 1;

    return new Response(body, {
      status: 206,
      headers: {
        'Content-Type': metadata.mimeType || 'application/octet-stream',
        'Content-Range': `bytes ${start}-${end}/${totalSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Disposition': `inline; filename="${encodeURIComponent(metadata.name)}"`
      }
    });
  }

  const { metadata, body } = await drive.downloadFile(c.env, db, accountId, fileId);
  return new Response(body, {
    headers: {
      'Content-Type': metadata.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(metadata.name)}"`,
      'Accept-Ranges': 'bytes',
      ...(metadata.size ? { 'Content-Length': metadata.size } : {})
    }
  });
});

files.post('/folder', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:create_folder');
  if (err) return err;

  const db = c.get("db");
  const { name, parentId } = await c.req.json();
  const folderId = parentId || await getSharedFolderId(db);
  if (!folderId) return c.json({ error: 'No shared folder configured' }, 400);

  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.createFolder(c.env, db, accountId, folderId, name);

  clearSearchCache();
  await logActivity(db, user.id, user.username, 'create_folder', name);
  return c.json(result);
});

files.patch('/:fileId', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:rename');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const { name } = await c.req.json();
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.renameFile(c.env, db, accountId, fileId, name);
  await logActivity(db, user.id, user.username, 'rename', name);
  return c.json(result);
});

files.delete('/:fileId', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:delete');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');

  try {
    const accountId = await resolveFileOwnerAccountId(c, db, fileId);
    if (!accountId) return c.json({ error: 'No primary account set' }, 400);

    const fileInfo = await drive.getFileInfo(c.env, db, accountId, fileId);

    if (fileInfo.mimeType === FOLDER_MIME) {
      const jobId = await enqueueJob(db, {
        type: 'delete-folder',
        label: `Delete "${fileInfo.name || fileId}"`,
        payload: { fileId, accountId },
        userId: user.id
      });

      await logActivity(db, user.id, user.username, 'delete', `${fileInfo.name || fileId} (queued)`);
      return c.json({ success: true, queued: true, jobId });
    }

    await deleteOneFile(c.env, db, fileId, accountId);
    await logActivity(db, user.id, user.username, 'delete', fileInfo.name || fileId);
    return c.json({ success: true });
  } catch (error) {
    console.error('Delete error:', error);
    return c.json({ error: error.message || 'Delete failed' }, 500);
  }
});

files.post('/bulk-delete', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:delete');
  if (err) return err;

  const db = c.get('db');
  const { fileIds } = await c.req.json();

  if (!Array.isArray(fileIds) || fileIds.length === 0) {
    return c.json({ error: 'No files selected' }, 400);
  }

  const jobId = await enqueueJob(db, {
    type: 'delete-items',
    label: `Delete ${fileIds.length} item(s)`,
    payload: { fileIds },
    userId: user.id
  });

  await logActivity(db, user.id, user.username, 'delete', `${fileIds.length} item(s) (queued)`);
  return c.json({ success: true, queued: true, jobId });
});

files.post('/:fileId/move', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:move');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const { newParentId, oldParentId } = await c.req.json();
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  // Get actual parent if oldParentId not provided
  let removeParent = oldParentId;
  if (!removeParent) {
    const fileInfo = await drive.getFileInfo(c.env, db, accountId, fileId);
    removeParent = fileInfo.parents?.[0];
  }

  // Fallback to shared folder if newParentId not provided
  const addParent = newParentId || await getSharedFolderId(db);
  if (!addParent) return c.json({ error: 'No destination folder' }, 400);

  const result = await drive.moveFile(c.env, db, accountId, fileId, addParent, removeParent);
  await logActivity(db, user.id, user.username, 'move', fileId);
  return c.json(result);
});

files.post('/:fileId/copy', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:copy');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const { destinationId } = await c.req.json();
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.copyFile(c.env, db, accountId, fileId, destinationId);
  await logActivity(db, user.id, user.username, 'copy', fileId);
  return c.json(result);
});

files.post('/trash/empty', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'trash:empty');
  if (err) return err;

  const db = c.get('db');
  const jobId = await enqueueJob(db, {
    type: 'empty-trash',
    label: 'Empty trash (all accounts)',
    payload: {},
    userId: user.id
  });

  await logActivity(db, user.id, user.username, 'permanent_delete', 'Empty trash (queued)');
  return c.json({ success: true, queued: true, jobId });
});

files.post('/:fileId/restore', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'trash:restore');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const { accountId } = await c.req.json();
  if (!accountId) return c.json({ error: 'No accountId provided' }, 400);

  await drive.restoreFile(c.env, db, accountId, fileId);
  await logActivity(db, user.id, user.username, 'restore', fileId);
  return c.json({ success: true });
});

files.post('/:fileId/permanent-delete', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'trash:permanent_delete');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const { accountId } = await c.req.json();
  if (!accountId) return c.json({ error: 'No accountId provided' }, 400);

  await drive.permanentDeleteFile(c.env, db, accountId, fileId);
  await logActivity(db, user.id, user.username, 'permanent_delete', fileId);
  return c.json({ success: true });
});

files.post('/:fileId/transfer-owner', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'drive:transfer_owner');
  if (err) return err;

  const db = c.get("db");
  const fileId = c.req.param('fileId');
  const { targetAccountId } = await c.req.json();
  if (!targetAccountId) return c.json({ error: 'No target account provided' }, 400);

  // Get source account (current owner)
  let sourceAccountId;
  const owner = await db.prepare('SELECT account_id FROM file_owners WHERE file_id = ?').bind(fileId).first();
  if (owner) {
    sourceAccountId = owner.account_id;
  } else {
    const primaryId = await getPrimaryAccountId(db);
    if (!primaryId) return c.json({ error: 'No primary account set' }, 400);
    const ownerEmail = await drive.getFileOwnerEmail(c.env, db, primaryId, fileId);
    if (ownerEmail) {
      const matched = await db.prepare('SELECT id FROM accounts WHERE email = ?').bind(ownerEmail).first();
      if (matched) sourceAccountId = matched.id;
    }
    if (!sourceAccountId) sourceAccountId = primaryId;
  }

  if (sourceAccountId === targetAccountId) return c.json({ error: 'Source and target are the same account' }, 400);

  // Get file info including parent folder
  const fileInfo = await drive.getFileInfo(c.env, db, sourceAccountId, fileId);
  const sharedFolderId = await getSharedFolderId(db);
  const actualParent = fileInfo.parents?.[0] || null;
  let parentFolder = actualParent || sharedFolderId;

  // The copy below runs with the TARGET account's credentials, so the target
  // must be able to READ the source file. Files inside the shared folder are
  // visible to every account; files in the source account's private space are
  // not, which made the copy fail with 404. When needed, move the original
  // into the shared folder first — it is permanently deleted at the end of
  // the transfer anyway — and make sure the target account is a member.
  if (sharedFolderId) {
    const insideShared = actualParent
      ? await drive.isFolderInside(c.env, db, sourceAccountId, actualParent, sharedFolderId)
      : false;
    if (!insideShared) {
      await drive.moveFile(c.env, db, sourceAccountId, fileId, sharedFolderId, actualParent || '');
      parentFolder = sharedFolderId;
    }
    await drive.ensureAccountFolderAccess(c.env, db, targetAccountId, sharedFolderId);
  }

  // Step 1: Copy file to target account (lands in target's root or shared folder)
  const newFile = await drive.copyFile(c.env, db, targetAccountId, fileId, parentFolder);

  // Step 2: Delete original from source account
  await drive.permanentDeleteFile(c.env, db, sourceAccountId, fileId);

  // Step 3: Move new file to original parent folder (ensure correct location)
  try {
    await drive.moveFile(c.env, db, targetAccountId, newFile.id, parentFolder, parentFolder);
  } catch {}

  // Update file_owners
  await db.prepare('DELETE FROM file_owners WHERE file_id = ?').bind(fileId).run();
  await db.prepare('INSERT OR REPLACE INTO file_owners (file_id, account_id) VALUES (?, ?)').bind(newFile.id, targetAccountId).run();

  await logActivity(db, user.id, user.username, 'transfer_owner', `${fileInfo.name} → account #${targetAccountId}`);
  return c.json({ success: true, newFileId: newFile.id });
});

export default files;
