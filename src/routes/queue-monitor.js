import { Hono } from 'hono';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const queueMonitor = new Hono();

// Get queue statistics
queueMonitor.get('/stats', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'admin:queue');
  if (err) return err;

  try {
    // Check if DELETE_QUEUE is available
    if (!c.env.DELETE_QUEUE) {
      return c.json({
        available: false,
        message: 'Queue not configured'
      });
    }

    // Get queue info from activity log
    const db = c.get('db');

    // Count queued jobs
    const queued = await db.prepare(
      "SELECT COUNT(*) as count FROM activity_log WHERE action = 'delete_queued' AND created_at > datetime('now', '-1 hour')"
    ).first();

    // Count completed jobs
    const completed = await db.prepare(
      "SELECT COUNT(*) as count FROM activity_log WHERE action = 'delete_async' AND created_at > datetime('now', '-1 hour')"
    ).first();

    // Get recent queued jobs
    const recentQueued = await db.prepare(
      "SELECT id, user_id, username, detail, created_at FROM activity_log WHERE action = 'delete_queued' ORDER BY created_at DESC LIMIT 20"
    ).all();

    // Get recent completed jobs
    const recentCompleted = await db.prepare(
      "SELECT id, user_id, username, detail, created_at FROM activity_log WHERE action = 'delete_async' ORDER BY created_at DESC LIMIT 20"
    ).all();

    return c.json({
      available: true,
      stats: {
        queuedLastHour: queued?.count || 0,
        completedLastHour: completed?.count || 0,
        pendingEstimate: Math.max(0, (queued?.count || 0) - (completed?.count || 0))
      },
      recentQueued: recentQueued.results || [],
      recentCompleted: recentCompleted.results || []
    });
  } catch (error) {
    console.error('Queue stats error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get active jobs (polling endpoint)
queueMonitor.get('/active', async (c) => {
  const user = c.get('user');
  let err = requireAuth(c, user);
  if (err) return err;
  err = requirePermission(c, user, 'admin:queue');
  if (err) return err;

  const db = c.get('db');

  try {
    // Jobs queued in last 10 minutes that haven't completed yet
    const activeJobs = await db.prepare(`
      SELECT
        q.id,
        q.user_id,
        q.username,
        q.detail,
        q.created_at as queued_at,
        c.created_at as completed_at,
        CASE
          WHEN c.id IS NULL THEN 'processing'
          ELSE 'completed'
        END as status
      FROM activity_log q
      LEFT JOIN activity_log c ON c.action = 'delete_async'
        AND c.detail LIKE '%' || SUBSTR(q.detail, 1, 20) || '%'
        AND c.created_at > q.created_at
      WHERE q.action = 'delete_queued'
        AND q.created_at > datetime('now', '-10 minutes')
      ORDER BY q.created_at DESC
      LIMIT 50
    `).all();

    return c.json({
      jobs: activeJobs.results || []
    });
  } catch (error) {
    console.error('Active jobs error:', error);
    return c.json({ error: error.message }, 500);
  }
});

export default queueMonitor;
