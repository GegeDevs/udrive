// Share cleanup scheduler. Mirrors the keep-alive scheduler pattern:
// - chained setTimeout (never overlapping runs)
// - re-reads the interval from the DB on every cycle, so changing
//   share_cleanup_interval_minutes in the File Share settings takes effect
//   immediately without a server restart (rescheduleShareCleanupScheduler
//   is called from the settings route for instant effect)
// - OAuth credentials resolved fresh from the DB (settings win over .env)
import { cleanupExpiredShares } from './share-cleanup.js';
import { getGoogleOAuthEnv } from './app-config.js';

const INTERVAL_KEY = 'share_cleanup_interval_minutes';

let timer = null;
let dbRef = null;

async function getIntervalMinutes() {
  const row = await dbRef.prepare(`SELECT value FROM settings WHERE key = '${INTERVAL_KEY}'`).first();
  const n = parseInt(row?.value) || 60;
  return n > 0 ? n : 60; // invalid/zero/negative -> default 60
}

async function run() {
  try {
    const env = await getGoogleOAuthEnv(dbRef);
    const count = await cleanupExpiredShares(env, dbRef);
    if (count > 0) console.log(`Share cleanup: removed ${count} file(s)`);
  } catch (err) {
    console.error('Share cleanup failed:', err.message);
  }
}

async function scheduleNext() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dbRef) return;

  const minutes = await getIntervalMinutes();
  console.log(`Share cleanup scheduler: next run in ${minutes} minute(s)`);

  timer = setTimeout(async () => {
    timer = null;
    await run();
    // Re-read the interval from the DB so changes apply without restart.
    await scheduleNext();
  }, minutes * 60 * 1000);
}

export function initShareCleanupScheduler(db) {
  dbRef = db;
  return (async () => {
    await run(); // run once immediately at startup
    await scheduleNext();
  })();
}

export async function rescheduleShareCleanupScheduler() {
  if (!dbRef) return; // scheduler not initialized (route called outside local.js)
  return scheduleNext();
}
