import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { createApp } from './app.js';
import { getDB, initDB } from './db/index.js';
import { runKeepAlive } from './services/keep-alive.js';
import { cleanupExpiredShares } from './services/share-cleanup.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '..', 'dist');

// Init DB
const db = getDB();
await initDB(db);

// Create app with env injection
const envVars = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || '',
  TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || ''
};

const app = createApp(() => db, envVars);

// Serve static files in production
if (existsSync(join(distPath, 'index.html'))) {
  app.use('/*', serveStatic({ root: './dist' }));
  app.get('*', (c) => {
    const html = readFileSync(join(distPath, 'index.html'), 'utf-8');
    return c.html(html);
  });
}

const port = parseInt(process.env.PORT || '3000');

serve({ fetch: app.fetch, port }, () => {
  console.log(`UDrive server running on http://localhost:${port}`);
});

// Keep-alive scheduler
const setting = await db.prepare("SELECT value FROM settings WHERE key = 'keepalive_interval_days'").first();
const days = setting ? parseInt(setting.value) : 0;
if (days > 0) {
  const env = { GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET };
  setInterval(() => runKeepAlive(env, db), days * 24 * 60 * 60 * 1000);
  console.log(`Keep-alive scheduler started: every ${days} day(s)`);
}

// Share cleanup scheduler (configurable interval)
const shareEnv = { GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET };
const cleanupSetting = await db.prepare("SELECT value FROM settings WHERE key = 'share_cleanup_interval_minutes'").first();
const cleanupMinutes = Math.max(1, parseInt(cleanupSetting?.value) || 60);
cleanupExpiredShares(shareEnv, db)
  .then(count => { if (count > 0) console.log(`Share cleanup (initial): removed ${count} expired file(s)`); })
  .catch(() => {});
setInterval(() => {
  cleanupExpiredShares(shareEnv, db)
    .then(count => { if (count > 0) console.log(`Share cleanup (scheduled): removed ${count} expired file(s)`); })
    .catch(() => {});
}, cleanupMinutes * 60 * 1000);
console.log(`Share cleanup scheduler started: every ${cleanupMinutes} minute(s)`);
