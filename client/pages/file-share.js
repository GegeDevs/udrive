import { api } from '../api.js';
import { hasPermission } from '../auth-state.js';
import { formatDateTime, parseDbDate } from '../time-utils.js';
import { generateQRCode } from '../qr.js';

let activeTab = 'shares';
let eventSource = null;

export function destroyFileSharePage() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/api/share/events');

  eventSource.addEventListener('share-created', (e) => {
    const share = JSON.parse(e.data);
    const tbody = document.querySelector('#shares-tbody');
    if (!tbody) return;

    const emptyState = document.querySelector('#share-tab-content .text-center');
    if (emptyState) {
      renderSharesTab(document.querySelector('#share-tab-content'));
      return;
    }

    const tr = createShareRow(share);
    tbody.prepend(tr);
    bindRowEvents(tr);
    updateTotalCount(1);
  });

  eventSource.addEventListener('share-downloaded', (e) => {
    const { shareId, downloadCount, expiresAt } = JSON.parse(e.data);
    const tbody = document.querySelector('#shares-tbody');
    if (!tbody) return;

    const row = tbody.querySelector(`tr[data-share-id="${shareId}"]`);
    if (!row) return;
    const countCell = row.querySelector('.dl-count');
    if (countCell) countCell.textContent = downloadCount;
    const expiryCell = row.querySelector('.expiry-cell');
    if (expiryCell) {
      expiryCell.textContent = formatDateTime(expiresAt);
      expiryCell.classList.remove('text-red-500');
      expiryCell.classList.add('text-gray-500');
    }
  });

  eventSource.addEventListener('share-deleted', (e) => {
    const { shareId } = JSON.parse(e.data);
    const tbody = document.querySelector('#shares-tbody');
    if (!tbody) return;

    const row = tbody.querySelector(`tr[data-share-id="${shareId}"]`);
    if (row) {
      row.remove();
      updateTotalCount(-1);
    }
  });
}

