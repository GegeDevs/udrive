import { Hono } from 'hono';
import { uploadFile, downloadFile, permanentDeleteFile } from '../services/google-drive.js';
import { selectShareAccount } from '../services/account-selector.js';
import { hashPassword, verifyPassword } from '../services/password.js';
import { logSystem } from '../services/logger.js';
import { cleanupExpiredShares } from '../services/share-cleanup.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { addClient, removeClient, broadcast } from '../services/share-events.js';

function generateShareId() {
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateCsrfToken() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyTurnstile(secretKey, token, ip) {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret: secretKey, response: token, remoteip: ip || '' })
  });
  const data = await res.json();
  return data.success === true;
}

async function checkUploadRateLimit(db, ip) {
  const rateSetting = await db.prepare("SELECT value FROM settings WHERE key = 'share_rate_limit_per_hour'").first();
  const limit = parseInt(rateSetting?.value) || 10;
  const now = Math.floor(Date.now() / 3600000); // current hour window
  const key = `share_ip:${ip}`;

  const row = await db.prepare('SELECT request_count FROM api_rate_limits WHERE key_hash = ? AND window_start = ?')
    .bind(key, now).first();

  if (row && row.request_count >= limit) return false;

  if (row) {
    await db.prepare('UPDATE api_rate_limits SET request_count = request_count + 1 WHERE key_hash = ? AND window_start = ?')
      .bind(key, now).run();
  } else {
    await db.prepare('INSERT INTO api_rate_limits (key_hash, window_start, request_count) VALUES (?, ?, 1)')
      .bind(key, now).run();
    await db.prepare('DELETE FROM api_rate_limits WHERE key_hash LIKE ? AND window_start < ?').bind('share_ip:%', now - 2).run();
  }
  return true;
}

async function getShareSettings(db) {
  const keys = ['share_enabled', 'share_folder_id', 'share_default_expiry_days', 'share_max_expiry_days', 'share_max_file_size_mb', 'share_cleanup_interval_minutes'];
  const settings = {};
  for (const key of keys) {
    const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
    settings[key] = row?.value || '';
  }
  return settings;
}

// Public routes (no auth)
const sharePublic = new Hono();

sharePublic.get('/info', async (c) => {
  const db = c.get('db');
  const settings = await getShareSettings(db);
  if (settings.share_enabled !== '1') {
    return c.json({ enabled: false });
  }

  // Generate CSRF token
  const csrfToken = generateCsrfToken();
  const expiresAt = new Date(Date.now() + 3600000).toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").bind(`csrf:${csrfToken}`, expiresAt).run();
  // Cleanup old CSRF tokens
  await db.prepare("DELETE FROM settings WHERE key LIKE 'csrf:%' AND value < datetime('now')").run();

  return c.json({
    enabled: true,
    maxFileSizeMb: parseInt(settings.share_max_file_size_mb) || 100,
    defaultExpiryDays: parseInt(settings.share_default_expiry_days) || 7,
    maxExpiryDays: parseInt(settings.share_max_expiry_days) || 30,
    csrfToken,
    turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || ''
  });
});

