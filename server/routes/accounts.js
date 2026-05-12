import { Router } from 'express';
import multer from 'multer';
import db from '../db/init.js';
import { config as appConfig } from '../config.js';
import { getStorageQuota, shareFolder } from '../services/google-drive.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

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
    try {
      token = JSON.parse(tokenMatch[1].trim());
    } catch {
      continue;
    }

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

router.post('/import-rclone/parse', upload.single('config'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No config file provided' });

  const content = req.file.buffer.toString('utf-8');
  const accounts = parseRcloneConfig(content);

  if (accounts.length === 0) {
    return res.status(400).json({ error: 'No Google Drive accounts found in config' });
  }

  res.json(accounts);
});

router.post('/import-rclone/import', async (req, res, next) => {
  try {
    const { accounts } = req.body;
    if (!accounts || !Array.isArray(accounts) || accounts.length === 0) {
      return res.status(400).json({ error: 'No accounts provided' });
    }

    const imported = [];
    const folderSetting = db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").get();
    const primary = db.prepare('SELECT id FROM accounts WHERE is_primary = 1').get();

    for (const acc of accounts) {
      const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(acc.email || acc.name);

      if (existing) continue;

      const accountCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get().count;
      const isPrimary = accountCount === 0 ? 1 : 0;

      db.prepare(`
        INSERT INTO accounts (email, display_name, access_token, refresh_token, token_expiry, is_primary)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        acc.email || acc.name,
        acc.name,
        acc.access_token,
        acc.refresh_token,
        acc.token_expiry,
        isPrimary
      );

      if (folderSetting && folderSetting.value && !isPrimary && primary) {
        try {
          await shareFolder(primary.id, folderSetting.value, acc.email || acc.name);
        } catch (e) {
          // sharing may fail if email is just a name
        }
      }

      imported.push(acc.name);
    }

    res.json({ success: true, imported });
  } catch (err) {
    next(err);
  }
});

router.post('/export-rclone', (req, res) => {
  const { accountIds } = req.body;
  if (!accountIds || !Array.isArray(accountIds) || accountIds.length === 0) {
    return res.status(400).json({ error: 'No accounts selected' });
  }

  const placeholders = accountIds.map(() => '?').join(',');
  const accounts = db.prepare(`SELECT * FROM accounts WHERE id IN (${placeholders})`).all(...accountIds);

  if (accounts.length === 0) {
    return res.status(404).json({ error: 'No accounts found' });
  }

  let config = '';
  for (const acc of accounts) {
    const name = (acc.display_name || acc.email).replace(/[^a-zA-Z0-9_-]/g, '_');
    const token = JSON.stringify({
      access_token: acc.access_token,
      token_type: 'Bearer',
      refresh_token: acc.refresh_token,
      expiry: new Date(acc.token_expiry).toISOString()
    });

    config += `[${name}]\n`;
    config += `type = drive\n`;
    config += `client_id = ${appConfig.google.clientId}\n`;
    config += `client_secret = ${appConfig.google.clientSecret}\n`;
    config += `scope = drive\n`;
    config += `token = ${token}\n`;
    config += `\n`;
  }

  res.json({ config });
});

router.get('/', (req, res) => {
  // Auto-assign unique colors to accounts without one
  const noColor = db.prepare("SELECT id FROM accounts WHERE card_color = '' OR card_color IS NULL").all();
  if (noColor.length > 0) {
    const usedColors = db.prepare("SELECT card_color FROM accounts WHERE card_color != '' AND card_color IS NOT NULL").all().map(r => r.card_color);
    const COLORS = [
      '#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01',
      '#46BDC6', '#7BAAF7', '#F07B72', '#FCD04F', '#57BB8A',
      '#FF8BCB', '#A142F4', '#24C1E0', '#E37400', '#5F6368',
      '#1A73E8', '#D93025', '#F9AB00', '#1E8E3E', '#E8710A',
      '#129EAF', '#4ECDE6', '#EE675C', '#FDD663', '#81C995',
      '#FF63B8', '#9334E6', '#12B5CB', '#FA903E', '#BDC1C6'
    ];
    const available = COLORS.filter(c => !usedColors.includes(c));

    for (const acc of noColor) {
      let color;
      if (available.length > 0) {
        color = available.splice(Math.floor(Math.random() * available.length), 1)[0];
      } else {
        do {
          color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
        } while (usedColors.includes(color));
      }
      db.prepare('UPDATE accounts SET card_color = ? WHERE id = ?').run(color, acc.id);
      usedColors.push(color);
    }
  }

  const accounts = db.prepare('SELECT id, email, display_name, is_primary, storage_limit, storage_used, card_color, created_at FROM accounts ORDER BY is_primary DESC, created_at ASC').all();
  res.json(accounts);
});

router.patch('/:id/color', (req, res) => {
  const { id } = req.params;
  const { color } = req.body;
  if (!color) return res.status(400).json({ error: 'No color provided' });

  const existing = db.prepare('SELECT id FROM accounts WHERE card_color = ? AND id != ?').get(color, id);
  if (existing) return res.status(409).json({ error: 'Color already in use by another account' });

  db.prepare('UPDATE accounts SET card_color = ? WHERE id = ?').run(color, id);
  res.json({ success: true });
});

router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: 'Account not found' });
  db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  res.json({ success: true });
});

router.post('/:id/primary', (req, res) => {
  const { id } = req.params;
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  db.prepare('UPDATE accounts SET is_primary = 0').run();
  db.prepare('UPDATE accounts SET is_primary = 1 WHERE id = ?').run(id);
  res.json({ success: true });
});

router.get('/:id/storage', async (req, res, next) => {
  try {
    const { id } = req.params;
    const quota = await getStorageQuota(parseInt(id));
    db.prepare('UPDATE accounts SET storage_limit = ?, storage_used = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(quota.limit, quota.used, id);
    res.json(quota);
  } catch (err) {
    next(err);
  }
});

export default router;
