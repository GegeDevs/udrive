import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', '..', 'data');
const dbPath = join(dataDir, 'udrive.db');

mkdirSync(dataDir, { recursive: true });

const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export function createLocalDB() {
  return {
    prepare(sql) {
      const stmt = sqlite.prepare(sql);
      return {
        bind(...args) {
          return {
            first() { return Promise.resolve(stmt.get(...args) || null); },
            all() { return Promise.resolve({ results: stmt.all(...args) }); },
            run() {
              const info = stmt.run(...args);
              return Promise.resolve({ meta: { last_row_id: info.lastInsertRowid, changes: info.changes } });
            }
          };
        },
        first() { return Promise.resolve(stmt.get() || null); },
        all() { return Promise.resolve({ results: stmt.all() }); },
        run() {
          const info = stmt.run();
          return Promise.resolve({ meta: { last_row_id: info.lastInsertRowid, changes: info.changes } });
        }
      };
    },
    exec(sql) { sqlite.exec(sql); return Promise.resolve(); }
  };
}
