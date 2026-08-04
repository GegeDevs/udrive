import { Hono } from 'hono';
import { getStorageQuota, shareFolder } from '../services/google-drive.js';

const CARD_COLORS = [
  '#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01',
  '#46BDC6', '#7BAAF7', '#F07B72', '#FCD04F', '#57BB8A',
  '#FF8BCB', '#A142F4', '#24C1E0', '#E37400', '#5F6368',
  '#1A73E8', '#D93025', '#F9AB00', '#1E8E3E', '#E8710A',
  '#129EAF', '#4ECDE6', '#EE675C', '#FDD663', '#81C995',
  '#FF63B8', '#9334E6', '#12B5CB', '#FA903E', '#BDC1C6'
];

function getUniqueColor(usedColors) {
  const available = CARD_COLORS.filter(c => !usedColors.includes(c));
  if (available.length > 0) return available[Math.floor(Math.random() * available.length)];
  let color;
  do { color = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0'); } while (usedColors.includes(color));
  return color;
}

// Build the OAuth redirect URI from the domain the user is currently browsing,
// so GOOGLE_REDIRECT_URI no longer needs to be configured per deployment.
// Respects reverse-proxy headers (Caddy/nginx terminate TLS, so the internal
// scheme would otherwise look like http while the public origin is https).
function getRedirectUri(c) {
  const fwdProto = (c.req.header('x-forwarded-proto') || '').split(',')[0].trim();
  const fwdHost = (c.req.header('x-forwarded-host') || '').split(',')[0].trim();
  const proto = fwdProto || (c.req.url.startsWith('https://') ? 'https' : 'http');
  const host = fwdHost || c.req.header('host');
  if (host) return `${proto}://${host}/auth/callback`;
  return c.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/callback';
}

const auth = new Hono();

auth.get('/login', async (c) => {
  const env = c.env;
  const scope = encodeURIComponent('https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile');
  const url = `https://accounts.google.com/o/oauth2/auth?client_id=${env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(getRedirectUri(c))}&response_type=code&scope=${scope}&access_type=offline&prompt=consent`;
  return c.redirect(url);
});

auth.get('/callback', async (c) => {
  const env = c.env;
  const db = c.get("db");
  const code = c.req.query('code');
  if (!code) return c.json({ error: 'No code provided' }, 400);

  // Exchange code for tokens
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: getRedirectUri(c),
      grant_type: 'authorization_code'
    })
  });

  if (!tokenRes.ok) return c.json({ error: 'Token exchange failed' }, 400);
  const tokens = await tokenRes.json();

  // Get user info
  const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  const userInfo = await userInfoRes.json();

  const tokenExpiry = Date.now() + (tokens.expires_in * 1000);
  const existing = await db.prepare('SELECT id FROM accounts WHERE email = ?').bind(userInfo.email).first();

  if (existing) {
    await db.prepare("UPDATE accounts SET access_token = ?, refresh_token = ?, token_expiry = ?, display_name = ?, updated_at = datetime('now') WHERE email = ?")
      .bind(tokens.access_token, tokens.refresh_token, tokenExpiry, userInfo.name, userInfo.email).run();
  } else {
    const countRow = await db.prepare('SELECT COUNT(*) as count FROM accounts').first();
    const isPrimary = countRow.count === 0 ? 1 : 0;

    const { results: usedRows } = await db.prepare("SELECT card_color FROM accounts WHERE card_color != '' AND card_color IS NOT NULL").all();
    const usedColors = usedRows.map(r => r.card_color);
    const cardColor = getUniqueColor(usedColors);

    await db.prepare('INSERT INTO accounts (email, display_name, access_token, refresh_token, token_expiry, is_primary, card_color) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(userInfo.email, userInfo.name, tokens.access_token, tokens.refresh_token, tokenExpiry, isPrimary, cardColor).run();

    // Auto-share folder
    const folderSetting = await db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").first();
    if (folderSetting?.value && !isPrimary) {
      const primary = await db.prepare('SELECT id FROM accounts WHERE is_primary = 1').first();
      if (primary) {
        try { await shareFolder(env, db, primary.id, folderSetting.value, userInfo.email); } catch {}
      }
    }
  }

  // Update storage quota
  const account = await db.prepare('SELECT * FROM accounts WHERE email = ?').bind(userInfo.email).first();
  try {
    const quota = await getStorageQuota(env, db, account.id);
    await db.prepare('UPDATE accounts SET storage_limit = ?, storage_used = ? WHERE id = ?').bind(quota.limit, quota.used, account.id).run();
  } catch {}

  return c.redirect('/#/accounts');
});

export default auth;
