function generateToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array).map(b => b.toString(16).padStart(2, '0')).join('');
}

const ALL_PERMISSIONS = [
  'drive:view', 'drive:upload', 'drive:download_browser', 'drive:download_background', 'drive:delete', 'drive:rename',
  'drive:create_folder', 'drive:move', 'drive:copy', 'drive:preview', 'drive:view_uploader', 'drive:transfer_owner',
  'trash:view', 'trash:restore', 'trash:permanent_delete', 'trash:empty',
  'accounts:view', 'accounts:view_email', 'accounts:add', 'accounts:remove', 'accounts:set_primary',
  'accounts:refresh', 'accounts:import_export', 'accounts:color', 'accounts:clean_all',
  'settings:view', 'settings:edit', 'settings:keepalive', 'settings:database',
  'admin:view_users', 'admin:manage_users', 'admin:edit_permissions', 'admin:view_activity', 'admin:view_logs', 'admin:manage_api', 'admin:view_api_docs', 'admin:queue',
  'share:view', 'share:manage', 'share:settings'
];

const PERMISSION_GROUPS = {
  drive: ['drive:view', 'drive:upload', 'drive:download_browser', 'drive:download_background', 'drive:delete', 'drive:rename', 'drive:create_folder', 'drive:move', 'drive:copy', 'drive:preview', 'drive:view_uploader', 'drive:transfer_owner'],
  trash: ['trash:view', 'trash:restore', 'trash:permanent_delete', 'trash:empty'],
  accounts: ['accounts:view', 'accounts:view_email', 'accounts:add', 'accounts:remove', 'accounts:set_primary', 'accounts:refresh', 'accounts:import_export', 'accounts:color', 'accounts:clean_all'],
  settings: ['settings:view', 'settings:edit', 'settings:keepalive', 'settings:database'],
  admin: ['admin:view_users', 'admin:manage_users', 'admin:edit_permissions', 'admin:view_activity', 'admin:view_logs', 'admin:manage_api', 'admin:view_api_docs', 'admin:queue'],
  share: ['share:view', 'share:manage', 'share:settings']
};

export function hasPageAccess(permissions, page) {
  const group = PERMISSION_GROUPS[page];
  if (!group) return false;
  return group.some(p => permissions.includes(p));
}

export async function authenticate(db, request) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/udrive_session=([^;]+)/);
  const token = match?.[1] || request.headers.get('x-session-token');

  if (!token) return null;

  const session = await db.prepare('SELECT * FROM sessions WHERE token = ?').bind(token).first();
  if (!session || new Date(session.expires_at) < new Date()) {
    if (session) await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }

  const user = await db.prepare('SELECT id, username, role FROM users WHERE id = ?').bind(session.user_id).first();
  if (!user) return null;

  if (user.role === 'master') {
    user.permissions = ALL_PERMISSIONS;
  } else {
    const { results } = await db.prepare('SELECT permission FROM user_permissions WHERE user_id = ?').bind(user.id).all();
    user.permissions = results.map(r => r.permission);
  }

  return user;
}

export function requireAuth(c, user) {
  if (!user) return c.json({ error: 'Authentication required' }, 401);
  return null;
}

export function requireMaster(c, user) {
  if (!user || user.role !== 'master') return c.json({ error: 'Master access required' }, 403);
  return null;
}

export function requirePermission(c, user, perm) {
  if (!user) return c.json({ error: 'Authentication required' }, 401);
  if (user.role === 'master') return null;
  if (user.permissions.includes(perm)) return null;
  return c.json({ error: `Permission denied: ${perm}` }, 403);
}

export async function createSession(db, userId) {
  const token = generateToken();
  const user = await db.prepare('SELECT session_timeout_hours, role FROM users WHERE id = ?').bind(userId).first();

  let expiresAt;
  if (user?.role === 'master') {
    expiresAt = new Date(Date.now() + 100 * 365 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    const hours = user?.session_timeout_hours || 24;
    expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
  }

  await db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, userId, expiresAt).run();
  return { token, expiresAt };
}

export async function deleteSession(db, token) {
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export { ALL_PERMISSIONS, PERMISSION_GROUPS };
