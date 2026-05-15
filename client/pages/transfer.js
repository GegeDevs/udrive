import { getAllTransfers, cancelTransfer, pauseTransfer, resumeTransfer, onTransferChange } from '../components/transfer-panel.js';

export function renderTransferPage() {
  const main = document.getElementById('main-content');
  let lastStatuses = '';

  render(true);
  onTransferChange(() => {
    const all = getAllTransfers();
    const statuses = all.map(i => i.status).join(',');
    if (statuses !== lastStatuses) {
      render(true);
    } else {
      updateProgress();
    }
  });

  function updateProgress() {
    const all = getAllTransfers();
    for (const item of all) {
      const bar = main.querySelector(`[data-tp-bar="${item.id}"]`);
      const speed = main.querySelector(`[data-tp-speed="${item.id}"]`);
      const pct = main.querySelector(`[data-tp-pct="${item.id}"]`);
      if (bar) bar.style.width = `${item.progress}%`;
      if (speed) speed.textContent = formatSpeed(item.speed);
      if (pct) pct.textContent = `${item.progress}%`;
    }
  }

  function render(full) {
    const all = getAllTransfers();
    lastStatuses = all.map(i => i.status).join(',');

    main.innerHTML = `
      <div class="p-3 md:p-6">
        <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-4">
          <h2 class="text-xl md:text-2xl font-semibold">Transfers <span class="text-gray-400 font-normal">(${all.length})</span></h2>
        </div>
        ${all.length === 0 ? `
          <div class="flex flex-col items-center justify-center h-48 text-gray-500 dark:text-gray-400">
            <span class="material-icons-outlined text-5xl mb-3">swap_vert</span>
            <p class="text-lg font-medium">No transfers</p>
            <p class="text-sm mt-1">Upload or download files to see them here</p>
          </div>
        ` : `
          <div class="space-y-2">
            ${all.map(item => renderTransferItem(item)).join('')}
          </div>
        `}
      </div>
    `;

    main.querySelectorAll('.btn-page-cancel').forEach(btn => {
      btn.addEventListener('click', () => cancelTransfer(parseFloat(btn.dataset.id)));
    });
    main.querySelectorAll('.btn-page-pause').forEach(btn => {
      btn.addEventListener('click', () => pauseTransfer(parseFloat(btn.dataset.id)));
    });
    main.querySelectorAll('.btn-page-resume').forEach(btn => {
      btn.addEventListener('click', () => resumeTransfer(parseFloat(btn.dataset.id)));
    });
  }
}

function renderTransferItem(item) {
  let statusIcon = '', statusColor = '', statusLabel = '';

  switch (item.status) {
    case 'waiting': statusIcon = 'schedule'; statusColor = 'text-gray-400'; statusLabel = 'Waiting'; break;
    case 'uploading': statusIcon = 'upload'; statusColor = 'text-blue-500'; statusLabel = 'Uploading'; break;
    case 'downloading': statusIcon = 'download'; statusColor = 'text-green-500'; statusLabel = 'Downloading'; break;
    case 'paused': statusIcon = 'pause_circle'; statusColor = 'text-yellow-500'; statusLabel = 'Paused'; break;
    case 'done': statusIcon = 'check_circle'; statusColor = 'text-green-500'; statusLabel = 'Complete'; break;
    case 'failed': statusIcon = 'error'; statusColor = 'text-red-500'; statusLabel = 'Failed'; break;
    case 'cancelled': statusIcon = 'cancel'; statusColor = 'text-gray-400'; statusLabel = 'Cancelled'; break;
  }

  const isActive = ['uploading', 'downloading', 'waiting'].includes(item.status);
  const isPaused = item.status === 'paused';
  const isDownloading = item.status === 'downloading';

  return `
    <div class="border border-gray-200 dark:border-gray-700 rounded-lg p-3 flex items-center gap-3">
      <span class="material-icons-outlined text-2xl ${statusColor}">${statusIcon}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between mb-1">
          <p class="text-sm font-medium truncate">${escapeHtml(item.name)}</p>
          <span class="text-xs text-gray-400 shrink-0 ml-2">${formatSize(item.size || item.totalSize || 0)}</span>
        </div>
        ${isActive || isPaused ? `
          <div class="h-2 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden mb-1">
            <div data-tp-bar="${item.id}" class="h-full rounded-full ${item.type === 'upload' ? 'bg-blue-500' : 'bg-green-500'} ${isPaused ? 'opacity-50' : ''} transition-all duration-300" style="width: ${item.progress}%"></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-xs text-gray-500"><span data-tp-pct="${item.id}">${item.progress}%</span> · ${statusLabel}</span>
            <span data-tp-speed="${item.id}" class="text-xs text-gray-400">${formatSpeed(item.speed)}</span>
          </div>
        ` : `
          <span class="text-xs ${item.status === 'failed' ? 'text-red-500' : 'text-gray-500'}">${statusLabel}${item.error ? ': ' + escapeHtml(item.error) : ''}</span>
        `}
      </div>
      <div class="flex items-center gap-1 shrink-0">
        ${isDownloading ? `<button class="btn-page-pause p-1.5 rounded-full hover:bg-yellow-50 dark:hover:bg-yellow-900/20 text-yellow-500 transition-colors" data-id="${item.id}" title="Pause">
          <span class="material-icons-outlined text-base">pause</span>
        </button>` : ''}
        ${isPaused ? `<button class="btn-page-resume p-1.5 rounded-full hover:bg-green-50 dark:hover:bg-green-900/20 text-green-500 transition-colors" data-id="${item.id}" title="Resume">
          <span class="material-icons-outlined text-base">play_arrow</span>
        </button>` : ''}
        ${isActive || isPaused ? `<button class="btn-page-cancel p-1.5 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors" data-id="${item.id}" title="Cancel">
          <span class="material-icons-outlined text-base">close</span>
        </button>` : ''}
      </div>
    </div>
  `;
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec <= 0) return '';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
