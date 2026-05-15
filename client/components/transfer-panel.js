let uploadQueue = [];
let downloadQueue = [];
let panelEl = null;
let floatingBtn = null;
let isMinimized = false;
let panelVisible = true;
let panelRendered = false;
let processing = false;
let uploadCompleteCallback = null;
let onChangeCallback = null;
let abortControllers = new Map();
let pausedDownloads = new Map();

// === Public API ===

export function onTransferChange(cb) {
  onChangeCallback = cb;
}

export function getTransferState() {
  return {
    uploads: {
      active: uploadQueue.filter(i => i.status === 'uploading').length,
      waiting: uploadQueue.filter(i => i.status === 'waiting').length,
      completed: uploadQueue.filter(i => i.status === 'done').length,
      total: uploadQueue.length
    },
    downloads: {
      active: downloadQueue.filter(i => i.status === 'downloading').length,
      completed: downloadQueue.filter(i => i.status === 'done').length,
      total: downloadQueue.length
    }
  };
}

export function onUploadComplete(callback) {
  uploadCompleteCallback = callback;
}

export function getAllTransfers() {
  return [
    ...uploadQueue.map(i => ({ ...i, name: i.file?.name, size: i.file?.size || 0 })),
    ...downloadQueue.map(i => ({ ...i, name: i.fileName, size: i.totalSize || 0 }))
  ];
}

// Upload
export function addToUploadQueue(file, folderId) {
  const item = { id: Date.now() + Math.random(), file, folderId, type: 'upload', status: 'waiting', progress: 0, speed: 0, error: null };
  uploadQueue.push(item);
  saveState();
  renderPanel(true);
  notifyChange();
  processUploadQueue();
  return item;
}

// Download background
export function downloadBackground(fileId, fileName) {
  const item = { id: Date.now() + Math.random(), fileId, fileName, type: 'download', status: 'downloading', progress: 0, speed: 0, received: 0, totalSize: 0 };
  downloadQueue.push(item);
  saveState();
  renderPanel(true);
  notifyChange();
  startDownload(item);
}

// Download browser
export async function downloadViaBrowser(fileId, fileName) {
  const res = await fetch(`/api/files/${fileId}/download-token`, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error('Failed to generate download link');
  const { token } = await res.json();
  const a = document.createElement('a');
  a.href = `/dlink/${token}`;
  a.download = fileName;
  a.click();
}

// === Upload Logic ===

async function processUploadQueue() {
  if (processing) return;
  processing = true;

  while (true) {
    const item = uploadQueue.find(i => i.status === 'waiting');
    if (!item) break;

    item.status = 'uploading';
    renderPanel(true);
    notifyChange();

    try {
      await uploadWithProgress(item);
      if (item.status === 'cancelled') continue;
      item.status = 'done';
      item.progress = 100;
      item.speed = 0;
    } catch (err) {
      if (item.status !== 'cancelled') {
        item.status = 'failed';
        item.error = err.message;
      }
    }
    saveState();
    renderPanel(true);
    notifyChange();
  }

  processing = false;

  if (uploadCompleteCallback && uploadQueue.every(i => i.status === 'done' || i.status === 'failed' || i.status === 'cancelled')) {
    uploadCompleteCallback();
  }
}

function uploadWithProgress(item) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    item._xhr = xhr;
    const formData = new FormData();
    formData.append('file', item.file);
    if (item.folderId) formData.append('folderId', item.folderId);

    let lastLoaded = 0;
    let lastTime = Date.now();

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        item.progress = Math.round((e.loaded / e.total) * 100);
        const now = Date.now();
        const elapsed = (now - lastTime) / 1000;
        if (elapsed > 0.5) {
          item.speed = (e.loaded - lastLoaded) / elapsed;
          lastLoaded = e.loaded;
          lastTime = now;
        }
        updateItemProgress(item);
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try { reject(new Error(JSON.parse(xhr.responseText).error || `Upload failed: ${xhr.status}`)); }
        catch { reject(new Error(`Upload failed: ${xhr.status}`)); }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('abort', () => reject(new Error('Cancelled')));
    xhr.open('POST', '/api/files/upload');
    xhr.send(formData);
  });
}

