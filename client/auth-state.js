let currentUser = null;

const PERMISSION_GROUPS = {
  drive: ['drive:view', 'drive:upload', 'drive:download_browser', 'drive:download_background', 'drive:delete', 'drive:rename', 'drive:create_folder', 'drive:move', 'drive:copy', 'drive:preview', 'drive:view_uploader', 'drive:transfer_owner'],
  trash: ['trash:view', 'trash:restore', 'trash:permanent_delete', 'trash:empty'],
  accounts: ['accounts:view', 'accounts:view_email', 'accounts:add', 'accounts:remove', 'accounts:set_primary', 'accounts:refresh', 'accounts:import_export', 'accounts:color', 'accounts:clean_all'],
  settings: ['settings:view', 'settings:edit', 'settings:keepalive', 'settings:database'],
  admin: ['admin:view_users', 'admin:manage_users', 'admin:edit_permissions', 'admin:view_activity', 'admin:view_logs', 'admin:manage_api', 'admin:view_api_docs'],
  share: ['share:view', 'share:manage', 'share:settings']
};

export function setCurrentUser(user) {
  currentUser = user;
}

export function getCurrentUser() {
  return currentUser;
}

export function hasPermission(perm) {
  if (!currentUser) return false;
  if (currentUser.role === 'master') return true;
  return currentUser.permissions.includes(perm);
}

export function hasPageAccess(page) {
  if (!currentUser) return false;
  if (currentUser.role === 'master') return true;
  const group = PERMISSION_GROUPS[page];
  if (!group) return false;
  return group.some(p => currentUser.permissions.includes(p));
}

export { PERMISSION_GROUPS };
