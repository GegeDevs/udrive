import { createApp } from './app.js';
import { runKeepAlive } from './services/keep-alive.js';
import { cleanupExpiredShares } from './services/share-cleanup.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    token_expiry INTEGER NOT NULL,
    is_primary INTEGER DEFAULT 0,
    storage_limit INTEGER DEFAULT 16106127360,
    storage_used INTEGER DEFAULT 0,
    file_count INTEGER DEFAULT 0,
    card_color TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('shared_folder_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('theme', 'auto');
  CREATE TABLE IF NOT EXISTS file_owners (
    file_id TEXT PRIMARY KEY,
    account_id INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'slave',
    session_timeout_hours INTEGER DEFAULT 24,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS user_permissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    permission TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, permission)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS system_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    detail TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    key_prefix TEXT NOT NULL,
    user_id INTEGER,
    permissions TEXT NOT NULL DEFAULT '[]',
    rate_limit INTEGER DEFAULT 60,
    expires_at TEXT,
    last_used_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS api_rate_limits (
    key_hash TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    request_count INTEGER DEFAULT 0,
    PRIMARY KEY (key_hash, window_start)
  );
  CREATE TABLE IF NOT EXISTS shared_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    share_id TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    mime_type TEXT DEFAULT 'application/octet-stream',
    drive_file_id TEXT NOT NULL,
    account_id INTEGER NOT NULL,
    password_hash TEXT,
    expiry_days INTEGER NOT NULL,
    expires_at TEXT NOT NULL,
    download_count INTEGER DEFAULT 0,
    last_accessed_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );
  INSERT OR IGNORE INTO settings (key, value) VALUES ('share_enabled', '1');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('share_folder_id', '');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('share_default_expiry_days', '7');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('share_max_expiry_days', '30');
  INSERT OR IGNORE INTO settings (key, value) VALUES ('share_max_file_size_mb', '100');
  CREATE TABLE IF NOT EXISTS queue_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT UNIQUE NOT NULL,
    folder_id TEXT NOT NULL,
    folder_name TEXT,
    user_id INTEGER,
    username TEXT,
    status TEXT DEFAULT 'queued',
    total_items INTEGER DEFAULT 0,
    processed_items INTEGER DEFAULT 0,
    failed_items INTEGER DEFAULT 0,
    error_details TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    started_at TEXT,
    completed_at TEXT
  );
`;

let migrated = false;

async function ensureMigrated(db) {
  if (migrated) return;
  const statements = SCHEMA.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const sql of statements) {
    await db.prepare(sql).run();
  }

  // Migrations for existing D1 databases
  const migrations = [
    "ALTER TABLE accounts ADD COLUMN file_count INTEGER DEFAULT 0",
    "ALTER TABLE accounts ADD COLUMN card_color TEXT DEFAULT ''",
    "ALTER TABLE users ADD COLUMN session_timeout_hours INTEGER DEFAULT 24"
  ];
  for (const sql of migrations) {
    try { await db.prepare(sql).run(); } catch {}
  }

  migrated = true;
}

const app = createApp((env) => env.DB);

// Auto-migrate on first request
app.use('*', async (c, next) => {
  await ensureMigrated(c.env.DB);
  await next();
});

// Fallback: let CF Pages handle static files
app.all('*', (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  async scheduled(event, env, ctx) {
    await ensureMigrated(env.DB);
    ctx.waitUntil(runKeepAlive(env, env.DB));
    ctx.waitUntil(cleanupExpiredShares(env, env.DB));
  }
};