function updateTotalCount(delta) {
  const countEl = document.querySelector('#share-tab-content .text-sm.text-gray-500');
  if (!countEl || !countEl.textContent.includes('share')) return;
  const match = countEl.textContent.match(/(\d+)/);
  if (match) {
    const newTotal = Math.max(0, parseInt(match[1]) + delta);
    countEl.textContent = `${newTotal} share${newTotal !== 1 ? 's' : ''}`;
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatStorageBar(used, limit) {
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0;
  const usedStr = formatFileSize(used);
  const limitStr = formatFileSize(limit);
  return { pct, usedStr, limitStr };
}

export function renderFileSharePage() {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="max-w-5xl mx-auto p-4 md:p-6">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-xl font-bold">File Share</h1>
      </div>

      <div class="border-b border-gray-200 dark:border-gray-700 mb-4">
        <div class="flex gap-4">
          <button class="tab-btn pb-2 px-1 text-sm font-medium border-b-2 transition-colors" data-tab="shares">
            Active Shares
          </button>
          <button class="tab-btn pb-2 px-1 text-sm font-medium border-b-2 transition-colors" data-tab="accounts">
            Accounts
          </button>
          <button class="tab-btn pb-2 px-1 text-sm font-medium border-b-2 transition-colors" data-tab="settings">
            Settings
          </button>
        </div>
      </div>

      <div id="share-tab-content"></div>
    </div>
  `;

  main.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderFileSharePage();
    });
  });

  updateTabStyles(main);

  const tabContent = main.querySelector('#share-tab-content');
  if (activeTab === 'shares') {
    renderSharesTab(tabContent);
  } else if (activeTab === 'accounts') {
    if (eventSource) { eventSource.close(); eventSource = null; }
    renderAccountsTab(tabContent);
  } else {
    if (eventSource) { eventSource.close(); eventSource = null; }
    renderSettingsTab(tabContent);
  }
}

function updateTabStyles(main) {
  main.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === activeTab) {
      btn.classList.add('border-blue-500', 'text-blue-600', 'dark:text-blue-400');
      btn.classList.remove('border-transparent', 'text-gray-500');
    } else {
      btn.classList.remove('border-blue-500', 'text-blue-600', 'dark:text-blue-400');
      btn.classList.add('border-transparent', 'text-gray-500');
    }
  });
}

async function renderSharesTab(container) {
  container.innerHTML = `<p class="text-sm text-gray-500">Loading...</p>`;

  try {
    const data = await api('/api/share/list');
    const canManage = hasPermission('share:manage');

    if (data.shares.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12">
          <span class="material-icons-outlined text-gray-400 text-4xl">link_off</span>
          <p class="mt-3 text-gray-500 dark:text-gray-400">No active shares</p>
        </div>
      `;
      connectSSE();
      return;
    }

    container.innerHTML = `
      <div class="flex items-center justify-between mb-3">
        <p class="text-sm text-gray-500">${data.total} share${data.total !== 1 ? 's' : ''}</p>
        ${canManage ? `<button id="cleanup-btn" class="text-sm px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">Cleanup Expired</button>` : ''}
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-gray-200 dark:border-gray-700 text-left">
              <th class="pb-2 font-medium text-gray-500">File</th>
              <th class="pb-2 font-medium text-gray-500">Size</th>
              <th class="pb-2 font-medium text-gray-500 hidden md:table-cell">Downloads</th>
              <th class="pb-2 font-medium text-gray-500 hidden md:table-cell">Expires</th>
              <th class="pb-2 font-medium text-gray-500">Actions</th>
            </tr>
          </thead>
          <tbody id="shares-tbody"></tbody>
        </table>
      </div>
    `;

    const tbody = container.querySelector('#shares-tbody');
    for (const share of data.shares) {
      const tr = createShareRow(share);
      tbody.appendChild(tr);
    }

    bindAllRowEvents(container);

    if (canManage) {
      container.querySelector('#cleanup-btn')?.addEventListener('click', async () => {
        const btn = container.querySelector('#cleanup-btn');
        btn.disabled = true;
        btn.textContent = 'Cleaning...';
        try {
          const result = await api('/api/share/cleanup', { method: 'POST' });
          btn.textContent = `Cleaned ${result.cleaned} file(s)`;
          setTimeout(() => renderFileSharePage(), 1500);
        } catch (err) {
          btn.textContent = 'Error';
          setTimeout(() => { btn.textContent = 'Cleanup Expired'; btn.disabled = false; }, 2000);
        }
      });
    }

    connectSSE();
  } catch (err) {
    container.innerHTML = `<p class="text-red-500 text-sm">${err.message}</p>`;
  }
}

function createShareRow(share) {
  const canManage = hasPermission('share:manage');
  const isExpired = parseDbDate(share.expiresAt) < new Date();
  const tr = document.createElement('tr');
  tr.className = 'border-b border-gray-100 dark:border-gray-800';
  tr.dataset.shareId = share.shareId;
  tr.innerHTML = `
    <td class="py-2.5 pr-3">
      <div class="flex items-center gap-2">
        ${share.hasPassword ? '<span class="material-icons-outlined text-xs text-amber-500">lock</span>' : ''}
        <span class="truncate max-w-[200px]" title="${escapeHtml(share.fileName)}">${escapeHtml(share.fileName)}</span>
      </div>
    </td>
    <td class="py-2.5 pr-3 text-gray-500">${formatFileSize(share.fileSize)}</td>
    <td class="py-2.5 pr-3 text-gray-500 hidden md:table-cell dl-count">${share.downloadCount}</td>
    <td class="py-2.5 pr-3 hidden md:table-cell expiry-cell ${isExpired ? 'text-red-500' : 'text-gray-500'}">${formatDateTime(share.expiresAt)}</td>
    <td class="py-2.5">
      <div class="flex items-center gap-1">
        <button class="qr-btn p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" data-share-id="${share.shareId}" title="QR Code">
          <span class="material-icons-outlined text-sm">qr_code_2</span>
        </button>
        <button class="copy-btn p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800" data-share-id="${share.shareId}" title="Copy link">
          <span class="material-icons-outlined text-sm">content_copy</span>
        </button>
        ${canManage ? `
          <button class="delete-btn p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-red-500" data-share-id="${share.shareId}" title="Delete">
            <span class="material-icons-outlined text-sm">delete</span>
          </button>
        ` : ''}
      </div>
    </td>
  `;
  return tr;
}

