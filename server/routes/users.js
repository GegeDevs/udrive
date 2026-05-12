import { Router } from 'express';
import db from '../db/init.js';
import { hashPassword, verifyPassword } from '../services/password.js';
import { requireAuth, requireMaster, createSession, deleteSession, ALL_PERMISSIONS } from '../middleware/auth.js';

const router = Router();

router.get('/check', (req, res) => {
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  res.json({ initialized: userCount > 0 });
});

router.post('/setup', async (req, res, next) => {
  try {
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (userCount > 0) return res.status(400).json({ error: 'Setup already completed' });

    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const hash = await hashPassword(password);
    db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, 'master');

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const session = createSession(user.id);

    res.cookie('udrive_session', session.token, {
      httpOnly: true,
      sameSite: 'lax',
      expires: new Date(session.expiresAt),
      path: '/'
    });

    res.json({ success: true, role: user.role });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', requireAuth, (req, res) => {
  const token = req.cookies?.udrive_session || req.headers['x-session-token'];
  if (token) deleteSession(token);
  res.clearCookie('udrive_session', { path: '/' });
  res.json({ success: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    role: req.user.role,
    permissions: req.user.permissions
  });
});

router.get('/', requireAuth, requireMaster, (req, res) => {
  const users = db.prepare('SELECT id, username, role, session_timeout_hours, created_at FROM users ORDER BY role DESC, created_at ASC').all();
  for (const user of users) {
    if (user.role === 'master') {
      user.permissions = ALL_PERMISSIONS;
    } else {
      user.permissions = db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?')
        .all(user.id).map(r => r.permission);
    }
  }
  res.json(users);
});

router.post('/', requireAuth, requireMaster, async (req, res, next) => {
  try {
    const { username, password, permissions } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return res.status(409).json({ error: 'Username already exists' });

    const hash = await hashPassword(password);
    const result = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, 'slave');

    if (permissions && Array.isArray(permissions)) {
      const insert = db.prepare('INSERT OR IGNORE INTO user_permissions (user_id, permission) VALUES (?, ?)');
      for (const perm of permissions) {
        if (ALL_PERMISSIONS.includes(perm)) {
          insert.run(result.lastInsertRowid, perm);
        }
      }
    }

    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', requireAuth, requireMaster, (req, res) => {
  const { id } = req.params;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'master') return res.status(400).json({ error: 'Cannot delete master account' });

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ success: true });
});

router.get('/:id/permissions', requireAuth, requireMaster, (req, res) => {
  const { id } = req.params;
  const perms = db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').all(id).map(r => r.permission);
  res.json(perms);
});

router.put('/:id/permissions', requireAuth, requireMaster, (req, res) => {
  const { id } = req.params;
  const { permissions } = req.body;
  if (!Array.isArray(permissions)) return res.status(400).json({ error: 'Permissions must be an array' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.role === 'master') return res.status(400).json({ error: 'Cannot modify master permissions' });

  db.prepare('DELETE FROM user_permissions WHERE user_id = ?').run(id);
  const insert = db.prepare('INSERT INTO user_permissions (user_id, permission) VALUES (?, ?)');
  for (const perm of permissions) {
    if (ALL_PERMISSIONS.includes(perm)) {
      insert.run(id, perm);
    }
  }

  res.json({ success: true });
});

router.patch('/:id/timeout', requireAuth, requireMaster, (req, res) => {
  const { id } = req.params;
  const { hours } = req.body;
  if (!hours || hours < 1) return res.status(400).json({ error: 'Timeout must be at least 1 hour' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET session_timeout_hours = ? WHERE id = ?').run(hours, id);
  res.json({ success: true });
});

router.patch('/:id/password', requireAuth, requireMaster, async (req, res, next) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    if (!password || password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const hash = await hashPassword(password);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
