import { api } from './api.js';

let cachedSettings = null;

export async function loadTimeSettings() {
  try {
    cachedSettings = await api('/api/settings');
  } catch {}
}

export function getTimeFormat() {
  return cachedSettings?.time_format || '24';
}

export function getTimezone() {
  return cachedSettings?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

// SQLite datetime('now') stores UTC as "YYYY-MM-DD HH:MM:SS" with no
// timezone marker. JS Date would otherwise read that as LOCAL time and
// shift every timestamp. Normalize it to an ISO string with 'Z' (UTC).
export function parseDbDate(dateStr) {
  if (typeof dateStr === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)) {
    return new Date(dateStr.replace(' ', 'T') + 'Z');
  }
  return new Date(dateStr);
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '—';
  const d = parseDbDate(dateStr);
  const tz = getTimezone();
  const hour12 = getTimeFormat() === '12';

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12, timeZone: tz });
}

export function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = parseDbDate(dateStr);
  const tz = getTimezone();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: tz });
}

export function formatTimeAgo(dateStr) {
  if (!dateStr) return '—';

  // Parse UTC time from database (SQLite stores naive UTC strings)
  const then = parseDbDate(dateStr);
  const now = new Date();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 0) return 'just now'; // Future time (clock skew)
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDateTime(dateStr);
}