function bindRowEvents(tr) {
  tr.querySelector('.qr-btn')?.addEventListener('click', () => {
    const shareId = tr.dataset.shareId;
    const link = `${window.location.origin}/#/share/${shareId}`;
    const existing = document.getElementById('qr-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'qr-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-xs w-full relative">
        <button id="qr-modal-close" class="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <span class="material-icons-outlined text-xl">close</span>
        </button>
        <div class="flex justify-center mb-3">${generateQRCode(link)}</div>
        <p class="text-xs text-center text-gray-500 break-all">${link}</p>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector('#qr-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  });

  tr.querySelector('.copy-btn')?.addEventListener('click', () => {
    const shareId = tr.dataset.shareId;
    const link = `${window.location.origin}/#/share/${shareId}`;
    navigator.clipboard.writeText(link);
    const icon = tr.querySelector('.copy-btn span');
    icon.textContent = 'check';
    setTimeout(() => { icon.textContent = 'content_copy'; }, 1500);
  });

  tr.querySelector('.delete-btn')?.addEventListener('click', async () => {
    const shareId = tr.dataset.shareId;
    if (!confirm('Delete this share? The file will be permanently removed.')) return;
    try {
      await api(`/api/share/${shareId}`, { method: 'DELETE' });
    } catch (err) {
      alert(err.message);
    }
  });
}

function bindAllRowEvents(container) {
  container.querySelectorAll('#shares-tbody tr').forEach(tr => bindRowEvents(tr));
}

async function renderAccountsTab(container) {
  if (!hasPermission('share:settings')) {
    container.innerHTML = `<p class="text-sm text-gray-500">You don't have permission to manage share accounts.</p>`;
    return;
  }

  container.innerHTML = `<p class="text-sm text-gray-500">Loading...</p>`;

  try {
    const data = await api('/api/share/accounts');
    const isDefaultMode = data.allowedIds.length === 0;

    container.innerHTML = `
      <div class="space-y-4">
        <div class="flex items-center justify-between flex-wrap gap-2">
          <div>
            <p class="text-sm font-medium">Allowed Accounts</p>
            <p class="text-xs text-gray-500 dark:text-gray-400">Select which accounts can be used for file sharing storage</p>
          </div>
          <span id="account-mode-badge" class="text-xs px-2 py-1 rounded-full ${isDefaultMode ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'}">
            ${isDefaultMode ? 'All Accounts (Default)' : `${data.allowedIds.length} Selected`}
          </span>
        </div>

        <div id="share-accounts-grid" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"></div>

        <div class="flex items-center gap-3 pt-2">
          <button id="save-share-accounts" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            Save
          </button>
          <button id="reset-share-accounts" class="px-4 py-2 bg-gray-100 dark:bg-gray-800 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
            Reset to Default
          </button>
          <p id="share-accounts-msg" class="text-sm hidden"></p>
        </div>
      </div>
    `;

    const gridEl = container.querySelector('#share-accounts-grid');

    for (const account of data.accounts) {
      const { pct, usedStr, limitStr } = formatStorageBar(account.storageUsed, account.storageLimit);
      const color = account.cardColor || '#6b7280';
      const isPrimary = account.isPrimary;

      const card = document.createElement('div');
      card.className = 'rounded-xl p-4 flex flex-col transition-shadow hover:shadow-md relative overflow-hidden';
      card.style.border = `2px solid ${color}`;
      card.style.borderTop = `4px solid ${color}`;

      card.innerHTML = `
        <div class="flex items-start justify-between gap-2 mb-3">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style="background: ${color}20;">
              <span class="material-icons-outlined text-xl" style="color: ${color};">account_circle</span>
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <p class="text-sm font-medium truncate">${escapeHtml(account.displayName || account.email)}</p>
              </div>
              <p class="text-xs text-gray-500 dark:text-gray-400 truncate">${escapeHtml(account.email)}</p>
            </div>
          </div>
          <label class="relative inline-flex items-center shrink-0 mt-1 ${isPrimary ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}">
            <input type="checkbox" class="sr-only peer share-account-toggle" data-account-id="${account.id}" data-is-primary="${isPrimary}" ${account.shareEnabled ? 'checked' : ''} ${isPrimary ? 'disabled checked' : ''}>
            <div class="w-9 h-5 bg-gray-300 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
          </label>
        </div>

        ${isPrimary ? '<span class="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 font-medium w-fit mb-2"><span class="material-icons-outlined" style="font-size: 10px;">star</span>Primary</span>' : ''}

        <div class="mt-auto">
          <div class="flex items-center justify-between mb-1">
            <span class="text-[10px] text-gray-500 dark:text-gray-400">${usedStr} / ${limitStr}</span>
            <span class="text-[10px] text-gray-400">${pct}%</span>
          </div>
          <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
            <div class="h-1.5 rounded-full transition-all" style="width: ${pct}%; background: ${color}"></div>
          </div>
        </div>
      `;
      gridEl.appendChild(card);
    }

    // Save handler
    container.querySelector('#save-share-accounts').addEventListener('click', async () => {
      const btn = container.querySelector('#save-share-accounts');
      const msgEl = container.querySelector('#share-accounts-msg');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      const toggles = container.querySelectorAll('.share-account-toggle');
      const nonPrimaryToggles = Array.from(toggles).filter(t => t.dataset.isPrimary !== 'true');
      const allNonPrimaryChecked = nonPrimaryToggles.every(t => t.checked);
      let allowedIds = [];

      if (!allNonPrimaryChecked) {
        // Include primary always + only checked non-primary accounts
        toggles.forEach(t => {
          if (t.dataset.isPrimary === 'true' || t.checked) {
            allowedIds.push(parseInt(t.dataset.accountId));
          }
        });
      }
      // If all non-primary are checked, allowedIds stays empty = default (all allowed)

      try {
        await api('/api/share/accounts', {
          method: 'PUT',
          body: JSON.stringify({ allowedIds })
        });
        msgEl.textContent = 'Accounts saved';
        msgEl.className = 'text-sm text-green-600';
        msgEl.classList.remove('hidden');
        setTimeout(() => renderFileSharePage(), 1000);
      } catch (err) {
        msgEl.textContent = err.message;
        msgEl.className = 'text-sm text-red-500';
        msgEl.classList.remove('hidden');
      }

      btn.disabled = false;
      btn.textContent = 'Save';
    });

    // Reset handler
    container.querySelector('#reset-share-accounts').addEventListener('click', async () => {
      const btn = container.querySelector('#reset-share-accounts');
      btn.disabled = true;
      btn.textContent = 'Resetting...';

      try {
        await api('/api/share/accounts', {
          method: 'PUT',
          body: JSON.stringify({ allowedIds: [] })
        });
        setTimeout(() => renderFileSharePage(), 500);
      } catch (err) {
        alert(err.message);
        btn.disabled = false;
        btn.textContent = 'Reset to Default';
      }
    });

  } catch (err) {
    container.innerHTML = `<p class="text-red-500 text-sm">${err.message}</p>`;
  }
}

async function renderSettingsTab(container) {
  if (!hasPermission('share:settings')) {
    container.innerHTML = `<p class="text-sm text-gray-500">You don't have permission to manage share settings.</p>`;
    return;
  }

  container.innerHTML = `<p class="text-sm text-gray-500">Loading...</p>`;

  try {
    const settings = await api('/api/share/settings');

    container.innerHTML = `
      <div class="max-w-lg space-y-6">
        <!-- General -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">General</h3>
          <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div>
              <p class="text-sm font-medium">Enable File Sharing</p>
              <p class="text-xs text-gray-500">Allow public file uploads</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" id="share-enabled" class="sr-only peer" ${settings.share_enabled === '1' ? 'checked' : ''}>
              <div class="w-9 h-5 bg-gray-300 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
          <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div>
              <p class="text-sm font-medium">Show Storage Bar</p>
              <p class="text-xs text-gray-500">Display storage usage on public upload page</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" id="share-show-storage" class="sr-only peer" ${settings.share_show_storage !== '0' ? 'checked' : ''}>
              <div class="w-9 h-5 bg-gray-300 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer dark:bg-gray-600 peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
            </label>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Share Folder ID</label>
            <input type="text" id="share-folder-id" value="${escapeHtml(settings.share_folder_id || '')}" placeholder="Google Drive folder ID for shared files" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
            <p class="text-xs text-gray-400 mt-1">Dedicated folder where shared files are stored</p>
          </div>
        </div>

        <!-- Expiry -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">Expiry</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Default (days)</label>
              <input type="number" id="share-default-expiry" value="${settings.share_default_expiry_days || '7'}" min="1" max="365" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Maximum (days)</label>
              <input type="number" id="share-max-expiry" value="${settings.share_max_expiry_days || '30'}" min="1" max="365" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
            </div>
          </div>
        </div>

        <!-- Limits -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">Limits</h3>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max File Size (MB)</label>
              <input type="number" id="share-max-size" value="${settings.share_max_file_size_mb || '100'}" min="1" max="4096" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rate Limit (uploads/hour/IP)</label>
              <input type="number" id="share-rate-limit" value="${settings.share_rate_limit_per_hour || '10'}" min="1" max="1000" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
            </div>
          </div>
        </div>

        <!-- Maintenance -->
        <div class="space-y-4">
          <h3 class="text-sm font-semibold text-gray-800 dark:text-gray-200">Maintenance</h3>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Cleanup Interval (minutes)</label>
            <input type="number" id="share-cleanup-interval" value="${settings.share_cleanup_interval_minutes || '60'}" min="1" max="1440" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
            <p class="text-xs text-gray-400 mt-1">How often expired files are scanned and removed. Requires server restart.</p>
          </div>
        </div>

        <button id="save-share-settings" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
          Save Settings
        </button>

        <p id="share-settings-msg" class="text-sm hidden"></p>
      </div>
    `;

    container.querySelector('#save-share-settings').addEventListener('click', async () => {
      const btn = container.querySelector('#save-share-settings');
      const msgEl = container.querySelector('#share-settings-msg');
      btn.disabled = true;
      btn.textContent = 'Saving...';

      try {
        await api('/api/share/settings', {
          method: 'PUT',
          body: JSON.stringify({
            share_enabled: container.querySelector('#share-enabled').checked ? '1' : '0',
            share_show_storage: container.querySelector('#share-show-storage').checked ? '1' : '0',
            share_folder_id: container.querySelector('#share-folder-id').value.trim(),
            share_default_expiry_days: container.querySelector('#share-default-expiry').value,
            share_max_expiry_days: container.querySelector('#share-max-expiry').value,
            share_max_file_size_mb: container.querySelector('#share-max-size').value,
            share_cleanup_interval_minutes: container.querySelector('#share-cleanup-interval').value,
            share_rate_limit_per_hour: container.querySelector('#share-rate-limit').value
          })
        });
        msgEl.textContent = 'Settings saved';
        msgEl.className = 'text-sm text-green-600';
        msgEl.classList.remove('hidden');
        setTimeout(() => msgEl.classList.add('hidden'), 3000);
      } catch (err) {
        msgEl.textContent = err.message;
        msgEl.className = 'text-sm text-red-500';
        msgEl.classList.remove('hidden');
      }

      btn.disabled = false;
      btn.textContent = 'Save Settings';
    });
  } catch (err) {
    container.innerHTML = `<p class="text-red-500 text-sm">${err.message}</p>`;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
