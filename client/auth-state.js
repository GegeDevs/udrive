let currentUser = null;

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
