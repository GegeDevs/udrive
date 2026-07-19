import { Hono } from 'hono';
import { authenticateApiKey, checkRateLimit, requireApiPermission } from '../middleware/api-auth.js';
import { selectAccount } from '../services/account-selector.js';
import * as drive from '../services/google-drive.js';

const apiv1 = new Hono();

async function getSharedFolderId(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").first();
  return row?.value || null;
}

async function getPrimaryAccountId(db) {
  const row = await db.prepare('SELECT id FROM accounts WHERE is_primary = 1').first();
  return row?.id || null;
}

// API key auth + rate limit middleware
apiv1.use('*', async (c, next) => {
  const db = c.get('db');
  const apiKey = await authenticateApiKey(db, c.req.raw);
  if (!apiKey) return c.json({ error: 'Invalid or expired API key' }, 401);

  const rateCheck = await checkRateLimit(db, apiKey.keyHash, apiKey.rateLimit);
  c.header('X-RateLimit-Limit', String(apiKey.rateLimit));
  c.header('X-RateLimit-Remaining', String(rateCheck.remaining));
  c.header('X-RateLimit-Reset', String(rateCheck.resetIn));

  if (!rateCheck.allowed) {
    c.header('Retry-After', String(rateCheck.resetIn));
    return c.json({ error: 'Rate limit exceeded' }, 429);
  }

  c.set('apiKey', apiKey);
  await next();
});

// List files
apiv1.get('/files', async (c) => {
  const apiKey = c.get('apiKey');
  const err = requireApiPermission(apiKey, 'api:files:read');
  if (err) return c.json({ error: err.error }, err.status);

  const db = c.get('db');
  const folderId = c.req.query('folderId') || await getSharedFolderId(db);
  if (!folderId) return c.json({ error: 'No shared folder configured' }, 400);

  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const files = await drive.listFiles(c.env, db, accountId, folderId);
  return c.json({ files });
});

// File info
apiv1.get('/files/:fileId', async (c) => {
  const apiKey = c.get('apiKey');
  const err = requireApiPermission(apiKey, 'api:files:read');
  if (err) return c.json({ error: err.error }, err.status);

  const db = c.get('db');
  const fileId = c.req.param('fileId');
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const info = await drive.getFileInfo(c.env, db, accountId, fileId);
  return c.json(info);
});

// Download file
apiv1.get('/files/:fileId/download', async (c) => {
  const apiKey = c.get('apiKey');
  const err = requireApiPermission(apiKey, 'api:files:download');
  if (err) return c.json({ error: err.error }, err.status);

  const db = c.get('db');
  const fileId = c.req.param('fileId');
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const { metadata, body } = await drive.downloadFile(c.env, db, accountId, fileId);
  return new Response(body, {
    headers: {
      'Content-Type': metadata.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(metadata.name)}"`,
      ...(metadata.size ? { 'Content-Length': metadata.size } : {})
    }
  });
});

// Upload file
apiv1.post('/files/upload', async (c) => {
  const apiKey = c.get('apiKey');
  const err = requireApiPermission(apiKey, 'api:files:upload');
  if (err) return c.json({ error: err.error }, err.status);

  const db = c.get('db');
  const formData = await c.req.formData();
  const file = formData.get('file');
  const folderId = formData.get('folderId') || await getSharedFolderId(db);
  if (!file) return c.json({ error: 'No file provided' }, 400);
  if (!folderId) return c.json({ error: 'No shared folder configured' }, 400);

  const buffer = await file.arrayBuffer();
  const account = await selectAccount(db, buffer.byteLength);
  if (!account) return c.json({ error: 'Insufficient storage' }, 507);

  // Ensure the selected account has access to the shared folder
  const hasAccess = await drive.ensureAccountFolderAccess(c.env, db, account.id, folderId);
  if (!hasAccess) {
    return c.json({ error: `Account ${account.email} cannot access the shared folder.` }, 500);
  }

  const result = await drive.uploadFile(c.env, db, account.id, folderId, buffer, { name: file.name, type: file.type });

  await db.prepare("UPDATE accounts SET storage_used = storage_used + ?, updated_at = datetime('now') WHERE id = ?")
    .bind(buffer.byteLength, account.id).run();
  await db.prepare('INSERT OR REPLACE INTO file_owners (file_id, account_id) VALUES (?, ?)')
    .bind(result.id, account.id).run();

  return c.json(result);
});

