import { randomUUID } from 'node:crypto';

// In-process FIFO job queue. Jobs are persisted in the `jobs` table so the
// Progress page can follow them and so queued work survives a restart.
// One job runs at a time; heavy handlers parallelise their own work.

const handlers = new Map();
const cancelRequested = new Set();
let pumping = false;
let getEnv = async () => ({});

export class JobCancelled extends Error {
  constructor() {
    super('Job cancelled');
    this.name = 'JobCancelled';
  }
}

export function registerJobHandler(type, handler) {
  handlers.set(type, handler);
}

export async function initJobQueue(db, envProvider) {
  if (envProvider) getEnv = envProvider;
  // A job that was mid-flight when the server died cannot resume reliably.
  await db.prepare(
    "UPDATE jobs SET status = 'failed', error = 'Interrupted by server restart', finished_at = ? WHERE status = 'running'"
  ).bind(new Date().toISOString()).run();
  setTimeout(() => pump(db), 50);
}

export async function enqueueJob(db, { type, label, payload = {}, userId = null }) {
  if (!handlers.has(type)) throw new Error(`Unknown job type: ${type}`);
  const id = randomUUID();
  await db.prepare(
    "INSERT INTO jobs (id, type, label, payload, status, created_by) VALUES (?, ?, ?, ?, 'queued', ?)"
  ).bind(id, type, label, JSON.stringify(payload), userId).run();
  setTimeout(() => pump(db), 0);
  return id;
}

export async function cancelJob(db, id) {
  const job = await db.prepare('SELECT status FROM jobs WHERE id = ?').bind(id).first();
  if (!job) return { ok: false, status: 404 };
  if (job.status === 'queued' || job.status === 'running') {
    cancelRequested.add(id);
    if (job.status === 'queued') {
      await db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), id).run();
    }
    return { ok: true, status: 200 };
  }
  return { ok: false, status: 409 };
}

async function pump(db) {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const job = await db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").first();
      if (!job) break;
      await runJob(db, job);
    }
  } catch (err) {
    console.error('Job queue error:', err);
  } finally {
    pumping = false;
  }
}

async function runJob(db, job) {
  const handler = handlers.get(job.type);
  const startedAt = new Date().toISOString();

  await db.prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?")
    .bind(startedAt, job.id).run();

  const progress = async ({ done, total, failed, message } = {}) => {
    await db.prepare(
      `UPDATE jobs SET
         done = COALESCE(?, done),
         total = COALESCE(?, total),
         failed = COALESCE(?, failed),
         message = COALESCE(?, message)
       WHERE id = ?`
    ).bind(done ?? null, total ?? null, failed ?? null, message ?? null, job.id).run();
  };

  const ctx = {
    db,
    env: await getEnv(),
    payload: job.payload ? JSON.parse(job.payload) : {},
    progress,
    isCancelled: () => cancelRequested.has(job.id)
  };

  try {
    if (!handler) throw new Error(`No handler for job type: ${job.type}`);
    const result = await handler(ctx);
    await db.prepare(
      "UPDATE jobs SET status = 'done', finished_at = ?, message = 'Finished', result = ? WHERE id = ?"
    ).bind(new Date().toISOString(), JSON.stringify(result ?? null), job.id).run();
  } catch (err) {
    if (err instanceof JobCancelled || cancelRequested.has(job.id)) {
      await db.prepare("UPDATE jobs SET status = 'cancelled', finished_at = ?, message = 'Cancelled' WHERE id = ?")
        .bind(new Date().toISOString(), job.id).run();
    } else {
      console.error(`Job ${job.type} failed:`, err);
      await db.prepare(
        "UPDATE jobs SET status = 'failed', finished_at = ?, error = ?, message = NULL WHERE id = ?"
      ).bind(new Date().toISOString(), err.message || 'Job failed', job.id).run();
    }
  } finally {
    cancelRequested.delete(job.id);
  }
}
