// Run async work over a list with a limited number of parallel workers.
// Preserves input order in the returned results array.
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let nextIdx = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIdx < items.length) {
      const i = nextIdx++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

// Read the user-configurable account concurrency limit from settings.
// Invalid or missing values fall back to the default; clamped to [1, 20].
export async function getConcurrencyLimit(db, key = 'account_concurrency', fallback = 3) {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  const n = parseInt(row?.value, 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 20);
}
