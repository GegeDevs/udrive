import { Router } from 'express';
import { google } from 'googleapis';
import { getOAuth2Client } from '../services/token-manager.js';
import { getStorageQuota, shareFolder } from '../services/google-drive.js';
import db from '../db/init.js';

const CARD_COLORS = [
  '#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01',
  '#46BDC6', '#7BAAF7', '#F07B72', '#FCD04F', '#57BB8A',
  '#FF8BCB', '#A142F4', '#24C1E0', '#E37400', '#5F6368',
  '#1A73E8', '#D93025', '#F9AB00', '#1E8E3E', '#E8710A',
  '#129EAF', '#4ECDE6', '#EE675C', '#FDD663', '#81C995',
  '#FF63B8', '#9334E6', '#12B5CB', '#FA903E', '#BDC1C6'
];

function getUniqueColor() {
  const usedColors = db.prepare("SELECT card_color FROM accounts WHERE card_color != '' AND card_color IS NOT NULL").all().map(r => r.card_color);
  const available = CARD_COLORS.filter(c => !usedColors.includes(c));
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)];
  }
  // Fallback: generate random hex that's not in use
  let color;
  do {
    color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
  } while (usedColors.includes(color));
  return color;
}

const router = Router();

router.get('/login', (req, res) => {
  const client = getOAuth2Client();
  const url = client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ]
  });
  res.redirect(url);
});

router.get('/callback', async (req, res, next) => {
  try {
    const { code } = req.query;
    if (!code) throw Object.assign(new Error('No code provided'), { status: 400 });

    const client = getOAuth2Client();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data: userInfo } = await oauth2.userinfo.get();

    const existing = db.prepare('SELECT id FROM accounts WHERE email = ?').get(userInfo.email);

    if (existing) {
      db.prepare(`
        UPDATE accounts SET access_token = ?, refresh_token = ?, token_expiry = ?, display_name = ?, updated_at = datetime('now')
        WHERE email = ?
      `).run(tokens.access_token, tokens.refresh_token, tokens.expiry_date, userInfo.name, userInfo.email);
    } else {
      const accountCount = db.prepare('SELECT COUNT(*) as count FROM accounts').get().count;
      const isPrimary = accountCount === 0 ? 1 : 0;

      db.prepare(`
        INSERT INTO accounts (email, display_name, access_token, refresh_token, token_expiry, is_primary, card_color)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userInfo.email, userInfo.name, tokens.access_token, tokens.refresh_token, tokens.expiry_date, isPrimary, getUniqueColor());

      // Auto-share folder with new account if shared_folder_id is set
      const folderSetting = db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").get();
      if (folderSetting && folderSetting.value && !isPrimary) {
        const primary = db.prepare('SELECT id FROM accounts WHERE is_primary = 1').get();
        if (primary) {
          try {
            await shareFolder(primary.id, folderSetting.value, userInfo.email);
          } catch (e) {
            console.error('Auto-share failed:', e.message);
          }
        }
      }
    }

    // Update storage quota
    const account = db.prepare('SELECT * FROM accounts WHERE email = ?').get(userInfo.email);
    try {
      const quota = await getStorageQuota(account.id);
      db.prepare('UPDATE accounts SET storage_limit = ?, storage_used = ? WHERE id = ?')
        .run(quota.limit, quota.used, account.id);
    } catch (e) {
      console.error('Failed to get quota:', e.message);
    }

    res.redirect('/#/accounts');
  } catch (err) {
    next(err);
  }
});

export default router;
