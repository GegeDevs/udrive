import { Hono } from 'hono';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { selectAccount } from '../services/account-selector.js';
import { logActivity } from '../services/logger.js';
import * as drive from '../services/google-drive.js';

const files = new Hono();

async function getSharedFolderId(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").first();
  return row?.value || null;
}

async function getPrimaryAccountId(db) {
  const row = await db.prepare('SELECT id FROM accounts WHERE is_primary = 1').first();
  return row?.id || null;
}

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
  const allTrash = [];

  for (const acc of accounts) {
    try {
      const trashed = await drive.listTrash(c.env, db, acc.id);
      for (const file of trashed) {
        allTrash.push({ ...file, ownerEmail: acc.email, ownerName: acc.display_name, accountId: acc.id });
      }
    } catch {}
  }

  allTrash.sort((a, b) => new Date(b.trashedTime || 0) - new Date(a.trashedTime || 0));
  return c.json(allTrash);
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

  // Hide share folder from root listing
  if (!c.req.query('folderId')) {
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

  const result = await drive.uploadFile(c.env, db, account.id, folderId, buffer, { name: file.name, type: file.type });

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
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.getThumbnail(c.env, db, accountId, fileId, size);
  if (!result) return c.json({ error: 'No thumbnail available' }, 404);

  return new Response(result.body, {
    headers: {
      'Content-Type': result.contentType || 'image/png',
      'Cache-Control': 'public, max-age=3600',
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
  const accountId = await getPrimaryAccountId(db);
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

  let accountId;
  const owner = await db.prepare('SELECT account_id FROM file_owners WHERE file_id = ?').bind(fileId).first();

  if (owner) {
    accountId = owner.account_id;
  } else {
    const primaryId = await getPrimaryAccountId(db);
    if (!primaryId) return c.json({ error: 'No primary account set' }, 400);

    const ownerEmail = await drive.getFileOwnerEmail(c.env, db, primaryId, fileId);
    if (ownerEmail) {
      const matchedAccount = await db.prepare('SELECT id FROM accounts WHERE email = ?').bind(ownerEmail).first();
      if (matchedAccount) {
        accountId = matchedAccount.id;
        await db.prepare('INSERT OR REPLACE INTO file_owners (file_id, account_id) VALUES (?, ?)').bind(fileId, accountId).run();
      }
    }
    if (!accountId) accountId = primaryId;
  }

  await drive.deleteFile(c.env, db, accountId, fileId);
  await db.prepare('DELETE FROM file_owners WHERE file_id = ?').bind(fileId).run();
  await logActivity(db, user.id, user.username, 'delete', fileId);
  return c.json({ success: true });
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
  const parentFolder = fileInfo.parents?.[0] || await getSharedFolderId(db);

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
