import { api } from '../api.js';
import { showToast } from '../components/toast.js';
import { setTheme, getTheme } from '../theme.js';
import { showLogoutModal } from '../components/logout-modal.js';
import { hasPermission } from '../auth-state.js';

function getTimezoneOptions() {
  const timezones = Intl.supportedValuesOf('timeZone');
  const current = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timezones.map(tz => `<option value="${tz}">${tz.replace(/_/g, ' ')}</option>`).join('');
}

export function renderSettingsPage() {
  const main = document.getElementById('main-content');
  const currentTheme = getTheme();

  main.innerHTML = `
    <div class="p-3 md:p-6 max-w-2xl">
      <h2 class="text-xl md:text-2xl font-semibold mb-6">Settings</h2>

      <div class="space-y-8">
        ${hasPermission('settings:edit') ? `<section>
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
        </section>` : ''}

        <section>
          <h3 class="text-lg font-medium mb-4">Appearance</h3>
          <div class="space-y-4">
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
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Timezone</label>
              <div class="flex gap-2">
                <select id="input-timezone" class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
                  ${getTimezoneOptions()}
                </select>
                <button id="btn-save-timezone" class="btn-primary text-sm">Save</button>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Time Format</label>
              <div class="flex gap-3">
                <button class="time-format-btn px-4 py-2 rounded-lg border text-sm font-medium transition-all border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800" data-format="12">
                  12-hour
                </button>
                <button class="time-format-btn px-4 py-2 rounded-lg border text-sm font-medium transition-all border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800" data-format="24">
                  24-hour
                </button>
              </div>
            </div>
          </div>
        </section>

        <section>
          <h3 class="text-lg font-medium mb-4">Download</h3>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Average Download Speed (MBps)</label>
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">Used to calculate expiry time for browser download links.</p>
            <div class="flex gap-2">
              <input type="number" id="input-download-speed" min="0.1" step="0.1" class="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" placeholder="1">
              <button id="btn-save-download-speed" class="btn-primary text-sm">Save</button>
            </div>
          </div>
        </section>

        ${hasPermission('settings:edit') ? `<section>
          <h3 class="text-lg font-medium mb-4">Performance</h3>
          <div class="space-y-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max Parallel Accounts</label>
              <p class="text-xs text-gray-500 dark:text-gray-400 mb-2">How many accounts are processed at once during Clean All and Trash scanning. Lower this if you hit Google rate limits, raise it for faster operations.</p>
              <div class="flex gap-2">
                <input type="number" id="input-concurrency" min="1" max="20" step="1" class="w-24 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" placeholder="3">
                <button id="btn-save-concurrency" class="btn-primary text-sm">Save</button>
              </div>
            </div>
          </div>
        </section>` : ''}

        ${hasPermission('settings:keepalive') ? `<section>
          <h3 class="text-lg font-medium mb-4">Keep-Alive</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">Automatically generate activity on all accounts to prevent Google from deleting inactive accounts. A small file is uploaded and immediately deleted from each account.</p>
          <div class="space-y-3">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run on weekdays</label>
              <div class="flex flex-wrap gap-x-4 gap-y-2" id="keepalive-weekdays">
                <label class="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" value="mon" class="keepalive-day-cb"> Mon</label>
                <label class="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" value="tue" class="keepalive-day-cb"> Tue</label>
                <label class="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" value="wed" class="keepalive-day-cb"> Wed</label>
                <label class="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" value="thu" class="keepalive-day-cb"> Thu</label>
                <label class="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" value="fri" class="keepalive-day-cb"> Fri</label>
                <label class="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" value="sat" class="keepalive-day-cb"> Sat</label>
                <label class="flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" value="sun" class="keepalive-day-cb"> Sun</label>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">Keep-alive runs on every checked day (e.g. Mon, Wed, Fri). Leave all unchecked to disable.</p>
              <button id="btn-save-keepalive" class="btn-primary text-sm mt-2">Save</button>
            </div>
            <div class="flex items-center gap-3">
              <button id="btn-run-keepalive" class="btn-secondary text-sm">
                <span class="material-icons-outlined text-base">play_arrow</span>
                Run Now
              </button>
              <span id="keepalive-last" class="text-xs text-gray-500 dark:text-gray-400"></span>
            </div>
          </div>
        </section>` : ''}

        ${hasPermission('settings:edit') ? `<section>
          <h3 class="text-lg font-medium mb-4">Logging</h3>
          <div class="space-y-3">
            <label class="flex items-center justify-between cursor-pointer">
              <div>
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Activity Log</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">Track user actions (upload, download, delete, etc.)</p>
              </div>
              <input type="checkbox" id="toggle-activity" class="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-blue-600">
            </label>
            <label class="flex items-center justify-between cursor-pointer">
              <div>
                <p class="text-sm font-medium text-gray-700 dark:text-gray-300">System Logs</p>
                <p class="text-xs text-gray-500 dark:text-gray-400">Track system events (token refresh, keep-alive, errors)</p>
              </div>
              <input type="checkbox" id="toggle-logs" class="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-blue-600">
            </label>
          </div>
        </section>` : ''}

        ${hasPermission('settings:database') ? `<section>
          <h3 class="text-lg font-medium mb-4">Database</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">Download or upload database for migration between Local and Cloudflare deployments.</p>
          <div class="space-y-3">
            <div class="space-y-1">
              <p class="text-xs font-medium text-gray-600 dark:text-gray-400">Select data:</p>
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" class="db-table-cb rounded border-gray-300 dark:border-gray-600" value="accounts" checked>
                Accounts (Google Drive accounts)
              </label>
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" class="db-table-cb rounded border-gray-300 dark:border-gray-600" value="settings" checked>
                Settings
              </label>
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" class="db-table-cb rounded border-gray-300 dark:border-gray-600" value="file_owners" checked>
                File Owners
              </label>
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" class="db-table-cb rounded border-gray-300 dark:border-gray-600" value="users" checked>
                Users (Slave only)
              </label>
              <label class="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" class="db-table-cb rounded border-gray-300 dark:border-gray-600" value="user_permissions" checked>
                User Permissions
              </label>
            </div>
            <div class="flex items-center gap-3 flex-wrap">
              <button id="btn-export-db" class="btn-secondary text-sm">
                <span class="material-icons-outlined text-base">download</span>
                Download Database
              </button>
              <button id="btn-import-db" class="btn-secondary text-sm">
                <span class="material-icons-outlined text-base">upload</span>
                Upload Database
              </button>
              <input type="file" id="import-db-input" class="hidden" accept=".json">
            </div>
          </div>
        </section>` : ''}

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

  main.querySelectorAll('.time-format-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api('/api/settings', { method: 'PUT', body: JSON.stringify({ time_format: btn.dataset.format }) });
        showToast(`Time format set to ${btn.dataset.format}-hour`, 'success');
        renderSettingsPage();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  main.querySelector('#btn-save-folder')?.addEventListener('click', async () => {
    const folderId = main.querySelector('#input-folder-id').value.trim();
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ shared_folder_id: folderId }) });
      showToast('Shared folder ID saved', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  main.querySelector('#btn-save-download-speed')?.addEventListener('click', async () => {
    const speed = main.querySelector('#input-download-speed').value.trim();
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ download_speed_mbps: speed || '1' }) });
      showToast('Download speed saved', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  main.querySelector('#btn-save-concurrency')?.addEventListener('click', async () => {
    const val = main.querySelector('#input-concurrency').value.trim();
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 1 || n > 20) {
      showToast('Enter a number between 1 and 20', 'error');
      return;
    }
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ account_concurrency: String(n) }) });
      showToast('Concurrency limit saved', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  main.querySelector('#btn-save-timezone')?.addEventListener('click', async () => {
    const tz = main.querySelector('#input-timezone').value;
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ timezone: tz }) });
      showToast(`Timezone set to ${tz}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  main.querySelector('#toggle-activity')?.addEventListener('change', async (e) => {
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ activity_enabled: e.target.checked ? '1' : '0' }) });
      showToast(`Activity log ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
      e.target.checked = !e.target.checked;
    }
  });

  main.querySelector('#toggle-logs')?.addEventListener('change', async (e) => {
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify({ logs_enabled: e.target.checked ? '1' : '0' }) });
      showToast(`System logs ${e.target.checked ? 'enabled' : 'disabled'}`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
      e.target.checked = !e.target.checked;
    }
  });

  main.querySelector('#btn-save-keepalive')?.addEventListener('click', async () => {
    const checked = [...main.querySelectorAll('.keepalive-day-cb:checked')].map(cb => cb.value);
    const body = { keepalive_days: checked.join(',') };
    try {
      await api('/api/settings', { method: 'PUT', body: JSON.stringify(body) });
      let msg;
      if (checked.length > 0) {
        const names = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
        msg = `Keep-alive set to run every: ${checked.map(d => names[d]).join(', ')}`;
      } else {
        msg = 'Keep-alive disabled';
      }
      showToast(msg, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  main.querySelector('#btn-run-keepalive')?.addEventListener('click', async () => {
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

  main.querySelector('#btn-export-db')?.addEventListener('click', async () => {
    const selectedTables = [...main.querySelectorAll('.db-table-cb:checked')].map(cb => cb.value);
    if (selectedTables.length === 0) { showToast('Select at least one data type', 'error'); return; }

    const btn = main.querySelector('#btn-export-db');
    btn.disabled = true;
    const icon = btn.querySelector('.material-icons-outlined');
    icon.classList.add('animate-spin');
    icon.textContent = 'sync';

    try {
      const data = await api(`/api/settings/export-db?tables=${selectedTables.join(',')}`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `udrive-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('Database downloaded', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      icon.classList.remove('animate-spin');
      icon.textContent = 'download';
      btn.disabled = false;
    }
  });

  main.querySelector('#btn-import-db')?.addEventListener('click', () => {
    main.querySelector('#import-db-input').click();
  });

  main.querySelector('#import-db-input')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const selectedTables = [...main.querySelectorAll('.db-table-cb:checked')].map(cb => cb.value);
    if (selectedTables.length === 0) { showToast('Select at least one data type', 'error'); return; }

    if (!confirm('Upload will overwrite selected data. Are you sure?')) return;

    const btn = main.querySelector('#btn-import-db');
    btn.disabled = true;
    const icon = btn.querySelector('.material-icons-outlined');
    icon.classList.add('animate-spin');
    icon.textContent = 'sync';

    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await api('/api/settings/import-db', { method: 'POST', body: JSON.stringify({ tables: selectedTables, data }) });
      showToast('Database uploaded. Reloading...', 'success');
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      showToast(err.message, 'error');
      icon.classList.remove('animate-spin');
      icon.textContent = 'upload';
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
    const dayCbs = document.querySelectorAll('.keepalive-day-cb');
    if (dayCbs.length) {
      const savedDays = (settings.keepalive_days || '').split(',').filter(Boolean);
      dayCbs.forEach(cb => { cb.checked = savedDays.includes(cb.value); });
    }
    const lastEl = document.getElementById('keepalive-last');
    if (lastEl && settings.last_keepalive) {
      const d = new Date(settings.last_keepalive);
      lastEl.textContent = `Last run: ${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
    }
    const activityToggle = document.getElementById('toggle-activity');
    if (activityToggle) {
      activityToggle.checked = settings.activity_enabled !== '0';
    }
    const logsToggle = document.getElementById('toggle-logs');
    if (logsToggle) {
      logsToggle.checked = settings.logs_enabled !== '0';
    }
    const tzSelect = document.getElementById('input-timezone');
    if (tzSelect) {
      const tz = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
      tzSelect.value = tz;
    }
    const timeFormat = settings.time_format || '24';
    document.querySelectorAll('.time-format-btn').forEach(btn => {
      if (btn.dataset.format === timeFormat) {
        btn.classList.add('border-blue-500', 'bg-blue-50', 'dark:bg-blue-900/30', 'text-blue-700', 'dark:text-blue-300');
        btn.classList.remove('border-gray-300', 'dark:border-gray-600', 'hover:bg-gray-50', 'dark:hover:bg-gray-800');
      }
    });
    const speedInput = document.getElementById('input-download-speed');
    if (speedInput) {
      speedInput.value = settings.download_speed_mbps || '1';
    }
    const concInput = document.getElementById('input-concurrency');
    if (concInput) {
      concInput.value = settings.account_concurrency || '3';
    }
  } catch (err) {
    // Settings not loaded yet
  }
}