// Create folder
apiv1.post('/files/folder', async (c) => {
  const apiKey = c.get('apiKey');
  const err = requireApiPermission(apiKey, 'api:files:write');
  if (err) return c.json({ error: err.error }, err.status);

  const db = c.get('db');
  const { name, parentId } = await c.req.json();
  const folderId = parentId || await getSharedFolderId(db);
  if (!folderId) return c.json({ error: 'No shared folder configured' }, 400);

  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.createFolder(c.env, db, accountId, folderId, name);
  return c.json(result);
});

// Rename
apiv1.patch('/files/:fileId', async (c) => {
  const apiKey = c.get('apiKey');
  const err = requireApiPermission(apiKey, 'api:files:write');
  if (err) return c.json({ error: err.error }, err.status);

  const db = c.get('db');
  const fileId = c.req.param('fileId');
  const { name } = await c.req.json();
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.renameFile(c.env, db, accountId, fileId, name);
  return c.json(result);
});

// Delete
apiv1.delete('/files/:fileId', async (c) => {
  const apiKey = c.get('apiKey');
  const err = requireApiPermission(apiKey, 'api:files:write');
  if (err) return c.json({ error: err.error }, err.status);

  const db = c.get('db');
  const fileId = c.req.param('fileId');
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  await drive.deleteFile(c.env, db, accountId, fileId);
  return c.json({ success: true });
});

// Move
apiv1.post('/files/:fileId/move', async (c) => {
  const apiKey = c.get('apiKey');
  const err = requireApiPermission(apiKey, 'api:files:write');
  if (err) return c.json({ error: err.error }, err.status);

  const db = c.get('db');
  const fileId = c.req.param('fileId');
  const { newParentId, oldParentId } = await c.req.json();
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  let removeParent = oldParentId;
  if (!removeParent) {
    const fileInfo = await drive.getFileInfo(c.env, db, accountId, fileId);
    removeParent = fileInfo.parents?.[0];
  }
  const addParent = newParentId || await getSharedFolderId(db);

  const result = await drive.moveFile(c.env, db, accountId, fileId, addParent, removeParent);
  return c.json(result);
});

// Copy
apiv1.post('/files/:fileId/copy', async (c) => {
  const apiKey = c.get('apiKey');
  const err = requireApiPermission(apiKey, 'api:files:write');
  if (err) return c.json({ error: err.error }, err.status);

  const db = c.get('db');
  const fileId = c.req.param('fileId');
  const { destinationId } = await c.req.json();
  const accountId = await getPrimaryAccountId(db);
  if (!accountId) return c.json({ error: 'No primary account set' }, 400);

  const result = await drive.copyFile(c.env, db, accountId, fileId, destinationId || await getSharedFolderId(db));
  return c.json(result);
});

// Transfer ownership
apiv1.post('/files/:fileId/transfer-owner', async (c) => {
  const apiKey = c.get('apiKey');
  const err = requireApiPermission(apiKey, 'api:files:transfer');
  if (err) return c.json({ error: err.error }, err.status);

  const db = c.get('db');
  const fileId = c.req.param('fileId');
  const { targetAccountId } = await c.req.json();
  if (!targetAccountId) return c.json({ error: 'No target account provided' }, 400);

  const primaryId = await getPrimaryAccountId(db);
  const fileInfo = await drive.getFileInfo(c.env, db, primaryId, fileId);
  const parentFolder = fileInfo.parents?.[0] || await getSharedFolderId(db);

  let sourceAccountId;
  const owner = await db.prepare('SELECT account_id FROM file_owners WHERE file_id = ?').bind(fileId).first();
  if (owner) {
    sourceAccountId = owner.account_id;
  } else {
    sourceAccountId = primaryId;
  }

  const newFile = await drive.copyFile(c.env, db, targetAccountId, fileId, parentFolder);
  await drive.permanentDeleteFile(c.env, db, sourceAccountId, fileId);
  try { await drive.moveFile(c.env, db, targetAccountId, newFile.id, parentFolder, parentFolder); } catch {}

  await db.prepare('DELETE FROM file_owners WHERE file_id = ?').bind(fileId).run();
  await db.prepare('INSERT OR REPLACE INTO file_owners (file_id, account_id) VALUES (?, ?)').bind(newFile.id, targetAccountId).run();

  return c.json({ success: true, newFileId: newFile.id });
});

// List accounts
apiv1.get('/accounts', async (c) => {
  const apiKey = c.get('apiKey');
  const err = requireApiPermission(apiKey, 'api:accounts:read');
  if (err) return c.json({ error: err.error }, err.status);

  const db = c.get('db');
  const { results } = await db.prepare('SELECT id, email, display_name, is_primary, storage_limit, storage_used, file_count FROM accounts ORDER BY is_primary DESC, created_at ASC').all();
  return c.json({ accounts: results });
});

export default apiv1;
