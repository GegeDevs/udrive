import { api } from '../api.js';
import { showToast } from '../components/toast.js';

const ALL_PERMISSIONS = [
  { key: 'page:drive', label: 'Drive Page', group: 'Pages' },
  { key: 'page:trash', label: 'Trash Page', group: 'Pages' },
  { key: 'page:accounts', label: 'Accounts Page', group: 'Pages' },
  { key: 'page:settings', label: 'Settings Page', group: 'Pages' },
  { key: 'action:upload', label: 'Upload Files', group: 'Actions' },
  { key: 'action:download', label: 'Download Files', group: 'Actions' },
  { key: 'action:delete', label: 'Delete Files', group: 'Actions' },
  { key: 'action:create_folder', label: 'Create Folder', group: 'Actions' },
  { key: 'action:rename', label: 'Rename', group: 'Actions' },
  { key: 'action:move', label: 'Move Files', group: 'Actions' },
  { key: 'action:copy', label: 'Copy Files', group: 'Actions' },
  { key: 'action:restore', label: 'Restore from Trash', group: 'Actions' },
  { key: 'action:permanent_delete', label: 'Permanent Delete', group: 'Actions' },
  { key: 'action:manage_accounts', label: 'Manage Accounts', group: 'Actions' },
  { key: 'action:import_export', label: 'Import/Export Config', group: 'Actions' }
];

