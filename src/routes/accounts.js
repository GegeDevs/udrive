import { Hono } from 'hono';
import { getStorageQuota, shareFolder, cleanAllFiles, findSharedFolderOwner, cleanSharedFolderContents } from '../services/google-drive.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { logActivity, logSystem } from '../services/logger.js';

const accounts = new Hono();

const CARD_COLORS = [
  '#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01',
  '#46BDC6', '#7BAAF7', '#F07B72', '#FCD04F', '#57BB8A',
  '#FF8BCB', '#A142F4', '#24C1E0', '#E37400', '#5F6368',
  '#1A73E8', '#D93025', '#F9AB00', '#1E8E3E', '#E8710A',
  '#129EAF', '#4ECDE6', '#EE675C', '#FDD663', '#81C995',
  '#FF63B8', '#9334E6', '#12B5CB', '#FA903E', '#BDC1C6'
];

function parseRcloneConfig(content) {
  const accounts = [];
  const sections = content.split(/^\[(.+)\]$/gm);
  for (let i = 1; i < sections.length; i += 2) {
    const name = sections[i].trim();
    const body = sections[i + 1] || '';
    const typeMatch = body.match(/^type\s*=\s*(.+)$/m);
    if (!typeMatch || typeMatch[1].trim() !== 'drive') continue;
    const tokenMatch = body.match(/^token\s*=\s*(.+)$/m);
    if (!tokenMatch) continue;
    let token;
    try { token = JSON.parse(tokenMatch[1].trim()); } catch { continue; }
    if (!token.access_token || !token.refresh_token) continue;
    accounts.push({
      name,
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_expiry: token.expiry ? new Date(token.expiry).getTime() : Date.now()
    });
  }
  return accounts;
}

accounts.post('/import-rclone/parse', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'accounts:import_export');
  if (err) return err;

  const formData = await c.req.formData();
  const file = formData.get('config');
  if (!file) return c.json({ error: 'No config file provided' }, 400);

  const content = await file.text();
  const parsed = parseRcloneConfig(content);
  if (parsed.length === 0) return c.json({ error: 'No Google Drive accounts found in config' }, 400);
  return c.json(parsed);
});

accounts.post('/import-rclone/import', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'accounts:import_export');
  if (err) return err;

  const db = c.get("db");
  const { accounts: accs } = await c.req.json();
  if (!accs || !Array.isArray(accs) || accs.length === 0) return c.json({ error: 'No accounts provided' }, 400);

  const imported = [];
  const folderSetting = await db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").first();
  const primary = await db.prepare('SELECT id FROM accounts WHERE is_primary = 1').first();

  for (const acc of accs) {
    const existing = await db.prepare('SELECT id FROM accounts WHERE email = ?').bind(acc.email || acc.name).first();
    if (existing) continue;

    const countRow = await db.prepare('SELECT COUNT(*) as count FROM accounts').first();
    const isPrimary = countRow.count === 0 ? 1 : 0;

    await db.prepare('INSERT INTO accounts (email, display_name, access_token, refresh_token, token_expiry, is_primary) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(acc.email || acc.name, acc.name, acc.access_token, acc.refresh_token, acc.token_expiry, isPrimary).run();

    if (folderSetting?.value && !isPrimary && primary) {
      try { await shareFolder(c.env, db, primary.id, folderSetting.value, acc.email || acc.name); } catch {}
    }
    imported.push(acc.name);
  }

  return c.json({ success: true, imported });
});

accounts.post('/export-rclone', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'accounts:import_export');
  if (err) return err;

  const db = c.get("db");
  const { accountIds } = await c.req.json();
  if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) return c.json({ error: 'No accounts selected' }, 400);

  const placeholders = accountIds.map(() => '?').join(',');
  const { results } = await db.prepare(`SELECT * FROM accounts WHERE id IN (${placeholders})`).bind(...accountIds).all();
  if (results.length === 0) return c.json({ error: 'No accounts found' }, 404);

  let config = '';
  for (const acc of results) {
    const name = (acc.display_name || acc.email).replace(/[^a-zA-Z0-9_-]/g, '_');
    const token = JSON.stringify({
      access_token: acc.access_token,
      token_type: 'Bearer',
      refresh_token: acc.refresh_token,
      expiry: new Date(acc.token_expiry).toISOString()
    });
    config += `[${name}]\n`;
    config += `type = drive\n`;
    config += `client_id = ${c.env.GOOGLE_CLIENT_ID}\n`;
    config += `client_secret = ${c.env.GOOGLE_CLIENT_SECRET}\n`;
    config += `scope = drive\n`;
    config += `token = ${token}\n\n`;
  }

  return c.json({ config });
});

