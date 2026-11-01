import { Hono } from 'hono';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import * as drive from '../services/google-drive.js';
import { hashPassword, verifyPassword } from '../services/password.js';

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const ALLOWED_PERMS = ['read', 'download', 'upload', 'write'];
const MAX_TEXT_BYTES = 5 * 1024 * 1024;

export const shareLinkPublic = new Hono();
export const shareLinkAdmin = new Hono();

function generateToken() {
  const array = new Uint8Array(12);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

function parsePerms(raw) {
  try { return JSON.parse(raw); } catch { return String(raw).split(',').filter(Boolean); }
}

function hasPerm(row, perm) {
  return parsePerms(row.permissions).includes(perm);
}

async function getRow(db, token) {
  return db.prepare('SELECT * FROM share_links WHERE token = ?').bind(token).first();
}

async function resolveOwnerAccountId(env, db, fileId) {
  const owner = await db.prepare('SELECT account_id FROM file_owners WHERE file_id = ?').bind(fileId).first();
  if (owner) return owner.account_id;

  const primary = await db.prepare('SELECT id FROM accounts WHERE is_primary = 1').first();
  if (!primary) return null;

  const ownerEmail = await drive.getFileOwnerEmail(env, db, primary.id, fileId).catch(() => null);
  if (ownerEmail) {
    const matched = await db.prepare('SELECT id FROM accounts WHERE email = ?').bind(ownerEmail).first();
    if (matched) {
      await db.prepare('INSERT OR REPLACE INTO file_owners (file_id, account_id) VALUES (?, ?)').bind(fileId, matched.id).run();
      return matched.id;
    }
  }
  return primary.id;
}

async function checkAccess(c, row) {
  if (new Date(row.expires_at) < new Date()) {
    return c.json({ error: 'Share link has expired' }, 410);
  }
  if (row.password_hash) {
    const pw = c.req.query('pw') || c.req.header('x-share-password');
    if (!pw) return c.json({ error: 'Password required', passwordRequired: true }, 401);
    const valid = await verifyPassword(pw, row.password_hash);
    if (!valid) return c.json({ error: 'Invalid password', passwordRequired: true }, 401);
  }
  return null;
}

async function inScope(env, db, row, fileId) {
  if (row.resource_type === 'file') return fileId === row.drive_file_id;
  return drive.isFolderInside(env, db, row.account_id, fileId, row.drive_file_id);
}

function publicInfo(row) {
  return {
    token: row.token,
    fileId: row.drive_file_id,
    name: row.name,
    resourceType: row.resource_type,
    mimeType: row.mime_type,
    size: row.size,
    permissions: parsePerms(row.permissions),
    hasPassword: !!row.password_hash,
    expiresAt: row.expires_at
  };
}

// ---------- Public ----------

shareLinkPublic.get('/:token', async (c) => {
  const db = c.get('db');
  const row = await getRow(db, c.req.param('token'));
  if (!row) return c.json({ error: 'Share link not found' }, 404);
  const denied = await checkAccess(c, row);
  if (denied) return denied;

  await db.prepare("UPDATE share_links SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?").bind(row.id).run();
  return c.json(publicInfo(row));
});

shareLinkPublic.get('/:token/children', async (c) => {
  const db = c.get('db');
  const row = await getRow(db, c.req.param('token'));
  if (!row) return c.json({ error: 'Share link not found' }, 404);
  const denied = await checkAccess(c, row);
  if (denied) return denied;
  if (!hasPerm(row, 'read')) return c.json({ error: 'Read permission disabled' }, 403);

  const folderId = c.req.query('folderId') || row.drive_file_id;
  if (row.resource_type !== 'folder') return c.json({ error: 'Not a folder share' }, 400);
  if (!(await inScope(c.env, db, row, folderId))) return c.json({ error: 'Folder is outside this share' }, 403);

  const items = await drive.listFiles(c.env, db, row.account_id, folderId);
  return c.json({
    folderId,
    rootId: row.drive_file_id,
    items: items.map(f => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size }))
  });
});

shareLinkPublic.get('/:token/download/:fileId', async (c) => {
  const db = c.get('db');
  const row = await getRow(db, c.req.param('token'));
  if (!row) return c.json({ error: 'Share link not found' }, 404);
  const denied = await checkAccess(c, row);
  if (denied) return denied;
  if (!hasPerm(row, 'download')) return c.json({ error: 'Download permission disabled' }, 403);

  const fileId = c.req.param('fileId');
  if (!(await inScope(c.env, db, row, fileId))) return c.json({ error: 'File is outside this share' }, 403);

  const { metadata, body } = await drive.downloadFile(c.env, db, row.account_id, fileId);
  await db.prepare("UPDATE share_links SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?").bind(row.id).run();
  return new Response(body, {
    headers: {
      'Content-Type': metadata.mimeType || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(metadata.name)}"`,
      ...(metadata.size ? { 'Content-Length': metadata.size } : {})
    }
  });
});

shareLinkPublic.get('/:token/preview/:fileId', async (c) => {
  const db = c.get('db');
  const row = await getRow(db, c.req.param('token'));
  if (!row) return c.json({ error: 'Share link not found' }, 404);
  const denied = await checkAccess(c, row);
  if (denied) return denied;
  if (!hasPerm(row, 'read')) return c.json({ error: 'Read permission disabled' }, 403);

  const fileId = c.req.param('fileId');
  if (!(await inScope(c.env, db, row, fileId))) return c.json({ error: 'File is outside this share' }, 403);

  const { metadata, body } = await drive.downloadFile(c.env, db, row.account_id, fileId);
  return new Response(body, {
    headers: {
      'Content-Type': metadata.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(metadata.name)}"`,
      ...(metadata.size ? { 'Content-Length': metadata.size } : {})
    }
  });
});

