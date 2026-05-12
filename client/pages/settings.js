import { api } from '../api.js';
import { showToast } from '../components/toast.js';
import { setTheme, getTheme } from '../theme.js';
import { showLogoutModal } from '../components/logout-modal.js';

export function renderSettingsPage() {
  const main = document.getElementById('main-content');
  const currentTheme = getTheme();

  main.innerHTML = `
    <div class="p-3 md:p-6 max-w-2xl">
      <h2 class="text-xl md:text-2xl font-semibold mb-6">Settings</h2>

      <div class="space-y-8">
        <section>
          <h3 class="text-lg font-medium mb-4">Shared Folder</h3>
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Shared Folder ID</label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">The Google Drive folder ID that is shared across all accounts. You can find this in the folder's URL.</p>
              <div class="flex gap-2">
                <input type="text" id="input-folder-id" class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" placeholder="e.g. 1AbC2dEfGhIjKlMnOpQrStUvWxYz">
                <button id="btn-save-folder" class="btn-primary text-sm">Save</button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 class="text-lg font-medium mb-4">Appearance</h3>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Theme</label>
            <div class="flex gap-3">
              <button class="theme-btn px-4 py-2 rounded-lg border text-sm font-medium transition-all ${currentTheme === 'light' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'}" data-theme="light">
                <span class="material-icons-outlined text-base align-middle mr-1">light_mode</span>
                Light
              </button>
              <button class="theme-btn px-4 py-2 rounded-lg border text-sm font-medium transition-all ${currentTheme === 'dark' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'}" data-theme="dark">
                <span class="material-icons-outlined text-base align-middle mr-1">dark_mode</span>
                Dark
              </button>
              <button class="theme-btn px-4 py-2 rounded-lg border text-sm font-medium transition-all ${currentTheme === 'auto' ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800'}" data-theme="auto">
                <span class="material-icons-outlined text-base align-middle mr-1">brightness_auto</span>
                Auto
              </button>
            </div>
          </div>
        </section>

        <section>
          <h3 class="text-lg font-medium mb-4">Keep-Alive</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">Automatically generate activity on all accounts to prevent Google from deleting inactive accounts. A small file is uploaded and immediately deleted from each account.</p>
          <div class="space-y-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Interval (days)</label>
              <div class="flex gap-2">
                <input type="number" id="input-keepalive-days" min="0" class="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" placeholder="0">
                <button id="btn-save-keepalive" class="btn-primary text-sm">Save</button>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Set to 0 to disable. Recommended: 14-30 days.</p>
            </div>
            <div class="flex items-center gap-3">
              <button id="btn-run-keepalive" class="btn-secondary text-sm">
                <span class="material-icons-outlined text-base">play_arrow</span>
                Run Now
              </button>
              <span id="keepalive-last" class="text-xs text-gray-500 dark:text-gray-400"></span>
            </div>
          </div>
        </section>

        <section>
          <h3 class="text-lg font-medium mb-4">About</h3>
          <div class="text-sm text-gray-600 dark:text-gray-400 space-y-1">
            <p><strong>UDrive</strong> — Unified Google Drive Manager</p>
            <p>Pool multiple Google Drive accounts into one seamless storage experience.</p>
          </div>
        </section>

        <section>
          <h3 class="text-lg font-medium mb-4">Session</h3>
          <button id="btn-logout" class="flex items-center gap-2 px-4 py-2 rounded-lg border border-red-300 dark:border-red-700 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-sm font-medium">
            <span class="material-icons-outlined text-lg">logout</span>
            Logout
          </button>
        </section>
      </div>
    </div>
  `;

  loadSettings();

  main.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      setTheme(theme);
      renderSettingsPage();
    });
  });

  main.querySelector('#btn-save-folder').addEventListener('click', async () => {
    const folderId = main.querySelector('#input-folder-id').value.trim();
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ shared_folder_id: folderId }) });
      showToast('Shared folder ID saved', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  main.querySelector('#btn-save-keepalive').addEventListener('click', async () => {
    const days = main.querySelector('#input-keepalive-days').value.trim();
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ keepalive_interval_days: days || '0' }) });
      showToast(parseInt(days) > 0 ? `Keep-alive set to every ${days} day(s)` : 'Keep-alive disabled', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  main.querySelector('#btn-run-keepalive').addEventListener('click', async () => {
    const btn = main.querySelector('#btn-run-keepalive');
    if (btn.disabled) return;
    btn.disabled = true;
    const icon = btn.querySelector('.material-icons-outlined');
    icon.classList.add('animate-spin');
    icon.textContent = 'sync';

    try {
      const res = await api('/api/settings/keepalive', { method: 'POST' });
      const success = res.results.filter(r => r.success).length;
      const failed = res.results.filter(r => !r.success).length;
      showToast(`Keep-alive done: ${success} success, ${failed} failed`, success > 0 ? 'success' : 'error');
      loadSettings();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      icon.classList.remove('animate-spin');
      icon.textContent = 'play_arrow';
      btn.disabled = false;
    }
  });

  main.querySelector('#btn-logout').addEventListener('click', () => showLogoutModal());
}

async function loadSettings() {
  try {
    const settings = await api('/api/settings');
    const input = document.getElementById('input-folder-id');
    if (input && settings.shared_folder_id) {
      input.value = settings.shared_folder_id;
    }
    const keepaliveInput = document.getElementById('input-keepalive-days');
    if (keepaliveInput && settings.keepalive_interval_days) {
      keepaliveInput.value = settings.keepalive_interval_days;
    }
    const lastEl = document.getElementById('keepalive-last');
    if (lastEl && settings.last_keepalive) {
      const d = new Date(settings.last_keepalive);
      lastEl.textContent = `Last run: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    }
  } catch (err) {
    // Settings not loaded yet
  }
}
