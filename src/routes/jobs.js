import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { cancelJob } from '../services/job-queue.js';

const jobs = new Hono();

function canSee(job, user) {
  return user.role === 'master' || job.created_by === user.id;
}

jobs.get('/', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const db = c.get('db');
  const limit = Math.min(parseInt(c.req.query('limit') || '100', 10) || 100, 500);

  if (user.role === 'master') {
    const { results } = await db.prepare('SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?').bind(limit).all();
    return c.json(results);
  }

  const { results } = await db.prepare('SELECT * FROM jobs WHERE created_by = ? ORDER BY created_at DESC LIMIT ?')
    .bind(user.id, limit).all();
  return c.json(results);
});

jobs.get('/:id', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const job = await c.get('db').prepare('SELECT * FROM jobs WHERE id = ?').bind(c.req.param('id')).first();
  if (!job) return c.json({ error: 'Job not found' }, 404);
  if (!canSee(job, user)) return c.json({ error: 'Forbidden' }, 403);
  return c.json(job);
});

jobs.post('/:id/cancel', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const db = c.get('db');
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(c.req.param('id')).first();
  if (!job) return c.json({ error: 'Job not found' }, 404);
  if (!canSee(job, user)) return c.json({ error: 'Forbidden' }, 403);

  const result = await cancelJob(db, job.id);
  if (!result.ok) return c.json({ error: 'Job already finished' }, result.status);
  return c.json({ success: true });
});

jobs.delete('/:id', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const db = c.get('db');
  const job = await db.prepare('SELECT * FROM jobs WHERE id = ?').bind(c.req.param('id')).first();
  if (!job) return c.json({ error: 'Job not found' }, 404);
  if (!canSee(job, user)) return c.json({ error: 'Forbidden' }, 403);
  if (job.status === 'queued' || job.status === 'running') {
    return c.json({ error: 'Cancel the job before removing it' }, 409);
  }

  await db.prepare('DELETE FROM jobs WHERE id = ?').bind(job.id).run();
  return c.json({ success: true });
});

jobs.delete('/', async (c) => {
  const user = c.get('user');
  const err = requireAuth(c, user);
  if (err) return err;

  const db = c.get('db');
  if (user.role === 'master') {
    await db.prepare("DELETE FROM jobs WHERE status IN ('done', 'failed', 'cancelled')").run();
  } else {
    await db.prepare("DELETE FROM jobs WHERE created_by = ? AND status IN ('done', 'failed', 'cancelled')")
      .bind(user.id).run();
  }
  return c.json({ success: true });
});

export default jobs;