sharePublic.post('/upload', async (c) => {
  const db = c.get('db');
  const settings = await getShareSettings(db);

  if (settings.share_enabled !== '1') {
    return c.json({ error: 'File sharing is disabled' }, 403);
  }
  if (!settings.share_folder_id) {
    return c.json({ error: 'Share folder not configured' }, 400);
  }

  const formData = await c.req.formData();

  // CSRF validation
  const csrfToken = formData.get('csrf_token');
  if (!csrfToken) return c.json({ error: 'Invalid request' }, 403);
  const csrfRow = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(`csrf:${csrfToken}`).first();
  if (!csrfRow || csrfRow.value < new Date().toISOString().replace('T', ' ').slice(0, 19)) {
    return c.json({ error: 'Invalid or expired token' }, 403);
  }
  await db.prepare("DELETE FROM settings WHERE key = ?").bind(`csrf:${csrfToken}`).run();

  // Turnstile verification
  if (c.env.TURNSTILE_SECRET_KEY) {
    const turnstileToken = formData.get('cf-turnstile-response');
    if (!turnstileToken) return c.json({ error: 'Captcha verification required' }, 400);
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || '';
    const valid = await verifyTurnstile(c.env.TURNSTILE_SECRET_KEY, turnstileToken, ip);
    if (!valid) return c.json({ error: 'Captcha verification failed' }, 403);
  }

  // Rate limit per IP
  const clientIP = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP') || 'unknown';
  const rateLimitOk = await checkUploadRateLimit(db, clientIP);
  if (!rateLimitOk) return c.json({ error: 'Too many uploads. Please try again later.' }, 429);

  const file = formData.get('file');
  if (!file) return c.json({ error: 'No file provided' }, 400);

  const maxSize = (parseInt(settings.share_max_file_size_mb) || 100) * 1024 * 1024;
  if (file.size > maxSize) {
    return c.json({ error: `File exceeds maximum size of ${settings.share_max_file_size_mb}MB` }, 400);
  }

  const maxExpiry = parseInt(settings.share_max_expiry_days) || 30;
  const defaultExpiry = parseInt(settings.share_default_expiry_days) || 7;
  let expiryDays = parseInt(formData.get('expiry_days')) || defaultExpiry;
  if (expiryDays > maxExpiry) expiryDays = maxExpiry;
  if (expiryDays < 1) expiryDays = 1;

  const password = formData.get('password') || null;

  const account = await selectShareAccount(db, file.size);
  if (!account) {
    return c.json({ error: 'No storage space available' }, 507);
  }

  const buffer = await file.arrayBuffer();
  const driveFile = await uploadFile(c.env, db, account.id, settings.share_folder_id, buffer, {
    name: file.name,
    type: file.type || 'application/octet-stream'
  });

  const shareId = generateShareId();
  const passwordHash = password ? await hashPassword(password) : null;
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);

  await db.prepare(
    `INSERT INTO shared_files (share_id, file_name, file_size, mime_type, drive_file_id, account_id, password_hash, expiry_days, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(shareId, file.name, file.size, file.type || 'application/octet-stream', driveFile.id, account.id, passwordHash, expiryDays, expiresAt).run();

  await logSystem(db, 'info', 'File shared', `${file.name} (${shareId})`);

  broadcast('share-created', {
    id: null,
    shareId,
    fileName: file.name,
    fileSize: file.size,
    hasPassword: !!password,
    expiryDays,
    expiresAt,
    downloadCount: 0,
    lastAccessedAt: null,
    createdAt: new Date().toISOString().replace('T', ' ').slice(0, 19)
  });

  // Lazy cleanup
  cleanupExpiredShares(c.env, db, 5).catch(() => {});

  return c.json({
    shareId,
    fileName: file.name,
    fileSize: file.size,
    expiresAt,
    hasPassword: !!password
  });
});

sharePublic.get('/:shareId', async (c) => {
  const db = c.get('db');
  const shareId = c.req.param('shareId');

  const file = await db.prepare('SELECT * FROM shared_files WHERE share_id = ?').bind(shareId).first();
  if (!file) return c.json({ error: 'Share not found' }, 404);

  if (new Date(file.expires_at) < new Date()) {
    try { await permanentDeleteFile(c.env, db, file.account_id, file.drive_file_id); } catch {}
    await db.prepare('DELETE FROM shared_files WHERE id = ?').bind(file.id).run();
    broadcast('share-deleted', { shareId });
    return c.json({ error: 'Share has expired' }, 410);
  }

  return c.json({
    shareId: file.share_id,
    fileName: file.file_name,
    fileSize: file.file_size,
    mimeType: file.mime_type,
    hasPassword: !!file.password_hash,
    expiresAt: file.expires_at,
    downloadCount: file.download_count,
    createdAt: file.created_at
  });
});

sharePublic.post('/:shareId/verify', async (c) => {
  const db = c.get('db');
  const shareId = c.req.param('shareId');

  const file = await db.prepare('SELECT * FROM shared_files WHERE share_id = ?').bind(shareId).first();
  if (!file) return c.json({ error: 'Share not found' }, 404);

  if (new Date(file.expires_at) < new Date()) {
    return c.json({ error: 'Share has expired' }, 410);
  }

  if (!file.password_hash) {
    return c.json({ verified: true });
  }

  const body = await c.req.json();
  if (!body.password) {
    return c.json({ error: 'Password required' }, 401);
  }

  const valid = await verifyPassword(body.password, file.password_hash);
  if (!valid) {
    return c.json({ error: 'Invalid password' }, 401);
  }

  return c.json({ verified: true });
});

sharePublic.get('/:shareId/download', async (c) => {
  const db = c.get('db');
  const shareId = c.req.param('shareId');

  const file = await db.prepare('SELECT * FROM shared_files WHERE share_id = ?').bind(shareId).first();
  if (!file) return c.json({ error: 'Share not found' }, 404);

  if (new Date(file.expires_at) < new Date()) {
    try { await permanentDeleteFile(c.env, db, file.account_id, file.drive_file_id); } catch {}
    await db.prepare('DELETE FROM shared_files WHERE id = ?').bind(file.id).run();
    broadcast('share-deleted', { shareId });
    return c.json({ error: 'Share has expired' }, 410);
  }

  if (file.password_hash) {
    const pw = c.req.query('pw');
    if (!pw) return c.json({ error: 'Password required' }, 401);
    const valid = await verifyPassword(pw, file.password_hash);
    if (!valid) return c.json({ error: 'Invalid password' }, 401);
  }

  const { metadata, body } = await downloadFile(c.env, db, file.account_id, file.drive_file_id);

  // Reset expiry to original duration from now
  const newExpiresAt = new Date(Date.now() + file.expiry_days * 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
  await db.prepare(
    'UPDATE shared_files SET download_count = download_count + 1, last_accessed_at = datetime(\'now\'), expires_at = ? WHERE id = ?'
  ).bind(newExpiresAt, file.id).run();

  broadcast('share-downloaded', { shareId, downloadCount: file.download_count + 1, expiresAt: newExpiresAt });

  return new Response(body, {
    headers: {
      'Content-Type': file.mime_type || 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.file_name)}"`,
      ...(metadata.size ? { 'Content-Length': metadata.size } : {})
    }
  });
});

