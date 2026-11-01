// Background storage refresh for connected accounts.
// Mirrors the share-cleanup scheduler: chained setTimeout, OAuth credentials
// resolved fresh from the DB, and accounts skipped when they were refreshed in
// the last 10 minutes (manual refresh counts too).
import { getStorageQuota } from './google-drive.js';
import { getGoogleOAuthEnv } from './app-config.js';

const STALE_AFTER_MINUTES = 10;
const INTERVAL_MS = STALE_AFTER_MINUTES * 60 * 1000;

let timer = null;
let dbRef = null;

async function refreshStaleAccounts() {
  if (!dbRef) return;
  const db = dbRef;
  try {
    const { results } = await db
      .prepare(
        `SELECT id, email FROM accounts
         WHERE updated_at IS NULL OR updated_at <= datetime('now', '-${STALE_AFTER_MINUTES} minutes')`
      )
      .all();
    if (!results.length) return;

    const env = await getGoogleOAuthEnv(db);
    let ok = 0;
    for (const acc of results) {
      try {
        const quota = await getStorageQuota(env, db, acc.id);
        await db
          .prepare(
            `UPDATE accounts SET storage_limit = ?, storage_used = ?, file_count = ?, updated_at = datetime('now') WHERE id = ?`
          )
          .bind(quota.limit, quota.used, quota.fileCount, acc.id)
          .run();
        ok++;
      } catch (err) {
        console.error(`Accounts storage refresh failed for ${acc.email}:`, err.message);
      }
    }
    console.log(`Accounts storage: refreshed ${ok}/${results.length} account(s)`);
  } catch (err) {
    console.error('Accounts storage refresh failed:', err.message);
  }
}

function scheduleNext() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    await refreshStaleAccounts();
    scheduleNext();
  }, INTERVAL_MS);
  console.log(`Accounts storage scheduler: next check in ${STALE_AFTER_MINUTES} minute(s)`);
}

export function initAccountsStorageScheduler(db) {
  dbRef = db;
  return (async () => {
    await refreshStaleAccounts();
    scheduleNext();
  })();
}