accounts.post('/clean-all', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'accounts:clean_all');
  if (err) return err;

  const db = c.get("db");
  const body = await c.req.json();
  if (body.confirmation !== 'CLEAN ALL') {
    return c.json({ error: 'Invalid confirmation' }, 400);
  }

  // Scope is based on who owns the shared folder:
  // - the owner account only has the files INSIDE the shared folder deleted
  // - every other account has ALL of its files deleted
  const folderRow = await db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").first();
  const sharedFolderId = folderRow?.value?.trim();
  if (!sharedFolderId) {
    return c.json({ error: 'Shared folder ID is not set. Configure it in Settings first.' }, 400);
  }

  // Find the account that owns the shared folder; fall back to the primary
  // account when it cannot be determined so its personal files stay safe.
  let ownerAccountId = await findSharedFolderOwner(c.env, db, sharedFolderId);
  if (!ownerAccountId) {
    const primary = await db.prepare('SELECT id FROM accounts WHERE is_primary = 1').first();
    if (primary) ownerAccountId = primary.id;
  }
  const ownerAcc = ownerAccountId
    ? await db.prepare('SELECT email FROM accounts WHERE id = ?').bind(ownerAccountId).first()
    : null;

  const { results: accounts } = await db.prepare('SELECT id, email FROM accounts ORDER BY created_at ASC').all();
  let totalDeleted = 0;
  let totalFailed = 0;
  const allErrors = [];
  const accountsDetail = [];

  for (const acc of accounts) {
    const isOwner = acc.id === ownerAccountId;
    try {
      const result = isOwner
        ? await cleanSharedFolderContents(c.env, db, acc.id, sharedFolderId)
        : await cleanAllFiles(c.env, db, acc.id);
      totalDeleted += result.deleted;
      totalFailed += result.failed;
      allErrors.push(...result.errors);
      accountsDetail.push({ accountId: acc.id, email: acc.email, mode: isOwner ? 'shared-folder-only' : 'full', deleted: result.deleted, failed: result.failed });

      // Refresh storage quota
      try {
        const quota = await getStorageQuota(c.env, db, acc.id);
        await db.prepare("UPDATE accounts SET storage_limit = ?, storage_used = ?, file_count = ?, updated_at = datetime('now') WHERE id = ?")
          .bind(quota.limit, quota.used, quota.fileCount, acc.id).run();
      } catch {}
    } catch (e) {
      totalFailed++;
      allErrors.push({ accountId: acc.id, error: e.message });
      accountsDetail.push({ accountId: acc.id, email: acc.email, mode: isOwner ? 'shared-folder-only' : 'full', deleted: 0, failed: 1 });
    }
  }

  await logActivity(db, user.id, user.username, 'clean_all', `owner: ${ownerAcc?.email || 'unknown'}, ${totalDeleted} deleted, ${totalFailed} failed`);

  return c.json({
    success: true,
    sharedFolderId,
    ownerAccountId,
    ownerEmail: ownerAcc?.email || null,
    accountsProcessed: accounts.length,
    deleted: totalDeleted,
    failed: totalFailed,
    accounts: accountsDetail,
    errors: allErrors.slice(0, 10)
  });
});

accounts.get('/', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'accounts:view');
  if (err) return err;

  const db = c.get("db");

  // Auto-assign colors
  const { results: noColor } = await db.prepare("SELECT id FROM accounts WHERE card_color = '' OR card_color IS NULL").all();
  if (noColor.length > 0) {
    const { results: usedRows } = await db.prepare("SELECT card_color FROM accounts WHERE card_color != '' AND card_color IS NOT NULL").all();
    const usedColors = usedRows.map(r => r.card_color);
    const available = CARD_COLORS.filter(c => !usedColors.includes(c));

    for (const acc of noColor) {
      let color;
      if (available.length > 0) {
        color = available.splice(Math.floor(Math.random() * available.length), 1)[0];
      } else {
        do { color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'); } while (usedColors.includes(color));
      }
      await db.prepare('UPDATE accounts SET card_color = ? WHERE id = ?').bind(color, acc.id).run();
      usedColors.push(color);
    }
  }

  const { results } = await db.prepare('SELECT id, email, display_name, is_primary, storage_limit, storage_used, file_count, card_color, created_at FROM accounts ORDER BY is_primary DESC, created_at ASC').all();

  const canViewEmail = user.role === 'master' || user.permissions.includes('accounts:view_email');
  const filtered = results.map(acc => {
    if (!canViewEmail) {
      return { ...acc, email: '••••••••' };
    }
    return acc;
  });

  return c.json(filtered);
});

accounts.patch('/:id/color', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'accounts:color');
  if (err) return err;

  const db = c.get("db");
  const id = c.req.param('id');
  const { color } = await c.req.json();
  if (!color) return c.json({ error: 'No color provided' }, 400);

  const existing = await db.prepare('SELECT id FROM accounts WHERE card_color = ? AND id != ?').bind(color, id).first();
  if (existing) return c.json({ error: 'Color already in use' }, 409);

  await db.prepare('UPDATE accounts SET card_color = ? WHERE id = ?').bind(color, id).run();
  return c.json({ success: true });
});

accounts.delete('/:id', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'accounts:remove');
  if (err) return err;

  const db = c.get("db");
  const id = c.req.param('id');
  await db.prepare('DELETE FROM accounts WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

accounts.post('/:id/primary', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'accounts:set_primary');
  if (err) return err;

  const db = c.get("db");
  const id = c.req.param('id');
  await db.prepare('UPDATE accounts SET is_primary = 0').run();
  await db.prepare('UPDATE accounts SET is_primary = 1 WHERE id = ?').bind(id).run();

  // Auto-share shared folder from new primary to all other accounts
  const folderRow = await db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").first();
  if (folderRow?.value) {
    const { results: nonPrimary } = await db.prepare('SELECT id, email FROM accounts WHERE is_primary = 0').all();
    for (const acc of nonPrimary) {
      try { await shareFolder(c.env, db, parseInt(id), folderRow.value, acc.email); } catch {}
    }
    if (nonPrimary.length > 0) {
      await logSystem(db, 'info', 'Auto-shared folder from new primary', `primary: ${id}, folder: ${folderRow.value}, accounts: ${nonPrimary.length}`);
    }
  }

  return c.json({ success: true });
});

accounts.get('/:id/storage', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'accounts:refresh');
  if (err) return err;

  const db = c.get("db");
  const id = c.req.param('id');
  const quota = await getStorageQuota(c.env, db, parseInt(id));
  await db.prepare("UPDATE accounts SET storage_limit = ?, storage_used = ?, file_count = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(quota.limit, quota.used, quota.fileCount, id).run();
  return c.json(quota);
});

export default accounts;