// Admin routes (mounted under /api/share, auth applied by app.js)
const shareAdmin = new Hono();

shareAdmin.get('/events', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user) || requirePermission(c, user, 'share:view');
  if (err) return err;

  const stream = new ReadableStream({
    start(controller) {
      const id = addClient(controller);
      controller.enqueue(new TextEncoder().encode(`: connected\n\n`));

      c.req.raw.signal.addEventListener('abort', () => {
        removeClient(id);
      });
    },
    cancel() {}
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    }
  });
});

shareAdmin.get('/list', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user) || requirePermission(c, user, 'share:view');
  if (err) return err;

  const db = c.get('db');
  const page = parseInt(c.req.query('page')) || 1;
  const limit = parseInt(c.req.query('limit')) || 50;
  const offset = (page - 1) * limit;

  const { results } = await db.prepare(
    'SELECT * FROM shared_files ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(limit, offset).all();

  const countRow = await db.prepare('SELECT COUNT(*) as total FROM shared_files').first();

  return c.json({
    shares: results.map(f => ({
      id: f.id,
      shareId: f.share_id,
      fileName: f.file_name,
      fileSize: f.file_size,
      hasPassword: !!f.password_hash,
      expiryDays: f.expiry_days,
      expiresAt: f.expires_at,
      downloadCount: f.download_count,
      lastAccessedAt: f.last_accessed_at,
      createdAt: f.created_at
    })),
    total: countRow?.total || 0,
    page,
    limit
  });
});

shareAdmin.delete('/:shareId', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user) || requirePermission(c, user, 'share:manage');
  if (err) return err;

  const db = c.get('db');
  const shareId = c.req.param('shareId');

  const file = await db.prepare('SELECT * FROM shared_files WHERE share_id = ?').bind(shareId).first();
  if (!file) return c.json({ error: 'Share not found' }, 404);

  try { await permanentDeleteFile(c.env, db, file.account_id, file.drive_file_id); } catch {}
  await db.prepare('DELETE FROM shared_files WHERE id = ?').bind(file.id).run();

  broadcast('share-deleted', { shareId });
  await logSystem(db, 'info', 'Shared file deleted', `${file.file_name} (${shareId})`);
  return c.json({ success: true });
});

shareAdmin.get('/settings', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user) || requirePermission(c, user, 'share:settings');
  if (err) return err;

  const db = c.get('db');
  const settings = await getShareSettings(db);
  return c.json(settings);
});

shareAdmin.put('/settings', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user) || requirePermission(c, user, 'share:settings');
  if (err) return err;

  const db = c.get('db');
  const body = await c.req.json();
  const allowed = ['share_enabled', 'share_folder_id', 'share_default_expiry_days', 'share_max_expiry_days', 'share_max_file_size_mb', 'share_cleanup_interval_minutes'];

  for (const [key, value] of Object.entries(body)) {
    if (allowed.includes(key)) {
      await db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(key, String(value)).run();
    }
  }

  return c.json({ success: true });
});

shareAdmin.post('/cleanup', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user) || requirePermission(c, user, 'share:manage');
  if (err) return err;

  const db = c.get('db');
  const count = await cleanupExpiredShares(c.env, db);
  return c.json({ cleaned: count });
});

shareAdmin.get('/accounts', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user) || requirePermission(c, user, 'share:settings');
  if (err) return err;

  const db = c.get('db');
  const { results: accounts } = await db.prepare(
    'SELECT id, email, display_name, is_primary, storage_limit, storage_used, card_color FROM accounts ORDER BY is_primary DESC, email ASC'
  ).all();

  const setting = await db.prepare("SELECT value FROM settings WHERE key = 'share_allowed_accounts'").first();
  let allowedIds = [];
  if (setting?.value) {
    try { allowedIds = JSON.parse(setting.value); } catch {}
  }

  return c.json({
    accounts: accounts.map(a => ({
      id: a.id,
      email: a.email,
      displayName: a.display_name,
      isPrimary: !!a.is_primary,
      storageLimit: a.storage_limit,
      storageUsed: a.storage_used,
      cardColor: a.card_color,
      shareEnabled: allowedIds.length === 0 || allowedIds.includes(a.id)
    })),
    allowedIds
  });
});

shareAdmin.put('/accounts', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user) || requirePermission(c, user, 'share:settings');
  if (err) return err;

  const db = c.get('db');
  const body = await c.req.json();
  const allowedIds = body.allowedIds || [];

  await db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('share_allowed_accounts', ?)")
    .bind(JSON.stringify(allowedIds)).run();

  await logSystem(db, 'info', 'Share accounts updated', `Allowed accounts: ${allowedIds.length === 0 ? 'all' : allowedIds.join(', ')}`);
  return c.json({ success: true });
});

export { sharePublic, shareAdmin };