// === Download Logic ===

async function startDownload(item, startByte = 0) {
  const controller = new AbortController();
  abortControllers.set(item.id, controller);

  try {
    const headers = {};
    if (startByte > 0) headers['Range'] = `bytes=${startByte}-`;

    const res = await fetch(`/api/files/${item.fileId}/download`, { signal: controller.signal, headers });
    if (!res.ok && res.status !== 206) throw new Error('Download failed');

    const total = parseInt(res.headers.get('content-length') || '0') + startByte;
    item.totalSize = total;
    const reader = res.body.getReader();
    const chunks = pausedDownloads.get(item.id) || [];
    let received = startByte;
    let lastTime = Date.now();
    let lastReceived = received;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      item.received = received;
      item.progress = total > 0 ? Math.round((received / total) * 100) : 0;

      const now = Date.now();
      const elapsed = (now - lastTime) / 1000;
      if (elapsed > 0.5) {
        item.speed = (received - lastReceived) / elapsed;
        lastReceived = received;
        lastTime = now;
      }

      updateItemProgress(item);
      notifyChange();
    }

    pausedDownloads.delete(item.id);

    const blob = new Blob(chunks);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.fileName;
    a.click();
    URL.revokeObjectURL(url);

    item.status = 'done';
    item.progress = 100;
    item.speed = 0;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (item.status === 'paused') {
        // Keep chunks for resume
      } else {
        item.status = 'cancelled';
        pausedDownloads.delete(item.id);
      }
    } else {
      item.status = 'failed';
      item.error = err.message;
      pausedDownloads.delete(item.id);
    }
  }

  abortControllers.delete(item.id);
  saveState();
  renderPanel(true);
  notifyChange();
}

// === Transfer Controls ===

export function cancelTransfer(itemId) {
  // Download
  const controller = abortControllers.get(itemId);
  if (controller) {
    const dlItem = downloadQueue.find(i => i.id === itemId);
    if (dlItem) dlItem.status = 'cancelled';
    controller.abort();
    pausedDownloads.delete(itemId);
    renderPanel(true);
    notifyChange();
    return;
  }
  // Upload
  const uploadItem = uploadQueue.find(i => i.id === itemId);
  if (uploadItem) {
    if (uploadItem._xhr) uploadItem._xhr.abort();
    uploadItem.status = 'cancelled';
    renderPanel(true);
    notifyChange();
  }
}

export function pauseTransfer(itemId) {
  const dlItem = downloadQueue.find(i => i.id === itemId && i.status === 'downloading');
  if (dlItem) {
    dlItem.status = 'paused';
    dlItem.speed = 0;
    const controller = abortControllers.get(itemId);
    if (controller) controller.abort();
    renderPanel(true);
    notifyChange();
  }
}

export function resumeTransfer(itemId) {
  const dlItem = downloadQueue.find(i => i.id === itemId && i.status === 'paused');
  if (dlItem) {
    dlItem.status = 'downloading';
    startDownload(dlItem, dlItem.received || 0);
    renderPanel(true);
    notifyChange();
  }
}

// === State Persistence ===

function saveState() {
  const state = {
    uploads: uploadQueue.filter(i => i.status === 'waiting').map(i => ({ name: i.file?.name, folderId: i.folderId, size: i.file?.size })),
    downloads: downloadQueue.filter(i => i.status === 'downloading' || i.status === 'paused').map(i => ({ fileId: i.fileId, fileName: i.fileName }))
  };
  try { sessionStorage.setItem('udrive-transfers', JSON.stringify(state)); } catch {}
}

// === Shared ===

