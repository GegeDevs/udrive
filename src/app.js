import { Hono } from 'hono';
import { authenticate } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import accountRoutes from './routes/accounts.js';
import fileRoutes from './routes/files.js';
import settingsRoutes from './routes/settings.js';
import userRoutes from './routes/users.js';
import activityRoutes from './routes/activity.js';
import logsRoutes from './routes/logs.js';
import apiV1Routes from './routes/api-v1.js';
import apiKeysRoutes from './routes/api-keys.js';
import { sharePublic, shareAdmin } from './routes/share.js';

export function createApp(getDB, envVars = null) {
  const app = new Hono();

  // Inject DB and env into context
  app.use('*', async (c, next) => {
    if (envVars) {
      c.env = { ...c.env, ...envVars };
    }
    const db = getDB(c.env);
    c.set('db', db);
    await next();
  });

  // Auth middleware for API routes
  app.use('/api/*', async (c, next) => {
    const db = c.get('db');
    const user = await authenticate(db, c.req.raw);
    c.set('user', user);
    await next();
  });

  app.use('/auth/*', async (c, next) => {
    const db = c.get('db');
    const user = await authenticate(db, c.req.raw);
    c.set('user', user);
    await next();
  });

  // Routes
  app.route('/share', sharePublic);
  app.route('/auth', authRoutes);
  app.route('/api/share', shareAdmin);
  app.route('/api/users', userRoutes);
  app.route('/api/accounts', accountRoutes);
  app.route('/api/files', fileRoutes);
  app.route('/api/settings', settingsRoutes);
  app.route('/api/activity', activityRoutes);
  app.route('/api/logs', logsRoutes);
  app.route('/api/api-keys', apiKeysRoutes);
  app.route('/api/v1', apiV1Routes);

  // Short download link
  app.get('/dlink/:token', async (c, next) => {
    const db = getDB(c.env);
    c.set('db', db);
    const { Hono } = await import('hono');
    const token = c.req.param('token');

    const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(`dl_token:${token}`).first();
    if (!row) return c.json({ error: 'Invalid or expired download link' }, 403);

    const data = JSON.parse(row.value);
    if (new Date(data.expiresAt) < new Date()) {
      await db.prepare("DELETE FROM settings WHERE key = ?").bind(`dl_token:${token}`).run();
      return c.json({ error: 'Download link expired' }, 403);
    }

    const { downloadFile } = await import('./services/google-drive.js');
    const { metadata, body } = await downloadFile(c.env, db, data.accountId, data.fileId);
    return new Response(body, {
      headers: {
        'Content-Type': metadata.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(data.fileName)}"`,
        ...(metadata.size ? { 'Content-Length': metadata.size } : {})
      }
    });
  });

  return app;
}
