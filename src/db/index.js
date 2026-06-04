import { createLocalDB } from './local.js';

let db = null;

export function getDB(env) {
  if (env?.DB) return env.DB;
  if (!db) db = createLocalDB();
  return db;
}

export async function initDB(db) {
  db.exec(`
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
    INSERT OR IGNORE INTO settings (key, value) VALUES ('share_allowed_accounts', '[]');
    INSERT OR IGNORE INTO settings (key, value) VALUES ('share_cleanup_interval_minutes', '60');

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
  `);

  // Migrations for existing databases
  try { await db.prepare('SELECT card_color FROM accounts LIMIT 0').all(); } catch { db.exec("ALTER TABLE accounts ADD COLUMN card_color TEXT DEFAULT ''"); }
  try { await db.prepare('SELECT session_timeout_hours FROM users LIMIT 0').all(); } catch { db.exec("ALTER TABLE users ADD COLUMN session_timeout_hours INTEGER DEFAULT 24"); }
  try { await db.prepare('SELECT file_count FROM accounts LIMIT 0').all(); } catch { db.exec("ALTER TABLE accounts ADD COLUMN file_count INTEGER DEFAULT 0"); }

  // Migrate old permission format to new
  migratePermissions(db);
}

function migratePermissions(db) {
  const OLD_TO_NEW = {
    'page:drive': ['drive:upload', 'drive:download_browser', 'drive:download_background', 'drive:delete', 'drive:rename', 'drive:create_folder', 'drive:move', 'drive:copy', 'drive:preview'],
    'page:trash': ['trash:view', 'trash:restore', 'trash:permanent_delete', 'trash:empty'],
    'page:accounts': ['accounts:view', 'accounts:add', 'accounts:remove', 'accounts:set_primary', 'accounts:refresh', 'accounts:import_export', 'accounts:color'],
    'page:settings': ['settings:view', 'settings:edit', 'settings:keepalive', 'settings:database'],
    'action:upload': ['drive:upload'],
    'action:download': ['drive:download_browser', 'drive:download_background'],
    'action:delete': ['drive:delete'],
    'action:create_folder': ['drive:create_folder'],
    'action:rename': ['drive:rename'],
    'action:move': ['drive:move'],
    'action:copy': ['drive:copy'],
    'action:restore': ['trash:restore'],
    'action:permanent_delete': ['trash:permanent_delete'],
    'action:manage_accounts': ['accounts:view', 'accounts:add', 'accounts:remove', 'accounts:set_primary', 'accounts:refresh'],
    'action:import_export': ['accounts:import_export']
  };

  const oldPerms = db.prepare("SELECT * FROM user_permissions WHERE permission LIKE 'page:%' OR permission LIKE 'action:%'").all();
  if (oldPerms.results && oldPerms.results.length > 0) {
    for (const row of oldPerms.results) {
      const newPerms = OLD_TO_NEW[row.permission];
      if (newPerms) {
        for (const np of newPerms) {
          db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?, ?)').bind(row.user_id, np).run();
        }
      }
      db.prepare('DELETE FROM user_permissions WHERE id = ?').bind(row.id).run();
    }
  }
}
