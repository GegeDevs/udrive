import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, 'udrive.db');

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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
`);

// Migrations
try {
  db.prepare("SELECT card_color FROM accounts LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE accounts ADD COLUMN card_color TEXT DEFAULT ''");
}

try {
  db.prepare("SELECT session_timeout_hours FROM users LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE users ADD COLUMN session_timeout_hours INTEGER DEFAULT 24");
}

db.exec("UPDATE accounts SET card_color = '' WHERE card_color IS NULL");

export default db;
