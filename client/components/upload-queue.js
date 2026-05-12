let queue = [];
let isMinimized = false;
let panelEl = null;

export function addToUploadQueue(file, folderId) {
  const item = {
    id: Date.now() + Math.random(),
    file,
    folderId,
    status: 'waiting',
    progress: 0,
    error: null
  };
  queue.push(item);
  renderPanel();
  processQueue();
  return item;
}

let processing = false;

async function processQueue() {
  if (processing) return;
  processing = true;

  while (true) {
    const item = queue.find(i => i.status === 'waiting');
    if (!item) break;

    item.status = 'uploading';
    renderPanel();

    try {
      await uploadWithProgress(item);
      item.status = 'done';
      item.progress = 100;
    } catch (err) {
      item.status = 'failed';
      item.error = err.message;
    }
    renderPanel();
  }

  processing = false;

  // Auto-hide after 3s if all done
  const allDone = queue.every(i => i.status === 'done' || i.status === 'failed');
  if (allDone && queue.length > 0) {
    setTimeout(() => {
      if (queue.every(i => i.status === 'done' || i.status === 'failed')) {
        // Keep panel visible but don't auto-close
      }
    }, 3000);
  }
}

async function uploadWithProgress(item) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', item.file);
    if (item.folderId) formData.append('folderId', item.folderId);

    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        item.progress = Math.round((e.loaded / e.total) * 100);
        renderPanel();
      }
    });

    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          const data = JSON.parse(xhr.responseText);
          reject(new Error(data.error || `Upload failed: ${xhr.status}`));
        } catch {
          reject(new Error(`Upload failed: ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

    xhr.open('POST', '/api/files/upload');
    xhr.send(formData);
  });
}

export function onUploadComplete(callback) {
  uploadCompleteCallback = callback;
}

let uploadCompleteCallback = null;

function renderPanel() {
  if (queue.length === 0) return;

  if (!panelEl) {
    panelEl = document.createElement('div');
    panelEl.id = 'upload-queue-panel';
    panelEl.className = 'fixed bottom-4 right-4 z-40 w-80 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden flex flex-col';
    document.body.appendChild(panelEl);
  }

  const completedCount = queue.filter(i => i.status === 'done').length;
  const totalCount = queue.length;
  const isAllDone = queue.every(i => i.status === 'done' || i.status === 'failed');

  let headerText = '';
  if (isAllDone) {
    const failedCount = queue.filter(i => i.status === 'failed').length;
    headerText = failedCount > 0
      ? `${completedCount} uploaded, ${failedCount} failed`
      : `${completedCount} upload${completedCount > 1 ? 's' : ''} complete`;
    if (uploadCompleteCallback) {
      uploadCompleteCallback();
    }
  } else {
    const uploading = queue.find(i => i.status === 'uploading');
    headerText = `Uploading ${completedCount + 1} of ${totalCount}`;
  }

  panelEl.innerHTML = `
    <div class="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 cursor-pointer select-none" id="upload-panel-header">
      <span class="text-sm font-medium">${headerText}</span>
      <div class="flex items-center gap-1">
        <button id="upload-panel-toggle" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <span class="material-icons-outlined text-base">${isMinimized ? 'expand_less' : 'expand_more'}</span>
        </button>
        <button id="upload-panel-close" class="p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          <span class="material-icons-outlined text-base">close</span>
        </button>
      </div>
    </div>
    ${isMinimized ? '' : `
      <div class="max-h-60 overflow-auto">
        ${queue.map(item => renderQueueItem(item)).join('')}
      </div>
    `}
  `;

  panelEl.querySelector('#upload-panel-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    isMinimized = !isMinimized;
    renderPanel();
  });

  panelEl.querySelector('#upload-panel-header').addEventListener('click', () => {
    isMinimized = !isMinimized;
    renderPanel();
  });

  panelEl.querySelector('#upload-panel-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closePanel();
  });
}

function renderQueueItem(item) {
  let statusIcon = '';
  let statusColor = '';

  switch (item.status) {
    case 'waiting':
      statusIcon = 'schedule';
      statusColor = 'text-gray-400';
      break;
    case 'uploading':
      statusIcon = 'upload';
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
  }

  return `
    <div class="px-4 py-2 flex items-center gap-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
      <span class="material-icons-outlined text-lg ${statusColor}">${statusIcon}</span>
      <div class="flex-1 min-w-0">
        <p class="text-xs font-medium truncate">${escapeHtml(item.file.name)}</p>
        ${item.status === 'uploading' ? `
          <div class="mt-1 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
            <div class="h-full rounded-full bg-blue-500 transition-all duration-200" style="width: ${item.progress}%"></div>
          </div>
        ` : ''}
        ${item.status === 'failed' ? `<p class="text-xs text-red-500 mt-0.5 truncate">${escapeHtml(item.error)}</p>` : ''}
      </div>
      <span class="text-xs text-gray-400 shrink-0">${formatSize(item.file.size)}</span>
    </div>
  `;
}

function closePanel() {
  queue = [];
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
}

function formatSize(bytes) {
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
