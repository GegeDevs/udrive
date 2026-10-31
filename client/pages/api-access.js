import { api } from '../api.js';
import { showToast } from '../components/toast.js';
import { formatDateTime } from '../time-utils.js';

const API_PERMISSIONS = [
  { key: 'api:files:read', label: 'Read Files (list, info)' },
  { key: 'api:files:download', label: 'Download Files' },
  { key: 'api:files:upload', label: 'Upload Files' },
  { key: 'api:files:write', label: 'Write Files (create, rename, delete, move, copy)' },
  { key: 'api:files:transfer', label: 'Transfer Ownership' },
  { key: 'api:accounts:read', label: 'Read Accounts' }
];

let activeTab = 'keys';

export function renderApiAccessPage() {
  const main = document.getElementById('main-content');

  main.innerHTML = `
    <div class="p-3 md:p-6">
      <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-4">
        <h2 class="text-xl md:text-2xl font-semibold mb-4">API Access</h2>
        <div class="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          <button class="tab-btn px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'keys' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" data-tab="keys">API Keys</button>
          <button class="tab-btn px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'settings' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" data-tab="settings">Settings</button>
        </div>
      </div>
      <div id="api-tab-content"></div>
    </div>
  `;

  main.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderApiAccessPage();
    });
  });

  if (activeTab === 'keys') renderKeysTab();
  else renderSettingsTab();
}

async function renderKeysTab() {
  const container = document.getElementById('api-tab-content');

  container.innerHTML = `
    <div class="mt-4">
      <div class="flex justify-end mb-4">
        <button id="btn-create-key" class="btn-primary text-sm">
          <span class="material-icons-outlined text-base">add</span>
          Create API Key
        </button>
      </div>
      <div id="keys-list">
        <div class="flex items-center justify-center h-32">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    </div>
  `;

  container.querySelector('#btn-create-key').addEventListener('click', showCreateKeyModal);
  loadKeys();
}

