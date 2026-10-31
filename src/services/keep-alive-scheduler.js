import { runKeepAlive } from './keep-alive.js';
import { logSystem } from './logger.js';
import { getGoogleOAuthEnv } from './app-config.js';

const WEEKDAY_KEY = 'keepalive_days';
// Index aligned with Date.getDay(): 0 = Sunday ... 6 = Saturday
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_MS = 24 * 60 * 60 * 1000;

let timer = null;
let dbRef = null;
let envRef = null;

// Parse "mon,wed,fri" (case-insensitive, deduped). Returns [] when empty/invalid.
export function parseWeekdays(value) {
  if (!value) return [];
  const seen = new Set();
  for (const part of String(value).split(',')) {
    const d = part.trim().toLowerCase();
    if (WEEKDAYS.includes(d)) seen.add(d);
  }
  return [...seen];
}

// Delay (ms) until the next occurrence of any listed weekday, strictly after
// `from`. Always 1-7 days. Returns null for an empty list.
export function nextWeekdayDelay(days, from = new Date()) {
  if (!days || days.length === 0) return null;
  const today = from.getDay();
  for (let offset = 1; offset <= 7; offset++) {
    if (days.includes(WEEKDAYS[(today + offset) % 7])) return offset * DAY_MS;
  }
  return null;
}

// True when today is a scheduled day and no run happened yet today.
// `lastRun` is the ISO timestamp stored in settings.last_keepalive.
export function isRunDueToday(days, lastRun, now = new Date()) {
  if (!days.includes(WEEKDAYS[now.getDay()])) return false;
  if (!lastRun) return true;
  return new Date(lastRun).toDateString() !== now.toDateString();
}

// Resolve the current schedule from the DB. Disabled when no weekday is set.
async function getNextRun() {
  const row = await dbRef.prepare(`SELECT value FROM settings WHERE key = '${WEEKDAY_KEY}'`).first();
  const weekdays = parseWeekdays(row?.value);
  if (weekdays.length === 0) return { delay: 0, label: 'disabled' };
  const label = weekdays.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(', ');
  return { delay: nextWeekdayDelay(weekdays), label: `on ${label}` };
}

async function executeRun() {
  // Resolve OAuth credentials fresh from the DB (settings win over .env)
  // so changes made in the Settings page apply without a restart
  const env = await getGoogleOAuthEnv(dbRef);
  const results = await runKeepAlive(env, dbRef);
  const ok = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success);
  console.log(`Keep-alive run completed: ${ok}/${results.length} account(s) OK`);
  await logSystem(
    dbRef,
    failed.length ? 'warn' : 'info',
    'Keep-alive run completed',
    `${ok}/${results.length} account(s) OK` +
      (failed.length ? `; failed: ${failed.map(f => `${f.email}: ${f.error}`).join('; ')}` : '')
  );
}

// Run immediately at startup / when the schedule is enabled if today is a
// scheduled day and this process hasn't run yet today. Without this, a timer
// created on a scheduled day always targets the *next* occurrence (up to 7
// days away), and restarts can skip a day entirely.
async function runIfDueToday() {
  try {
    const daysRow = await dbRef.prepare(`SELECT value FROM settings WHERE key = '${WEEKDAY_KEY}'`).first();
    const days = parseWeekdays(daysRow?.value);
    const lastRow = await dbRef.prepare("SELECT value FROM settings WHERE key = 'last_keepalive'").first();
    if (!isRunDueToday(days, lastRow?.value)) return;
    console.log('Keep-alive scheduler: catch-up run for today');
    await executeRun();
  } catch (err) {
    console.error('Keep-alive catch-up run failed:', err.message);
  }
}

async function scheduleNext() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!dbRef) return;

  const run = await getNextRun();
  if (!run.delay) {
    console.log('Keep-alive scheduler: disabled');
    return;
  }

  console.log(`Keep-alive scheduler: next run ${run.label} (${new Date(Date.now() + run.delay).toISOString()})`);

  timer = setTimeout(async () => {
    timer = null;
    try {
      await executeRun();
    } catch (err) {
      console.error('Keep-alive run failed:', err.message);
      try {
        await logSystem(dbRef, 'error', 'Keep-alive run failed', err.message);
      } catch {}
    }
    // Always re-read the schedule from the DB so changes take effect
    // without a server restart.
    await scheduleNext();
  }, run.delay);
}

export async function initKeepAliveScheduler(db, env) {
  dbRef = db;
  envRef = env;
  await runIfDueToday();
  return scheduleNext();
}

export async function rescheduleKeepAliveScheduler() {
  if (!dbRef) return; // scheduler not initialized yet (route called outside local.js)
  const run = await getNextRun();
  await logSystem(dbRef, 'info', 'Keep-alive schedule updated', run.label);
  await runIfDueToday();
  return scheduleNext();
}
