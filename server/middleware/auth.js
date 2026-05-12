import db from '../db/init.js';
import { randomBytes } from 'crypto';

const ALL_PERMISSIONS = [
  'page:drive', 'page:trash', 'page:accounts', 'page:settings',
  'action:upload', 'action:download', 'action:delete', 'action:create_folder',
  'action:rename', 'action:move', 'action:copy', 'action:restore',
  'action:permanent_delete', 'action:manage_accounts', 'action:import_export'
];

export function authenticate(req, res, next) {
  const token = req.cookies?.udrive_session || req.headers['x-session-token'];

  if (!token) {
    req.user = null;
    return next();
  }

  const session = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!session || new Date(session.expires_at) < new Date()) {
    if (session) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    req.user = null;
    return next();
  }

  const user = db.prepare('SELECT id, username, role FROM users WHERE id = ?').get(session.user_id);
  if (!user) {
    req.user = null;
    return next();
  }

  if (user.role === 'master') {
    user.permissions = ALL_PERMISSIONS;
  } else {
    user.permissions = db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?')
      .all(user.id).map(r => r.permission);
  }

  req.user = user;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}

export function requireMaster(req, res, next) {
  if (!req.user || req.user.role !== 'master') {
    return res.status(403).json({ error: 'Master access required' });
  }
  next();
}

export function requirePermission(perm) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (req.user.role === 'master') return next();
    if (req.user.permissions.includes(perm)) return next();
    return res.status(403).json({ error: `Permission denied: ${perm}` });
  };
}

export function createSession(userId) {
  const token = randomBytes(32).toString('hex');
  const user = db.prepare('SELECT session_timeout_hours, role FROM users WHERE id = ?').get(userId);

  let expiresAt;
  if (user?.role === 'master') {
    expiresAt = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    const hours = user?.session_timeout_hours || 24;
    expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
  return { token, expiresAt };
}

export function deleteSession(token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function cleanExpiredSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

export { ALL_PERMISSIONS };