async function loadKeys() {
  const list = document.getElementById('keys-list');
  try {
    const keys = await api('/api/api-keys');

    if (keys.length === 0) {
      list.innerHTML = `
        <div class="flex flex-col items-center justify-center h-32 text-gray-500 dark:text-gray-400">
          <span class="material-icons-outlined text-4xl mb-2">vpn_key</span>
          <p class="text-sm">No API keys created yet</p>
        </div>
      `;
      return;
    }

    list.innerHTML = `
      <div class="space-y-3">
        ${keys.map(key => `
          <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2">
                <p class="text-sm font-medium">${escapeHtml(key.name)}</p>
                <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">${escapeHtml(key.key_prefix)}</code>
              </div>
              <div class="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
                <span>${key.permissions.length} permission${key.permissions.length !== 1 ? 's' : ''}</span>
                <span>Rate: ${key.rate_limit}/min</span>
                ${key.expires_at ? `<span>Expires: ${formatDateTime(key.expires_at)}</span>` : '<span>No expiry</span>'}
                ${key.last_used_at ? `<span>Last used: ${formatDateTime(key.last_used_at)}</span>` : '<span>Never used</span>'}
              </div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              <button class="btn-edit-key btn-icon hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" data-id="${key.id}" title="Edit">
                <span class="material-icons-outlined text-base">edit</span>
              </button>
              <button class="btn-revoke-key btn-icon hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors" data-id="${key.id}" title="Revoke">
                <span class="material-icons-outlined text-base">delete</span>
              </button>
            </div>
          </div>
        `).join('')}
      </div>
    `;

    list.querySelectorAll('.btn-edit-key').forEach(btn => {
      btn.addEventListener('click', () => showEditKeyModal(btn.dataset.id, keys.find(k => k.id == btn.dataset.id)));
    });

    list.querySelectorAll('.btn-revoke-key').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Revoke this API key? It will stop working immediately.')) return;
        try {
          await api(`/api/api-keys/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('API key revoked', 'success');
          loadKeys();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    list.innerHTML = `<p class="text-red-500">${err.message}</p>`;
  }
}

function showCreateKeyModal() {
  const existing = document.getElementById('api-key-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'api-key-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
      <div class="p-5 border-b border-gray-200 dark:border-gray-700">
        <h3 class="text-lg font-semibold">Create API Key</h3>
      </div>
      <div class="flex-1 overflow-auto p-5 space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
          <input type="text" id="key-name" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. My App">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rate Limit (req/min)</label>
          <input type="number" id="key-rate-limit" value="60" min="1" class="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expires At (optional)</label>
          <input type="datetime-local" id="key-expires" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Permissions</label>
          <div class="space-y-1">
            ${API_PERMISSIONS.map(p => `
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" class="key-perm-cb rounded border-gray-300 dark:border-gray-600" value="${p.key}" checked>
                ${p.label}
              </label>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
        <button id="key-cancel" class="btn-secondary text-sm">Cancel</button>
        <button id="key-create" class="btn-primary text-sm">Create</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#key-cancel').addEventListener('click', () => modal.remove());

  modal.querySelector('#key-create').addEventListener('click', async () => {
    const name = modal.querySelector('#key-name').value.trim();
    if (!name) { showToast('Name required', 'error'); return; }

    const permissions = [...modal.querySelectorAll('.key-perm-cb:checked')].map(cb => cb.value);
    const rate_limit = parseInt(modal.querySelector('#key-rate-limit').value) || 60;
    const expiresVal = modal.querySelector('#key-expires').value;
    const expires_at = expiresVal ? new Date(expiresVal).toISOString() : null;

    try {
      const res = await api('/api/api-keys', { method: 'POST', body: JSON.stringify({ name, permissions, rate_limit, expires_at }) });
      modal.remove();
      showKeyResultModal(res.key);
      loadKeys();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function showKeyResultModal(key) {
  const modal = document.createElement('div');
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 p-5">
      <div class="flex items-center gap-2 mb-3">
        <span class="material-icons-outlined text-green-500 text-2xl">check_circle</span>
        <h3 class="text-lg font-semibold">API Key Created</h3>
      </div>
      <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">Copy this key now. It won't be shown again.</p>
      <div class="bg-gray-100 dark:bg-gray-900 rounded-lg p-3 font-mono text-xs break-all select-all">${escapeHtml(key)}</div>
      <div class="flex justify-end gap-2 mt-4">
        <button id="key-copy" class="btn-secondary text-sm">
          <span class="material-icons-outlined text-base">content_copy</span> Copy
        </button>
        <button id="key-done" class="btn-primary text-sm">Done</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.querySelector('#key-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(key).then(() => showToast('Copied', 'success'));
  });
  modal.querySelector('#key-done').addEventListener('click', () => modal.remove());
}

function showEditKeyModal(id, key) {
  const existing = document.getElementById('api-key-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'api-key-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col">
      <div class="p-5 border-b border-gray-200 dark:border-gray-700">
        <h3 class="text-lg font-semibold">Edit API Key</h3>
        <code class="text-xs text-gray-500">${escapeHtml(key.key_prefix)}</code>
      </div>
      <div class="flex-1 overflow-auto p-5 space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
          <input type="text" id="edit-key-name" value="${escapeHtml(key.name)}" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rate Limit (req/min)</label>
          <input type="number" id="edit-key-rate" value="${key.rate_limit}" min="1" class="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expires At</label>
          <input type="datetime-local" id="edit-key-expires" value="${key.expires_at ? key.expires_at.slice(0, 16) : ''}" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Permissions</label>
          <div class="space-y-1">
            ${API_PERMISSIONS.map(p => `
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" class="edit-perm-cb rounded border-gray-300 dark:border-gray-600" value="${p.key}" ${key.permissions.includes(p.key) ? 'checked' : ''}>
                ${p.label}
              </label>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
        <button id="edit-cancel" class="btn-secondary text-sm">Cancel</button>
        <button id="edit-save" class="btn-primary text-sm">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#edit-cancel').addEventListener('click', () => modal.remove());

  modal.querySelector('#edit-save').addEventListener('click', async () => {
    const name = modal.querySelector('#edit-key-name').value.trim();
    const permissions = [...modal.querySelectorAll('.edit-perm-cb:checked')].map(cb => cb.value);
    const rate_limit = parseInt(modal.querySelector('#edit-key-rate').value) || 60;
    const expiresVal = modal.querySelector('#edit-key-expires').value;
    const expires_at = expiresVal ? new Date(expiresVal).toISOString() : null;

    try {
      await api(`/api/api-keys/${id}`, { method: 'PATCH', body: JSON.stringify({ name, permissions, rate_limit, expires_at }) });
      showToast('API key updated', 'success');
      modal.remove();
      loadKeys();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function renderSettingsTab() {
  const container = document.getElementById('api-tab-content');

  container.innerHTML = `
    <div class="mt-4 max-w-lg space-y-6">
      <div class="flex items-center justify-center h-20">
        <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    </div>
  `;

  try {
    const settings = await api('/api/api-keys/settings');

    container.innerHTML = `
      <div class="mt-4 max-w-lg space-y-6">
        <div>
          <label class="flex items-center justify-between cursor-pointer">
            <div>
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">API Enabled</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">Allow external access via API keys</p>
            </div>
            <input type="checkbox" id="api-enabled" class="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-blue-600" ${settings.api_enabled !== '0' ? 'checked' : ''}>
          </label>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Default Rate Limit (req/min)</label>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Applied to new API keys by default</p>
          <input type="number" id="api-rate-limit" value="${settings.api_default_rate_limit || '60'}" min="1" class="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">CORS Allowed Origins</label>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Comma-separated. Use * for all origins.</p>
          <input type="text" id="api-cors" value="${escapeHtml(settings.api_cors_origins || '*')}" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none" placeholder="*">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max Upload Size (MB)</label>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Maximum file size for API uploads</p>
          <input type="number" id="api-max-upload" value="${settings.api_max_upload_size || '100'}" min="1" class="w-32 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
        </div>
        <button id="btn-save-api-settings" class="btn-primary text-sm">Save Settings</button>
      </div>
    `;

    container.querySelector('#btn-save-api-settings').addEventListener('click', async () => {
      const body = {
        api_enabled: container.querySelector('#api-enabled').checked ? '1' : '0',
        api_default_rate_limit: container.querySelector('#api-rate-limit').value || '60',
        api_cors_origins: container.querySelector('#api-cors').value || '*',
        api_max_upload_size: container.querySelector('#api-max-upload').value || '100'
      };

      try {
        await api('/api/api-keys/settings', { method: 'PUT', body: JSON.stringify(body) });
        showToast('API settings saved', 'success');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  } catch (err) {
    container.innerHTML = `<p class="text-red-500 mt-4">${err.message}</p>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
