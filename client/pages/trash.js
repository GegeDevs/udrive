import { api } from '../api.js';
import { showToast } from '../components/toast.js';
import { hasPermission } from '../auth-state.js';

function getFileIcon(mimeType) {
  if (mimeType === 'application/vnd.google-apps.folder') return 'folder';
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'movie';
  if (mimeType?.startsWith('audio/')) return 'audio_file';
  if (mimeType?.includes('pdf')) return 'picture_as_pdf';
  if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return 'table_chart';
  if (mimeType?.includes('document') || mimeType?.includes('word')) return 'description';
  return 'insert_drive_file';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatFileSize(bytes) {
  if (!bytes || bytes === '0') return '—';
  const size = parseInt(bytes);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

export function renderTrashPage() {
  const main = document.getElementById('main-content');

  main.innerHTML = `
    <div class="p-3 md:p-6">
      <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h2 class="text-xl md:text-2xl font-semibold">Trash <span id="trash-count" class="text-gray-400 font-normal"></span></h2>
          <div class="flex items-center gap-2">
            <button id="btn-refresh-trash" class="btn-secondary text-sm">
              <span class="material-icons-outlined text-base md:text-lg">refresh</span>
              <span class="hidden sm:inline">Refresh</span>
            </button>
            ${hasPermission('trash:restore') ? `<button id="btn-restore-all" class="btn-secondary text-sm">
              <span class="material-icons-outlined text-base md:text-lg">restore_from_trash</span>
              <span class="hidden sm:inline">Restore All</span>
            </button>` : ''}
            ${hasPermission('trash:empty') ? `<button id="btn-empty-trash" class="btn-secondary text-sm">
              <span class="material-icons-outlined text-base md:text-lg">delete_forever</span>
              <span class="hidden sm:inline">Empty Trash</span>
            </button>` : ''}
          </div>
        </div>
      </div>
      <div id="trash-list">
        <div class="flex items-center justify-center h-64">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    </div>
  `;

  loadTrash();

  main.querySelector('#btn-refresh-trash').addEventListener('click', async () => {
    const btn = main.querySelector('#btn-refresh-trash');
    if (btn.disabled) return;
    btn.disabled = true;
    const icon = btn.querySelector('.material-icons-outlined');
    icon.classList.add('animate-spin');
    try {
      await loadTrash();
      showToast('Trash refreshed', 'success');
    } finally {
      icon.classList.remove('animate-spin');
      btn.disabled = false;
    }
  });

  main.querySelector('#btn-restore-all')?.addEventListener('click', async () => {
    if (!confirm('Restore ALL trashed files from all accounts?')) return;
    const btn = main.querySelector('#btn-restore-all');
    btn.disabled = true;
    const icon = btn.querySelector('.material-icons-outlined');
    icon.classList.add('animate-spin');

    try {
      const files = await api('/api/files/trash/list');
      let count = 0;
      let failed = 0;
      for (const file of files) {
        try {
          await api(`/api/files/${file.id}/restore`, {
            method: 'POST',
            body: JSON.stringify({ accountId: file.accountId })
          });
          count++;
        } catch (e) {
          failed++;
        }
      }
      if (failed > 0) {
        showToast(`Restored ${count} file(s), ${failed} failed`, 'warning');
      } else {
        showToast(`Restored ${count} file(s)`, 'success');
      }
      loadTrash();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      icon.classList.remove('animate-spin');
      btn.disabled = false;
    }
  });

  main.querySelector('#btn-empty-trash')?.addEventListener('click', async () => {
    if (!confirm('Permanently delete ALL trashed files from all accounts? This cannot be undone.')) return;
    const btn = main.querySelector('#btn-empty-trash');
    btn.disabled = true;
    const icon = btn.querySelector('.material-icons-outlined');
    icon.classList.add('animate-spin');

    try {
      const files = await api('/api/files/trash/list');
      let count = 0;
      for (const file of files) {
        try {
          await api(`/api/files/${file.id}/permanent-delete`, {
            method: 'POST',
            body: JSON.stringify({ accountId: file.accountId })
          });
          count++;
        } catch (e) {}
      }
      showToast(`Permanently deleted ${count} file(s)`, 'success');
      loadTrash();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      icon.classList.remove('animate-spin');
      btn.disabled = false;
    }
  });
}

async function loadTrash() {
  const container = document.getElementById('trash-list');

  try {
    const files = await api('/api/files/trash/list');

    const countEl = document.getElementById('trash-count');
    if (countEl) countEl.textContent = `(${files.length})`;

    if (files.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center h-48 text-gray-500 dark:text-gray-400">
          <span class="material-icons-outlined text-5xl mb-3">delete_outline</span>
          <p class="text-lg font-medium">Trash is empty</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
              <th class="pb-3 pt-2 sticky top-0 bg-white dark:bg-gray-900 z-[5]">Name</th>
              <th class="pb-3 pt-2 sticky top-0 bg-white dark:bg-gray-900 z-[5]">Owner</th>
              <th class="pb-3 pt-2 sticky top-0 bg-white dark:bg-gray-900 z-[5] hidden md:table-cell">Trashed</th>
              <th class="pb-3 pt-2 sticky top-0 bg-white dark:bg-gray-900 z-[5] hidden sm:table-cell">Size</th>
              <th class="pb-3 pt-2 pr-4 sticky top-0 bg-white dark:bg-gray-900 z-[5] w-24">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${files.map(file => `
              <tr class="border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800" data-id="${file.id}" data-account-id="${file.accountId}">
                <td class="py-2">
                  <div class="flex items-center gap-2">
                    <span class="material-icons-outlined text-xl text-gray-400">${getFileIcon(file.mimeType)}</span>
                    <span class="text-sm font-medium truncate max-w-[200px] md:max-w-md">${escapeHtml(file.name)}</span>
                  </div>
                </td>
                <td class="py-2 text-xs md:text-sm text-gray-500 dark:text-gray-400 truncate max-w-[120px] md:max-w-none">${escapeHtml(file.ownerEmail)}</td>
                <td class="py-2 text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell">${formatDate(file.trashedTime)}</td>
                <td class="py-2 text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell">${formatFileSize(file.size)}</td>
                <td class="py-2 pr-4">
                  <div class="flex items-center gap-1">
                    ${hasPermission('trash:restore') ? `<button class="btn-restore p-1.5 rounded-full hover:bg-green-50 dark:hover:bg-green-900/20 text-green-600 transition-colors" title="Restore">
                      <span class="material-icons-outlined text-base">restore</span>
                    </button>` : ''}
                    ${hasPermission('trash:permanent_delete') ? `<button class="btn-perm-delete p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors" title="Delete permanently">
                      <span class="material-icons-outlined text-base">delete_forever</span>
                    </button>` : ''}
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    container.querySelectorAll('.btn-restore').forEach(btn => {
      const row = btn.closest('tr');
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.querySelector('.material-icons-outlined').classList.add('animate-spin');
        try {
          await api(`/api/files/${row.dataset.id}/restore`, {
            method: 'POST',
            body: JSON.stringify({ accountId: parseInt(row.dataset.accountId) })
          });
          showToast('File restored', 'success');
          loadTrash();
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
          btn.querySelector('.material-icons-outlined').classList.remove('animate-spin');
        }
      });
    });

    container.querySelectorAll('.btn-perm-delete').forEach(btn => {
      const row = btn.closest('tr');
      btn.addEventListener('click', async () => {
        if (btn.disabled) return;
        if (!confirm('Permanently delete this file? This cannot be undone.')) return;
        btn.disabled = true;
        btn.querySelector('.material-icons-outlined').classList.add('animate-pulse');
        try {
          await api(`/api/files/${row.dataset.id}/permanent-delete`, {
            method: 'POST',
            body: JSON.stringify({ accountId: parseInt(row.dataset.accountId) })
          });
          showToast('Permanently deleted', 'success');
          loadTrash();
        } catch (err) {
          showToast(err.message, 'error');
          btn.disabled = false;
          btn.querySelector('.material-icons-outlined').classList.remove('animate-pulse');
        }
      });
    });

  } catch (err) {
    container.innerHTML = `<p class="text-red-500">${err.message}</p>`;
  }
}