function notifyChange() {
  if (onChangeCallback) onChangeCallback(getTransferState());
  updateFloatingButton();
}

function updateItemProgress(item) {
  if (!panelEl || isMinimized || !panelVisible) return;
  const progressBar = panelEl.querySelector(`[data-progress-id="${item.id}"]`);
  const speedEl = panelEl.querySelector(`[data-speed-id="${item.id}"]`);
  if (progressBar) progressBar.style.width = `${item.progress}%`;
  if (speedEl) speedEl.textContent = formatSpeed(item.speed);

  const headerEl = panelEl.querySelector('#transfer-header-text');
  if (headerEl) headerEl.textContent = getHeaderText();
}

function getHeaderText() {
  const all = getAllTransfers();
  const active = all.filter(i => ['uploading', 'downloading', 'waiting'].includes(i.status)).length;
  const completed = all.filter(i => i.status === 'done').length;
  const total = all.length;

  if (active === 0) {
    const failed = all.filter(i => i.status === 'failed').length;
    return `${completed} complete${failed ? `, ${failed} failed` : ''}`;
  }
  return `${completed}/${total} transfers`;
}

// === Panel Rendering ===

export function showPanel() {
  panelVisible = true;
  if (floatingBtn) { floatingBtn.remove(); floatingBtn = null; }
  renderPanel(true);
}

export function hidePanel() {
  panelVisible = false;
  panelRendered = false;
  if (panelEl) { panelEl.remove(); panelEl = null; }
  showFloatingButton();
}

function showFloatingButton() {
  if (floatingBtn) floatingBtn.remove();
  const all = getAllTransfers();
  if (all.length === 0) return;

  floatingBtn = document.createElement('button');
  floatingBtn.id = 'transfer-floating-btn';
  floatingBtn.className = 'fixed bottom-4 right-4 z-40 w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-lg flex items-center justify-center transition-colors';

  updateFloatingButtonContent();
  floatingBtn.addEventListener('click', showPanel);
  document.body.appendChild(floatingBtn);
}

function updateFloatingButton() {
  if (!floatingBtn || panelVisible) return;
  updateFloatingButtonContent();
}

function updateFloatingButtonContent() {
  if (!floatingBtn) return;
  const all = getAllTransfers();
  const active = all.filter(i => ['uploading', 'downloading', 'waiting'].includes(i.status)).length;

  floatingBtn.innerHTML = `
    <span class="material-icons-outlined text-xl">${active > 0 ? 'sync' : 'check_circle'}</span>
    ${active > 0 ? `<span class="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">${active}</span>` : ''}
  `;
}

function renderPanel(full = false) {
  if (!panelVisible) { showFloatingButton(); return; }

  const all = getAllTransfers();
  if (all.length === 0) return;

  if (!panelEl) {
    panelEl = document.createElement('div');
    panelEl.id = 'transfer-panel';
    panelEl.className = 'fixed bottom-4 right-4 z-40 w-96 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col';
    document.body.appendChild(panelEl);
    panelRendered = false;
  }

  if (!full && panelRendered) return;

  panelEl.innerHTML = `
    <div class="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-700 select-none">
      <span id="transfer-header-text" class="text-sm font-medium">${getHeaderText()}</span>
      <div class="flex items-center">
        <button id="transfer-panel-toggle" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="${isMinimized ? 'Expand' : 'Minimize'}">
          <span class="material-icons-outlined text-base">${isMinimized ? 'expand_less' : 'expand_more'}</span>
        </button>
        <button id="transfer-panel-hide" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors" title="Hide panel">
          <span class="material-icons-outlined text-base">close</span>
        </button>
      </div>
    </div>
    ${isMinimized ? '' : `
      <div class="max-h-72 overflow-auto">
        ${all.map(item => renderItem(item)).join('')}
      </div>
    `}
  `;

  panelRendered = true;

  panelEl.querySelector('#transfer-panel-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    isMinimized = !isMinimized;
    renderPanel(true);
  });

  panelEl.querySelector('#transfer-panel-hide').addEventListener('click', (e) => {
    e.stopPropagation();
    hidePanel();
  });

  panelEl.querySelectorAll('.btn-cancel-transfer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      cancelTransfer(parseFloat(btn.dataset.id));
    });
  });

  panelEl.querySelectorAll('.btn-pause-transfer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      pauseTransfer(parseFloat(btn.dataset.id));
    });
  });

  panelEl.querySelectorAll('.btn-resume-transfer').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      resumeTransfer(parseFloat(btn.dataset.id));
    });
  });
}