shareLinkPublic.put('/:token/content/:fileId', async (c) => {
  const db = c.get('db');
  const row = await getRow(db, c.req.param('token'));
  if (!row) return c.json({ error: 'Share link not found' }, 404);
  const denied = await checkAccess(c, row);
  if (denied) return denied;
  if (!hasPerm(row, 'write')) return c.json({ error: 'Write permission disabled' }, 403);

  const fileId = c.req.param('fileId');
  if (!(await inScope(c.env, db, row, fileId))) return c.json({ error: 'File is outside this share' }, 403);

  const text = await c.req.text();
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > MAX_TEXT_BYTES) return c.json({ error: 'File too large to edit (max 5MB)' }, 413);

  const info = await drive.getFileInfo(c.env, db, row.account_id, fileId);
  await drive.updateFileContent(c.env, db, row.account_id, fileId, bytes, info.mimeType || 'text/plain');
  return c.json({ ok: true, size: bytes.length });
});

shareLinkPublic.post('/:token/upload', async (c) => {
  const db = c.get('db');
  const row = await getRow(db, c.req.param('token'));
  if (!row) return c.json({ error: 'Share link not found' }, 404);
  const denied = await checkAccess(c, row);
  if (denied) return denied;
  if (row.resource_type !== 'folder') return c.json({ error: 'Upload requires a folder share' }, 400);
  if (!hasPerm(row, 'upload')) return c.json({ error: 'Upload permission disabled' }, 403);

  const formData = await c.req.formData();
  const file = formData.get('file');
  if (!file) return c.json({ error: 'No file provided' }, 400);

  const folderId = formData.get('folderId') || row.drive_file_id;
  if (!(await inScope(c.env, db, row, folderId))) return c.json({ error: 'Folder is outside this share' }, 403);

  const maxSetting = await db.prepare("SELECT value FROM settings WHERE key = 'share_max_file_size_mb'").first();
  const maxMb = parseInt(maxSetting?.value) || 100;
  if (file.size > maxMb * 1024 * 1024) return c.json({ error: `File exceeds maximum size of ${maxMb}MB` }, 400);

  const buffer = new Uint8Array(await file.arrayBuffer());
  const created = await drive.uploadFile(c.env, db, row.account_id, folderId, buffer, { name: file.name, type: file.type || 'application/octet-stream' });
  return c.json({ id: created.id, name: created.name, mimeType: created.mimeType, size: created.size });
});

// ---------- Admin ----------

shareLinkAdmin.get('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'share:view');
  if (err) return err;

  const db = c.get('db');
  const rows = (await db.prepare('SELECT * FROM share_links ORDER BY created_at DESC').all()).results;
  return c.json({
    links: rows.map(r => ({
      id: r.id,
      token: r.token,
      name: r.name,
      resourceType: r.resource_type,
      mimeType: r.mime_type,
      size: r.size,
      permissions: parsePerms(r.permissions),
      hasPassword: !!r.password_hash,
      expiresAt: r.expires_at,
      accessCount: r.access_count,
      createdAt: r.created_at
    }))
  });
});

shareLinkAdmin.post('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'share:manage');
  if (err) return err;

  const db = c.get('db');
  const body = await c.req.json().catch(() => ({}));
  const fileId = body.fileId;
  if (!fileId) return c.json({ error: 'fileId required' }, 400);

  const accountId = await resolveOwnerAccountId(c.env, db, fileId);
  if (!accountId) return c.json({ error: 'No account available' }, 400);

  let info;
  try {
    info = await drive.getFileInfo(c.env, db, accountId, fileId);
  } catch {
    return c.json({ error: 'File not found' }, 404);
  }

  const resourceType = body.resourceType || (info.mimeType === FOLDER_MIME ? 'folder' : 'file');
  const requested = Array.isArray(body.permissions) ? body.permissions : [];
  let perms = ALLOWED_PERMS.filter(p => requested.includes(p));
  if (!perms.includes('read')) perms.unshift('read');
  if (resourceType === 'file') perms = perms.filter(p => p !== 'upload');

  let expiresAt = null;
  const hours = Number(body.expiresInHours);
  if (Number.isFinite(hours) && hours > 0) {
    expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
  }

  const passwordHash = body.password ? await hashPassword(String(body.password)) : null;
  const token = generateToken();

  await db.prepare(
    `INSERT INTO share_links (token, resource_type, account_id, drive_file_id, name, mime_type, size, permissions, password_hash, expires_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    token, resourceType, accountId, fileId, info.name || 'Untitled', info.mimeType || null,
    info.size ? parseInt(info.size) : null, JSON.stringify(perms), passwordHash, expiresAt, user.id
  ).run();

  return c.json({
    token,
    url: `/#/link/${token}`,
    name: info.name,
    resourceType,
    permissions: perms,
    expiresAt,
    hasPassword: !!passwordHash
  });
});

shareLinkAdmin.delete('/:id', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'share:manage');
  if (err) return err;

  const db = c.get('db');
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
  const result = await db.prepare('DELETE FROM share_links WHERE id = ?').bind(id).run();
  if (!result.meta?.changes) return c.json({ error: 'Share link not found' }, 404);
  return c.json({ ok: true });
});