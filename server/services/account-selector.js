import db from '../db/init.js';

export function selectAccount(fileSize) {
  const accounts = db.prepare('SELECT * FROM accounts WHERE is_primary = 0 ORDER BY (storage_limit - storage_used) DESC').all();

  for (const account of accounts) {
    const available = account.storage_limit - account.storage_used;
    if (available >= fileSize) {
      return account;
    }
  }

  return null;
}