function renderItem(item) {
  let statusIcon = '', statusColor = '';

  switch (item.status) {
    case 'waiting': statusIcon = 'schedule'; statusColor = 'text-gray-400'; break;
    case 'uploading': statusIcon = 'upload'; statusColor = 'text-blue-500'; break;
    case 'downloading': statusIcon = 'download'; statusColor = 'text-green-500'; break;
    case 'paused': statusIcon = 'pause_circle'; statusColor = 'text-yellow-500'; break;
    case 'done': statusIcon = 'check_circle'; statusColor = 'text-green-500'; break;
    case 'failed': statusIcon = 'error'; statusColor = 'text-red-500'; break;
    case 'cancelled': statusIcon = 'cancel'; statusColor = 'text-gray-400'; break;
  }

  const isActive = ['uploading', 'downloading', 'waiting'].includes(item.status);
  const isPaused = item.status === 'paused';
  const isDownloading = item.status === 'downloading';

  return `
    <div class="px-3 py-2 flex items-center gap-2 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span class="material-icons-outlined text-base ${statusColor}">${statusIcon}</span>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between">
          <p class="text-xs font-medium truncate max-w-[180px]">${escapeHtml(item.name)}</p>
          <span data-speed-id="${item.id}" class="text-[10px] text-gray-400 shrink-0 ml-1">${isActive ? formatSpeed(item.speed) : ''}</span>
        </div>
        ${isActive || isPaused ? `
          <div class="mt-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div data-progress-id="${item.id}" class="h-full rounded-full ${item.type === 'upload' ? 'bg-blue-500' : 'bg-green-500'} ${isPaused ? 'opacity-50' : ''} transition-all duration-300" style="width: ${item.progress}%"></div>
          </div>
          <div class="flex items-center justify-between mt-0.5">
            <span class="text-[10px] text-gray-400">${item.progress}%</span>
            <span class="text-[10px] text-gray-400">${formatSize(item.size || item.totalSize || 0)}</span>
          </div>
        ` : ''}
        ${item.status === 'failed' ? `<p class="text-[10px] text-red-500 mt-0.5">${escapeHtml(item.error)}</p>` : ''}
        ${item.status === 'cancelled' ? `<p class="text-[10px] text-gray-400 mt-0.5">Cancelled</p>` : ''}
      </div>
      <div class="flex items-center gap-0.5 shrink-0">
        ${isDownloading ? `<button class="btn-pause-transfer p-1 rounded-full hover:bg-yellow-50 dark:hover:bg-yellow-900/20 text-yellow-500 transition-colors" data-id="${item.id}" title="Pause">
          <span class="material-icons-outlined text-sm">pause</span>
        </button>` : ''}
        ${isPaused ? `<button class="btn-resume-transfer p-1 rounded-full hover:bg-green-50 dark:hover:bg-green-900/20 text-green-500 transition-colors" data-id="${item.id}" title="Resume">
          <span class="material-icons-outlined text-sm">play_arrow</span>
        </button>` : ''}
        ${isActive || isPaused ? `<button class="btn-cancel-transfer p-1 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 transition-colors" data-id="${item.id}" title="Cancel">
          <span class="material-icons-outlined text-sm">close</span>
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
