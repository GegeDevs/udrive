let queue = [];
let panelEl = null;
let isMinimized = false;
let abortControllers = new Map();
let onChangeCallback = null;
let panelRendered = false;

export function onDownloadChange(cb) {
  onChangeCallback = cb;
}

export function getDownloadState() {
  return {
    active: queue.filter(i => i.status === 'downloading').length,
    completed: queue.filter(i => i.status === 'done').length,
    total: queue.length
  };
}

export function downloadBackground(fileId, fileName) {
  const item = {
    id: Date.now() + Math.random(),
    fileId,
    fileName,
    status: 'downloading',
    progress: 0
  };
  queue.push(item);
  renderPanel(true);
  notifyChange();
  startDownload(item);
}

export async function downloadViaBrowser(fileId, fileName) {
  try {
    const res = await fetch(`/api/files/${fileId}/download-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) throw new Error('Failed to generate download link');
    const { token } = await res.json();
    const a = document.createElement('a');
    a.href = `/dlink/${token}`;
    a.download = fileName;
    a.click();
  } catch (err) {
    throw err;
  }
}

async function startDownload(item) {
  const controller = new AbortController();
  abortControllers.set(item.id, controller);

  try {
    const res = await fetch(`/api/files/${item.fileId}/download`, { signal: controller.signal });
    if (!res.ok) throw new Error('Download failed');

    const total = parseInt(res.headers.get('content-length') || '0');
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      item.progress = total > 0 ? Math.round((received / total) * 100) : 0;
      updateItemProgress(item);
      notifyChange();
    }

    const blob = new Blob(chunks);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.fileName;
    a.click();
    URL.revokeObjectURL(url);

    item.status = 'done';
    item.progress = 100;
  } catch (err) {
    if (err.name === 'AbortError') {
      item.status = 'cancelled';
    } else {
      item.status = 'failed';
      item.error = err.message;
    }
  }

  abortControllers.delete(item.id);
  renderPanel(true);
  notifyChange();
}

function cancelDownload(itemId) {
  const controller = abortControllers.get(itemId);
  if (controller) controller.abort();
}

function notifyChange() {
  if (onChangeCallback) onChangeCallback(getDownloadState());
}

function updateItemProgress(item) {
  if (!panelEl || isMinimized) return;
  const progressBar = panelEl.querySelector(`[data-progress-id="${item.id}"]`);
  const progressText = panelEl.querySelector(`[data-progress-text="${item.id}"]`);
  if (progressBar) progressBar.style.width = `${item.progress}%`;
  if (progressText) progressText.textContent = `${item.progress}%`;

  // Update header text
  const headerEl = panelEl.querySelector('#dl-header-text');
  if (headerEl) {
    const completedCount = queue.filter(i => i.status === 'done').length;
    headerEl.textContent = `Downloading ${completedCount + 1} of ${queue.length}`;
  }
}

function renderPanel(full = false) {
  if (queue.length === 0) return;

  if (!panelEl) {
    panelEl = document.createElement('div');
    panelEl.id = 'download-queue-panel';
    panelEl.className = 'fixed bottom-4 left-4 z-40 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col';
    document.body.appendChild(panelEl);
    panelRendered = false;
  }

  if (!full && panelRendered) return;

  const completedCount = queue.filter(i => i.status === 'done').length;
  const isAllDone = queue.every(i => i.status === 'done' || i.status === 'failed' || i.status === 'cancelled');

  let headerText = '';
  if (isAllDone) {
    const failedCount = queue.filter(i => i.status === 'failed').length;
    const cancelledCount = queue.filter(i => i.status === 'cancelled').length;
    headerText = `${completedCount} done${failedCount ? `, ${failedCount} failed` : ''}${cancelledCount ? `, ${cancelledCount} cancelled` : ''}`;
  } else {
    headerText = `Downloading ${completedCount + 1} of ${queue.length}`;
  }

  panelEl.innerHTML = `
    <div class="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 select-none">
      <span id="dl-header-text" class="text-sm font-medium">${headerText}</span>
      <div class="flex items-center">
        <button id="dl-panel-toggle" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <span class="material-icons-outlined text-base">${isMinimized ? 'expand_less' : 'expand_more'}</span>
        </button>
        <button id="dl-panel-close" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <span class="material-icons-outlined text-base">close</span>
        </button>
      </div>
    </div>
    ${isMinimized ? '' : `
      <div class="max-h-60 overflow-auto">
        ${queue.map(item => renderItem(item)).join('')}
      </div>
    `}
  `;

  panelRendered = true;

  panelEl.querySelector('#dl-panel-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    isMinimized = !isMinimized;
    renderPanel(true);
  });

  panelEl.querySelector('#dl-panel-close').addEventListener('click', (e) => {
    e.stopPropagation();
    queue = [];
    panelEl.remove();
    panelEl = null;
    panelRendered = false;
    notifyChange();
  });

  panelEl.querySelectorAll('.btn-cancel-dl').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelDownload(parseFloat(btn.dataset.id));
    });
  });
}

function renderItem(item) {
  let statusIcon = '';
  let statusColor = '';

  switch (item.status) {
    case 'downloading':
      statusIcon = 'download';
      statusColor = 'text-blue-500';
      break;
    case 'done':
      statusIcon = 'check_circle';
      statusColor = 'text-green-500';
      break;
    case 'failed':
      statusIcon = 'error';
      statusColor = 'text-red-500';
      break;
    case 'cancelled':
      statusIcon = 'cancel';
      statusColor = 'text-gray-400';
      break;
  }

  return `
    <div class="px-4 py-2 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span class="material-icons-outlined text-lg ${statusColor}">${statusIcon}</span>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-medium truncate">${escapeHtml(item.fileName)}</p>
        ${item.status === 'downloading' ? `
          <div class="mt-1 relative h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div data-progress-id="${item.id}" class="absolute inset-0 h-full rounded-full bg-blue-500 transition-all duration-300" style="width: ${item.progress}%"></div>
          </div>
        ` : ''}
        ${item.status === 'failed' ? `<p class="text-xs text-red-500 mt-0.5">${escapeHtml(item.error)}</p>` : ''}
        ${item.status === 'cancelled' ? `<p class="text-xs text-gray-400 mt-0.5">Cancelled</p>` : ''}
      </div>
      ${item.status === 'downloading' ? `
        <span data-progress-text="${item.id}" class="text-xs text-gray-400 shrink-0 w-8 text-right">${item.progress}%</span>
        <button class="btn-cancel-dl p-1 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors" data-id="${item.id}" title="Cancel">
          <span class="material-icons-outlined text-sm">close</span>
        </button>
      ` : ''}
    </div>
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
