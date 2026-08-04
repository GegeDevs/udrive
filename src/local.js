import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { createApp } from './app.js';
import { getDB, initDB } from './db/index.js';
import { initKeepAliveScheduler } from './services/keep-alive-scheduler.js';
import { cleanupExpiredShares } from './services/share-cleanup.js';
import { getGoogleOAuthEnv } from './services/app-config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distPath = join(__dirname, '..', 'dist');

// Init DB
const db = getDB();
await initDB(db);

// Create app with env injection
const envVars = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
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

// Keep-alive scheduler (dynamic: re-reads interval from DB on every cycle,
// and is rescheduled immediately when the setting changes via the API)
// OAuth credentials are resolved fresh from the DB on every run.
initKeepAliveScheduler(db, {});

// Share cleanup scheduler (configurable interval); OAuth credentials resolved
// fresh from the DB (settings win over .env) on every cycle
const cleanupSetting = await db.prepare("SELECT value FROM settings WHERE key = 'share_cleanup_interval_minutes'").first();
const cleanupMinutes = Math.max(1, parseInt(cleanupSetting?.value) || 60);
const runShareCleanup = async () => {
  try {
    const env = await getGoogleOAuthEnv(db);
    const count = await cleanupExpiredShares(env, db);
    if (count > 0) console.log(`Share cleanup: removed ${count} expired file(s)`);
  } catch (err) {
    console.error('Share cleanup failed:', err.message);
  }
};
await runShareCleanup();
setInterval(runShareCleanup, cleanupMinutes * 60 * 1000);
console.log(`Share cleanup scheduler started: every ${cleanupMinutes} minute(s)`);
