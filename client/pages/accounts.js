import { api } from '../api.js';
import { renderStorageBar } from '../components/storage-bar.js';
import { showToast } from '../components/toast.js';
import { renderSidebar } from '../components/sidebar.js';
import { hasPermission } from '../auth-state.js';

export function renderAccountsPage() {
  const main = document.getElementById('main-content');

  main.innerHTML = `
    <div class="p-3 md:p-6">
      <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 class="text-xl md:text-2xl font-semibold">Accounts <span id="accounts-count" class="text-gray-400 font-normal"></span></h2>
          <div class="flex items-center gap-1.5 md:gap-2 flex-wrap">
          ${hasPermission('accounts:import_export') ? `<button id="btn-export-rclone" class="btn-secondary">
            <span class="material-icons-outlined text-base md:text-lg">download</span>
            <span class="hidden sm:inline">Export</span>
          </button>
          <button id="btn-import-rclone" class="btn-secondary">
            <span class="material-icons-outlined text-base md:text-lg">upload_file</span>
            <span class="hidden sm:inline">Import</span>
          </button>` : ''}
          ${hasPermission('accounts:refresh') ? `<button id="btn-refresh-all" class="btn-secondary">
            <span class="material-icons-outlined text-base md:text-lg">sync</span>
            <span class="hidden sm:inline">Refresh All</span>
          </button>` : ''}
          ${hasPermission('accounts:clean_all') ? `<button id="btn-clean-all" class="btn-secondary text-red-600 dark:text-red-400">
            <span class="material-icons-outlined text-base md:text-lg">delete_forever</span>
            <span class="hidden sm:inline">Clean All</span>
          </button>` : ''}
          ${hasPermission('accounts:add') ? `<a href="/auth/login" class="btn-primary">
            <span class="material-icons-outlined text-base md:text-lg">person_add</span>
            <span class="hidden sm:inline">Add Account</span>
          </a>` : ''}
        </div>
        </div>
      </div>
      <input type="file" id="rclone-file-input" class="hidden" accept=".conf,.txt">
      <div id="accounts-list" class="grid gap-4">
        <div class="flex items-center justify-center h-32">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    </div>

    <div id="rclone-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div class="p-5 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-lg font-semibold">Import from Rclone Config</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Select accounts to import</p>
        </div>
        <div id="rclone-accounts-list" class="flex-1 overflow-auto p-4 space-y-2"></div>
        <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" id="rclone-select-all" class="rounded border-gray-300 dark:border-gray-600">
            Select all
          </label>
          <div class="flex gap-2">
            <button id="rclone-cancel" class="btn-secondary text-sm">Cancel</button>
            <button id="rclone-import" class="btn-primary text-sm">Import Selected</button>
          </div>
        </div>
      </div>
    </div>

    <div id="export-select-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        <div class="p-5 border-b border-gray-200 dark:border-gray-700">
          <h3 class="text-lg font-semibold">Export to Rclone Config</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Select accounts to export</p>
        </div>
        <div id="export-accounts-list" class="flex-1 overflow-auto p-4 space-y-2"></div>
        <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <label class="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 cursor-pointer">
            <input type="checkbox" id="export-select-all" class="rounded border-gray-300 dark:border-gray-600">
            Select all
          </label>
          <div class="flex gap-2">
            <button id="export-cancel" class="btn-secondary text-sm">Cancel</button>
            <button id="export-generate" class="btn-primary text-sm">Export Selected</button>
          </div>
        </div>
      </div>
    </div>

    <div id="export-result-modal" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        <div class="p-5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
          <h3 class="text-lg font-semibold">Rclone Config</h3>
          <button id="export-result-close" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
            <span class="material-icons-outlined text-lg">close</span>
          </button>
        </div>
        <pre id="export-config-text" class="flex-1 overflow-auto p-4 text-sm font-mono text-gray-800 dark:text-gray-200 bg-gray-50 dark:bg-gray-900 whitespace-pre-wrap break-all"></pre>
        <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-end gap-2">
          <button id="export-copy" class="btn-secondary text-sm">
            <span class="material-icons-outlined text-lg">content_copy</span>
            Copy
          </button>
          <button id="export-download" class="btn-primary text-sm">
            <span class="material-icons-outlined text-lg">download</span>
            Download .conf
          </button>
        </div>
      </div>
    </div>
  `;

  loadAccounts();

  main.querySelector('#btn-export-rclone')?.addEventListener('click', showExportSelectModal);

  main.querySelector('#btn-refresh-all')?.addEventListener('click', async () => {
    const btn = main.querySelector('#btn-refresh-all');
    if (btn.disabled) return;
    btn.disabled = true;
    const icon = btn.querySelector('.material-icons-outlined');
    icon.classList.add('animate-spin');

    try {
      const accounts = await api('/api/accounts');
      for (const acc of accounts) {
        try {
          await api(`/api/accounts/${acc.id}/storage`);
        } catch (e) {}
      }
      showToast('All accounts refreshed', 'success');
      loadAccounts();
      renderSidebar();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      icon.classList.remove('animate-spin');
      btn.disabled = false;
    }
  });

  main.querySelector('#btn-clean-all')?.addEventListener('click', async () => {
    const btn = main.querySelector('#btn-clean-all');
    if (btn.disabled) return;

    if (!confirm('Permanently delete ALL files from EVERY configured Google Drive account? This cannot be undone.')) {
      return;
    }

    const confirmation = prompt('Type CLEAN ALL to permanently delete all files from every account:');
    if (confirmation !== 'CLEAN ALL') {
      return;
    }

    btn.disabled = true;
    const icon = btn.querySelector('.material-icons-outlined');
    icon.classList.add('animate-spin');

    try {
      const result = await api('/api/accounts/clean-all', {
        method: 'POST',
        body: JSON.stringify({ confirmation: 'CLEAN ALL' })
      });

      if (result.failed > 0) {
        showToast(`Deleted ${result.deleted} file(s); ${result.failed} failed`, 'error');
      } else {
        showToast(`Permanently deleted ${result.deleted} file(s)`, 'success');
      }

      loadAccounts();
      renderSidebar();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      icon.classList.remove('animate-spin');
      btn.disabled = false;
    }
  });

  main.querySelector('#btn-import-rclone')?.addEventListener('click', () => {
    main.querySelector('#rclone-file-input').click();
  });

  main.querySelector('#rclone-file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = '';

    const formData = new FormData();
    formData.append('config', file);

    try {
      const res = await fetch('/api/accounts/import-rclone/parse', {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      showRcloneModal(data);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function showRcloneModal(accounts) {
  const modal = document.getElementById('rclone-modal');
  const list = document.getElementById('rclone-accounts-list');

  list.innerHTML = accounts.map((acc, i) => `
    <label class="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors">
      <input type="checkbox" class="rclone-account-cb rounded border-gray-300 dark:border-gray-600" data-index="${i}">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${escapeHtml(acc.name)}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">Google Drive account</p>
      </div>
      <span class="material-icons-outlined text-gray-400">cloud</span>
    </label>
  `).join('');

  modal.classList.remove('hidden');

  const selectAllCb = document.getElementById('rclone-select-all');
  selectAllCb.checked = false;
  selectAllCb.addEventListener('change', () => {
    list.querySelectorAll('.rclone-account-cb').forEach(cb => {
      cb.checked = selectAllCb.checked;
    });
  });

  document.getElementById('rclone-cancel').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  document.getElementById('rclone-import').addEventListener('click', async () => {
    const selected = [];
    list.querySelectorAll('.rclone-account-cb:checked').forEach(cb => {
      selected.push(accounts[parseInt(cb.dataset.index)]);
    });

    if (selected.length === 0) {
      showToast('No accounts selected', 'error');
      return;
    }

    try {
      const res = await api('/api/accounts/import-rclone/import', {
        method: 'POST',
        body: JSON.stringify({ accounts: selected })
      });
      showToast(`Imported ${res.imported.length} account(s)`, 'success');
      modal.classList.add('hidden');
      loadAccounts();
      renderSidebar();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

async function showExportSelectModal() {
  const modal = document.getElementById('export-select-modal');
  const list = document.getElementById('export-accounts-list');

  let accounts;
  try {
    accounts = await api('/api/accounts');
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  if (accounts.length === 0) {
    showToast('No accounts to export', 'error');
    return;
  }

  list.innerHTML = accounts.map(acc => `
    <label class="flex items-center gap-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors">
      <input type="checkbox" class="export-account-cb rounded border-gray-300 dark:border-gray-600" data-id="${acc.id}">
      <div class="flex-1 min-w-0">
        <p class="text-sm font-medium truncate">${escapeHtml(acc.display_name || acc.email)}</p>
        <p class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(acc.email)}</p>
      </div>
      ${acc.is_primary ? '<span class="px-2 py-0.5 text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full">Primary</span>' : ''}
    </label>
  `).join('');

  modal.classList.remove('hidden');

  const selectAllCb = document.getElementById('export-select-all');
  selectAllCb.checked = false;
  selectAllCb.addEventListener('change', () => {
    list.querySelectorAll('.export-account-cb').forEach(cb => {
      cb.checked = selectAllCb.checked;
    });
  });

  document.getElementById('export-cancel').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  document.getElementById('export-generate').addEventListener('click', async () => {
    const selectedIds = [];
    list.querySelectorAll('.export-account-cb:checked').forEach(cb => {
      selectedIds.push(parseInt(cb.dataset.id));
    });

    if (selectedIds.length === 0) {
      showToast('No accounts selected', 'error');
      return;
    }

    try {
      const res = await api('/api/accounts/export-rclone', {
        method: 'POST',
        body: JSON.stringify({ accountIds: selectedIds })
      });
      modal.classList.add('hidden');
      showExportResultModal(res.config);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });
}

function showExportResultModal(configText) {
  const modal = document.getElementById('export-result-modal');
  const pre = document.getElementById('export-config-text');
  pre.textContent = configText;
  modal.classList.remove('hidden');

  document.getElementById('export-result-close').addEventListener('click', () => {
    modal.classList.add('hidden');
  });

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  document.getElementById('export-copy').addEventListener('click', () => {
    navigator.clipboard.writeText(configText).then(() => {
      showToast('Copied to clipboard', 'success');
    }).catch(() => {
      showToast('Failed to copy', 'error');
    });
  });

  document.getElementById('export-download').addEventListener('click', () => {
    const blob = new Blob([configText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rclone.conf';
    a.click();
    URL.revokeObjectURL(url);
    showToast('Download started', 'success');
  });
}

async function loadAccounts() {
  const container = document.getElementById('accounts-list');

  try {
    const accounts = await api('/api/accounts');

    const countEl = document.getElementById('accounts-count');
    if (countEl) countEl.textContent = `(${accounts.length})`;

    if (accounts.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-48 text-gray-500 dark:text-gray-400">
          <span class="material-icons-outlined text-5xl mb-3">people_outline</span>
          <p class="text-lg font-medium">No accounts connected</p>
          <p class="text-sm mt-1">Add a Google Drive account to get started</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
        ${accounts.map(acc => {
          const color = acc.card_color || '#4285F4';
          return `
          <div class="rounded-xl p-4 md:p-5 flex flex-col hover:shadow-md transition-shadow relative overflow-hidden" data-id="${acc.id}" style="border: 2px solid ${color}; border-top: 4px solid ${color};">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-10 h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center shrink-0" style="background: ${color}20;">
                <span class="material-icons-outlined text-xl md:text-2xl" style="color: ${color};">account_circle</span>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <p class="font-medium truncate text-sm md:text-base">${escapeHtml(acc.display_name || acc.email)}</p>
                  ${acc.is_primary ? '<span class="px-2 py-0.5 text-[10px] md:text-xs font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full shrink-0">Primary</span>' : ''}
                </div>
                <p class="text-xs md:text-sm text-gray-500 dark:text-gray-400 truncate">${escapeHtml(acc.email)}</p>
              </div>
            </div>
            <div class="mb-3">
              ${renderStorageBar(acc.storage_used, acc.storage_limit, acc.file_count)}
            </div>
            <div class="flex items-center gap-2 mt-auto">
              ${!acc.is_primary && hasPermission('accounts:set_primary') ? `
                <button class="btn-set-primary px-2 md:px-3 py-1 md:py-1.5 text-[10px] md:text-xs font-medium border border-gray-300 dark:border-gray-600 rounded-full hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 transition-colors" data-id="${acc.id}">
                  Set as Primary
                </button>
              ` : ''}
              <div class="ml-auto flex items-center gap-1">
                ${hasPermission('accounts:color') ? `<button class="btn-color p-1.5 md:p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" data-id="${acc.id}" data-color="${color}" title="Change color">
                  <span class="material-icons-outlined text-base md:text-lg" style="color: ${color};">palette</span>
                </button>` : ''}
                ${hasPermission('accounts:refresh') ? `<button class="btn-refresh p-1.5 md:p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" data-id="${acc.id}" title="Refresh storage">
                  <span class="material-icons-outlined text-base md:text-lg">refresh</span>
                </button>` : ''}
                ${hasPermission('accounts:remove') ? `<button class="btn-remove p-1.5 md:p-2 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors" data-id="${acc.id}" title="Remove account">
                  <span class="material-icons-outlined text-base md:text-lg">delete</span>
                </button>` : ''}
              </div>
            </div>
          </div>
        `;}).join('')}
      </div>
    `;

    container.querySelectorAll('.btn-set-primary').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.classList.add('opacity-50', 'pointer-events-none');
        try {
          await api(`/api/accounts/${btn.dataset.id}/primary`, { method: 'POST' });
          showToast('Primary account updated', 'success');
          loadAccounts();
          renderSidebar();
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
          btn.classList.remove('opacity-50', 'pointer-events-none');
        }
      });
    });

    container.querySelectorAll('.btn-refresh').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        const icon = btn.querySelector('.material-icons-outlined');
        icon.classList.add('animate-spin');
        try {
          await api(`/api/accounts/${btn.dataset.id}/storage`);
          showToast('Storage refreshed', 'success');
          loadAccounts();
          renderSidebar();
        } catch (err) {
          showToast(err.message, 'error');
          icon.classList.remove('animate-spin');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.btn-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        if (!confirm('Remove this account?')) return;
        btn.disabled = true;
        const icon = btn.querySelector('.material-icons-outlined');
        icon.classList.add('animate-pulse');
        try {
          await api(`/api/accounts/${btn.dataset.id}`, { method: 'DELETE' });
          showToast('Account removed', 'success');
          loadAccounts();
          renderSidebar();
        } catch (err) {
          showToast(err.message, 'error');
          icon.classList.remove('animate-pulse');
          btn.disabled = false;
        }
      });
    });

    container.querySelectorAll('.btn-color').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        showColorPicker(btn, btn.dataset.id, btn.dataset.color);
      });
    });

  } catch (err) {
    container.innerHTML = `<p class="text-red-500">${err.message}</p>`;
  }
}

const PALETTE_COLORS = [
  '#4285F4', '#EA4335', '#FBBC04', '#34A853', '#FF6D01',
  '#46BDC6', '#7BAAF7', '#F07B72', '#FCD04F', '#57BB8A',
  '#FF8BCB', '#A142F4', '#24C1E0', '#E37400', '#5F6368',
  '#1A73E8', '#D93025', '#F9AB00', '#1E8E3E', '#E8710A',
  '#129EAF', '#4ECDE6', '#EE675C', '#FDD663', '#81C995',
  '#FF63B8', '#9334E6', '#12B5CB', '#FA903E', '#BDC1C6'
];

function showColorPicker(anchorBtn, accountId, currentColor) {
  const existing = document.getElementById('color-picker-popup');
  if (existing) existing.remove();

  // Get colors already used by other accounts
  const allCards = document.querySelectorAll('[data-id]');
  const usedColors = [];
  allCards.forEach(card => {
    const btn = card.querySelector('.btn-color');
    if (btn && btn.dataset.id !== accountId) {
      usedColors.push(btn.dataset.color);
    }
  });

  const popup = document.createElement('div');
  popup.id = 'color-picker-popup';
  popup.className = 'absolute z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 w-52';

  popup.innerHTML = `
    <p class="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Choose color</p>
    <div class="grid grid-cols-6 gap-1.5 mb-3">
      ${PALETTE_COLORS.map(c => {
        const isUsed = usedColors.includes(c) && c !== currentColor;
        const isCurrent = c === currentColor;
        return `
          <button class="color-swatch w-6 h-6 rounded-full border-2 transition-transform ${isCurrent ? 'border-gray-900 dark:border-white scale-110' : isUsed ? 'border-transparent opacity-25 cursor-not-allowed' : 'border-transparent hover:scale-110'}" data-color="${c}" data-used="${isUsed}" style="background: ${c};"></button>
        `;
      }).join('')}
    </div>
    <div class="flex items-center gap-2">
      <input type="color" id="custom-color-input" value="${currentColor}" class="w-8 h-8 rounded cursor-pointer border-0 p-0">
      <span class="text-xs text-gray-500 dark:text-gray-400">Custom</span>
    </div>
  `;

  const rect = anchorBtn.getBoundingClientRect();
  popup.style.position = 'fixed';
  popup.style.left = `${Math.max(8, rect.left - 100)}px`;

  document.body.appendChild(popup);

  const popupRect = popup.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  if (spaceBelow < popupRect.height + 8) {
    popup.style.top = `${rect.top - popupRect.height - 4}px`;
  } else {
    popup.style.top = `${rect.bottom + 4}px`;
  }

  if (popupRect.right > window.innerWidth) {
    popup.style.left = `${window.innerWidth - popupRect.width - 8}px`;
  }

  popup.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', async () => {
      if (swatch.dataset.used === 'true') return;
      await applyColor(accountId, swatch.dataset.color);
      popup.remove();
    });
  });

  popup.querySelector('#custom-color-input').addEventListener('change', async (e) => {
    await applyColor(accountId, e.target.value);
    popup.remove();
  });

  function closeOnClick(e) {
    if (!popup.contains(e.target) && e.target !== anchorBtn) {
      popup.remove();
      document.removeEventListener('click', closeOnClick);
    }
  }
  setTimeout(() => document.addEventListener('click', closeOnClick), 0);
}

async function applyColor(accountId, color) {
  try {
    await api(`/api/accounts/${accountId}/color`, {
      method: 'PATCH',
      body: JSON.stringify({ color })
    });
    loadAccounts();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