export function renderUsersPage() {
  const main = document.getElementById('main-content');

  main.innerHTML = `
    <div class="p-3 md:p-6">
      <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 class="text-xl md:text-2xl font-semibold">Users <span id="users-count" class="text-gray-400 font-normal"></span></h2>
          <button id="btn-add-user" class="btn-primary">
            <span class="material-icons-outlined text-base md:text-lg">person_add</span>
            <span class="hidden sm:inline">Add User</span>
          </button>
        </div>
      </div>
      <div id="users-list">
        <div class="flex items-center justify-center h-32">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    </div>

    <div id="add-user-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
        <div class="p-5 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-lg font-semibold">Add Slave User</h3>
        </div>
        <div class="flex-1 overflow-auto p-5 space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
            <input type="text" id="new-user-username" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input type="password" id="new-user-password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Permissions</label>
            <div class="space-y-3">
              <div>
                <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Pages</p>
                <div class="space-y-1">
                  ${ALL_PERMISSIONS.filter(p => p.group === 'Pages').map(p => `
                    <label class="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" class="new-user-perm rounded border-gray-300 dark:border-gray-600" value="${p.key}" checked>
                      ${p.label}
                    </label>
                  `).join('')}
                </div>
              </div>
              <div>
                <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Actions</p>
                <div class="space-y-1">
                  ${ALL_PERMISSIONS.filter(p => p.group === 'Actions').map(p => `
                    <label class="flex items-center gap-2 text-sm cursor-pointer">
                      <input type="checkbox" class="new-user-perm rounded border-gray-300 dark:border-gray-600" value="${p.key}" checked>
                      ${p.label}
                    </label>
                  `).join('')}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button id="add-user-cancel" class="btn-secondary text-sm">Cancel</button>
          <button id="add-user-submit" class="btn-primary text-sm">Create User</button>
        </div>
      </div>
    </div>

    <div id="edit-perms-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[90vh] flex flex-col">
        <div class="p-5 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-lg font-semibold">Edit Permissions</h3>
          <p id="edit-perms-username" class="text-sm text-gray-500 dark:text-gray-400"></p>
        </div>
        <div class="flex-1 overflow-auto p-5 space-y-3">
          <div>
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Pages</p>
            <div class="space-y-1">
              ${ALL_PERMISSIONS.filter(p => p.group === 'Pages').map(p => `
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" class="edit-perm-cb rounded border-gray-300 dark:border-gray-600" value="${p.key}">
                  ${p.label}
                </label>
              `).join('')}
            </div>
          </div>
          <div>
            <p class="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-1">Actions</p>
            <div class="space-y-1">
              ${ALL_PERMISSIONS.filter(p => p.group === 'Actions').map(p => `
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" class="edit-perm-cb rounded border-gray-300 dark:border-gray-600" value="${p.key}">
                  ${p.label}
                </label>
              `).join('')}
            </div>
          </div>
        </div>
        <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
          <button id="edit-perms-cancel" class="btn-secondary text-sm">Cancel</button>
          <button id="edit-perms-save" class="btn-primary text-sm">Save</button>
        </div>
      </div>
    </div>
  `;

  loadUsers();

  main.querySelector('#btn-add-user').addEventListener('click', () => {
    document.getElementById('add-user-modal').classList.remove('hidden');
  });

  document.getElementById('add-user-cancel').addEventListener('click', () => {
    document.getElementById('add-user-modal').classList.add('hidden');
  });

  document.getElementById('add-user-submit').addEventListener('click', async () => {
    const username = document.getElementById('new-user-username').value.trim();
    const password = document.getElementById('new-user-password').value;
    const permissions = [];
    document.querySelectorAll('.new-user-perm:checked').forEach(cb => permissions.push(cb.value));

    if (!username || !password) {
      showToast('Username and password required', 'error');
      return;
    }

    try {
      await api('/api/users', { method: 'POST', body: JSON.stringify({ username, password, permissions }) });
      showToast('User created', 'success');
      document.getElementById('add-user-modal').classList.add('hidden');
      document.getElementById('new-user-username').value = '';
      document.getElementById('new-user-password').value = '';
      loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('edit-perms-cancel').addEventListener('click', () => {
    document.getElementById('edit-perms-modal').classList.add('hidden');
  });
}

async function loadUsers() {
  const container = document.getElementById('users-list');

  try {
    const users = await api('/api/users');
    document.getElementById('users-count').textContent = `(${users.length})`;

    container.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        ${users.map(user => `
          <div class="border border-gray-200 dark:border-gray-700 rounded-xl p-4 flex flex-col hover:shadow-md transition-shadow">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-10 h-10 rounded-full ${user.role === 'master' ? 'bg-amber-100 dark:bg-amber-900/40' : 'bg-gray-100 dark:bg-gray-800'} flex items-center justify-center shrink-0">
                <span class="material-icons-outlined ${user.role === 'master' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500'} text-xl">${user.role === 'master' ? 'admin_panel_settings' : 'person'}</span>
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-sm truncate">${escapeHtml(user.username)}</p>
                <p class="text-xs text-gray-500 dark:text-gray-400 capitalize">${user.role}</p>
              </div>
            </div>
            ${user.role === 'slave' ? `
              <div class="text-xs text-gray-500 dark:text-gray-400 mb-2">
                ${user.permissions.length} permission${user.permissions.length !== 1 ? 's' : ''} granted
              </div>
              <div class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 mb-3">
                <span class="material-icons-outlined text-sm">schedule</span>
                Session: ${user.session_timeout_hours}h
                <button class="btn-edit-timeout p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" data-id="${user.id}" data-hours="${user.session_timeout_hours}" title="Edit timeout">
                  <span class="material-icons-outlined text-sm">edit</span>
                </button>
              </div>
              <div class="flex items-center gap-2 mt-auto">
                <button class="btn-edit-perms px-2 py-1 text-xs font-medium border border-gray-300 dark:border-gray-600 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors" data-id="${user.id}" data-username="${escapeHtml(user.username)}">
                  Edit Permissions
                </button>
                <button class="btn-change-pw p-1.5 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" data-id="${user.id}" title="Change password">
                  <span class="material-icons-outlined text-base">key</span>
                </button>
                <button class="btn-delete-user p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors ml-auto" data-id="${user.id}" title="Delete user">
                  <span class="material-icons-outlined text-base">delete</span>
                </button>
              </div>
            ` : `
              <div class="text-xs text-gray-500 dark:text-gray-400">Full access</div>
            `}
          </div>
        `).join('')}
      </div>
    `;

    container.querySelectorAll('.btn-edit-perms').forEach(btn => {
      btn.addEventListener('click', () => openEditPerms(btn.dataset.id, btn.dataset.username));
    });

    container.querySelectorAll('.btn-delete-user').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this user?')) return;
        try {
          await api(`/api/users/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('User deleted', 'success');
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.btn-edit-timeout').forEach(btn => {
      btn.addEventListener('click', async () => {
        const current = btn.dataset.hours;
        const hours = prompt('Session timeout (hours):', current);
        if (!hours || isNaN(hours) || parseInt(hours) < 1) return;

        try {
          await api(`/api/users/${btn.dataset.id}/timeout`, {
            method: 'PATCH',
            body: JSON.stringify({ hours: parseInt(hours) })
          });
          showToast('Session timeout updated', 'success');
          loadUsers();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    container.querySelectorAll('.btn-change-pw').forEach(btn => {
      btn.addEventListener('click', async () => {
        const password = prompt('Enter new password (min 4 characters):');
        if (!password) return;
        if (password.length < 4) {
          showToast('Password must be at least 4 characters', 'error');
          return;
        }

        try {
          await api(`/api/users/${btn.dataset.id}/password`, {
            method: 'PATCH',
            body: JSON.stringify({ password })
          });
          showToast('Password changed (user sessions invalidated)', 'success');
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<p class="text-red-500">${err.message}</p>`;
  }
}

async function openEditPerms(userId, username) {
  const modal = document.getElementById('edit-perms-modal');
  document.getElementById('edit-perms-username').textContent = username;

  try {
    const perms = await api(`/api/users/${userId}/permissions`);
    modal.querySelectorAll('.edit-perm-cb').forEach(cb => {
      cb.checked = perms.includes(cb.value);
    });
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  modal.classList.remove('hidden');

  const saveBtn = document.getElementById('edit-perms-save');
  const newSaveBtn = saveBtn.cloneNode(true);
  saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

  newSaveBtn.addEventListener('click', async () => {
    const permissions = [];
    modal.querySelectorAll('.edit-perm-cb:checked').forEach(cb => permissions.push(cb.value));

    try {
      await api(`/api/users/${userId}/permissions`, { method: 'PUT', body: JSON.stringify({ permissions }) });
      showToast('Permissions updated', 'success');
      modal.classList.add('hidden');
      loadUsers();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
