import { api } from '../api.js';
import { getQueryParams } from '../router.js';
import { renderBreadcrumb } from '../components/breadcrumb.js';
import { showContextMenu, hideContextMenu } from '../components/context-menu.js';
import { showToast } from '../components/toast.js';
import { uploadDroppedEntries } from '../components/drop-upload.js';
import { addToUploadQueue, onUploadComplete, downloadBackground, downloadViaBrowser, addTransferOwnership } from '../components/transfer-panel.js';
import { renderSidebar } from '../components/sidebar.js';
import { hasPermission } from '../auth-state.js';
import { formatDateTime } from '../time-utils.js';

let folderStack = [];
let currentFiles = [];
let folderFiles = [];
let searchActive = false;
const searchFolderTrail = new Map();
let selectedFiles = new Set();
let viewMode = localStorage.getItem('udrive-view-mode') || 'list';

let clipboard = {
  files: [],
  action: null, // 'copy' or 'cut'
  sourceFolderId: null
};

function setClipboard(action) {
  const params = getQueryParams();
  clipboard = {
    files: [...selectedFiles].map(id => {
      const file = currentFiles.find(f => f.id === id);
      return { id, name: file?.name, mimeType: file?.mimeType };
    }),
    action,
    sourceFolderId: params.get('folderId') || null
  };
  showToast(`${clipboard.files.length} item(s) ${action === 'copy' ? 'copied' : 'cut'}`, 'info');
  updatePasteButton();
}

function updatePasteButton() {
  const btn = document.getElementById('btn-paste');
  if (!btn) return;
  if (clipboard.files.length > 0) {
    if (btn.tagName === 'SPAN') {
      const newBtn = document.createElement('button');
      newBtn.id = 'btn-paste';
      newBtn.className = 'btn-secondary';
      newBtn.innerHTML = '<span class="material-icons-outlined text-base md:text-lg">content_paste</span><span class="hidden sm:inline">Paste</span>';
      newBtn.addEventListener('click', pasteFiles);
      btn.replaceWith(newBtn);
    }
  } else {
    if (btn.tagName === 'BUTTON') {
      const placeholder = document.createElement('span');
      placeholder.id = 'btn-paste';
      placeholder.className = 'hidden';
      btn.replaceWith(placeholder);
    }
  }
}

async function pasteFiles() {
  if (clipboard.files.length === 0) return;

  const params = getQueryParams();
  const destinationId = params.get('folderId') || null;

  let success = 0;
  for (const file of clipboard.files) {
    try {
      if (clipboard.action === 'copy') {
        await api(`/api/files/${file.id}/copy`, {
          method: 'POST',
          body: JSON.stringify({ destinationId })
        });
      } else {
        await api(`/api/files/${file.id}/move`, {
          method: 'POST',
          body: JSON.stringify({ newParentId: destinationId, oldParentId: clipboard.sourceFolderId })
        });
      }
      success++;
    } catch (err) {
      showToast(`Failed: ${err.message}`, 'error');
    }
  }

  showToast(`${success} item(s) pasted`, 'success');

  if (clipboard.action === 'cut') {
    clipboard = { files: [], action: null, sourceFolderId: null };
  }
  updatePasteButton();
  loadFiles(destinationId);
  renderSidebar();
}

function saveFolderStack() {
  sessionStorage.setItem('udrive-folder-stack', JSON.stringify(folderStack));
}

function loadFolderStack() {
  try {
    return JSON.parse(sessionStorage.getItem('udrive-folder-stack')) || [];
  } catch {
    return [];
  }
}

function isPreviewable(mimeType) {
  if (!mimeType) return false;
  if (mimeType.startsWith('image/')) return true;
  if (mimeType.startsWith('video/')) return true;
  if (mimeType.startsWith('text/')) return true;
  if (mimeType === 'application/json') return true;
  if (mimeType === 'application/javascript') return true;
  if (mimeType === 'application/xml') return true;
  if (mimeType === 'application/pdf') return true;
  return false;
}

function isTextType(mimeType) {
  if (mimeType.startsWith('text/')) return true;
  if (mimeType === 'application/json') return true;
  if (mimeType === 'application/javascript') return true;
  if (mimeType === 'application/xml') return true;
  return false;
}

function openPreview(fileId, name, mimeType) {
  const existing = document.getElementById('preview-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'preview-modal';
  modal.className = 'fixed inset-0 z-50 bg-black/80';

  let contentHtml = '';

  if (mimeType.startsWith('image/')) {
    contentHtml = `<img src="/api/files/${fileId}/preview" alt="${escapeAttr(name)}" class="w-full h-full object-contain">`;
  } else if (mimeType.startsWith('video/')) {
    contentHtml = `<video src="/api/files/${fileId}/preview" controls preload="metadata" class="w-full h-full object-contain"></video>`;
  } else if (mimeType === 'application/pdf') {
    contentHtml = `<iframe src="/api/files/${fileId}/preview" title="${escapeAttr(name)}" class="w-full h-full border-0 bg-white"></iframe>`;
  } else if (isTextType(mimeType)) {
    contentHtml = `
      <div class="bg-white dark:bg-gray-800 w-full h-full flex flex-col">
        <pre id="text-preview-content" class="flex-1 overflow-auto p-4 text-sm font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">Loading...</pre>
      </div>
    `;
  }

  modal.innerHTML = `
    <div class="absolute inset-0 flex flex-col">
      <div class="flex items-center justify-between gap-2 px-3 py-1.5 bg-black/80 text-white shrink-0">
        <p class="truncate text-xs font-medium">${escapeHtml(name)}</p>
        <button id="preview-close" class="btn-icon hover:bg-white/10 text-white transition-colors shrink-0">
          <span class="material-icons-outlined text-lg">close</span>
        </button>
      </div>
      <div class="preview-content relative flex-1 min-h-0" onclick="event.stopPropagation()">
        ${contentHtml}
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector('#preview-close').addEventListener('click', (e) => {
    e.stopPropagation();
    modal.remove();
  });
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') {
      modal.remove();
      document.removeEventListener('keydown', handler);
    }
  });

  if (isTextType(mimeType)) {
    fetch(`/api/files/${fileId}/preview`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to load file');
        return res.text();
      })
      .then(text => {
        const el = document.getElementById('text-preview-content');
        if (el) el.textContent = text;
      })
      .catch(err => {
        const el = document.getElementById('text-preview-content');
        if (el) el.textContent = `Error: ${err.message}`;
      });
  }
}

function getFileIcon(mimeType) {
  if (mimeType === 'application/vnd.google-apps.folder') return 'folder';
  if (mimeType === 'application/vnd.google-apps.shortcut') return 'shortcut';
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'movie';
  if (mimeType?.startsWith('audio/')) return 'audio_file';
  if (mimeType?.includes('pdf')) return 'picture_as_pdf';
  if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return 'table_chart';
  if (mimeType?.includes('document') || mimeType?.includes('word')) return 'description';
  if (mimeType?.includes('presentation') || mimeType?.includes('powerpoint')) return 'slideshow';
  if (mimeType?.includes('zip') || mimeType?.includes('archive') || mimeType?.includes('compressed')) return 'folder_zip';
  return 'insert_drive_file';
}

function getFileIconColor(mimeType) {
  if (mimeType === 'application/vnd.google-apps.folder') return 'text-gray-500 dark:text-gray-400';
  if (mimeType === 'application/vnd.google-apps.shortcut') return 'text-gray-500 dark:text-gray-400';
  if (mimeType?.startsWith('image/')) return 'text-red-500';
  if (mimeType?.startsWith('video/')) return 'text-red-600';
  if (mimeType?.includes('pdf')) return 'text-red-500';
  if (mimeType?.includes('spreadsheet') || mimeType?.includes('excel')) return 'text-green-600';
  if (mimeType?.includes('document') || mimeType?.includes('word')) return 'text-blue-600';
  if (mimeType?.includes('presentation') || mimeType?.includes('powerpoint')) return 'text-yellow-600';
  return 'text-gray-400';
}

function formatFileSize(bytes) {
  if (!bytes || bytes === '0') return '—';
  const size = parseInt(bytes);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function clearSelection() {
  selectedFiles.clear();
  updateSelectionUI();
}

function toggleSelection(fileId) {
  if (selectedFiles.has(fileId)) {
    selectedFiles.delete(fileId);
  } else {
    selectedFiles.add(fileId);
  }
  updateSelectionUI();
}

function selectAll() {
  if (selectedFiles.size === currentFiles.length) {
    selectedFiles.clear();
  } else {
    currentFiles.forEach(f => selectedFiles.add(f.id));
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  document.querySelectorAll('.file-item').forEach(row => {
    const id = row.dataset.id;
    if (selectedFiles.has(id)) {
      row.classList.add('selected');
    } else {
      row.classList.remove('selected');
    }
  });

  const bulkBar = document.getElementById('bulk-actions');
  if (bulkBar) {
    if (selectedFiles.size >= 2) {
      bulkBar.classList.remove('hidden');
      bulkBar.querySelector('.selected-count').textContent = `${selectedFiles.size} selected`;
    } else {
      bulkBar.classList.add('hidden');
    }
  }
}

// Opening a folder from search results must rebuild the breadcrumb from the
// folder's real ancestors, not just append it under "My Drive".
function navigateToFolder(id, name) {
  const trail = searchActive ? searchFolderTrail.get(id) : null;
  if (trail) {
    folderStack = [...trail, { id, name }];
  } else {
    folderStack.push({ id, name });
  }
  saveFolderStack();
  window.location.hash = `/?folderId=${id}`;
}

async function loadFiles(folderId) {
  const main = document.getElementById('main-content');
  const params = folderId ? `?folderId=${folderId}` : '';

  try {
    folderFiles = await api(`/api/files${params}`);
    currentFiles = folderFiles;
    searchActive = false;
    const searchInput = document.getElementById('file-search');
    if (searchInput) searchInput.value = '';
    selectedFiles.clear();
    renderFileList(main, folderId);
  } catch (err) {
    main.querySelector('.file-list-container').innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
        <span class="material-icons-outlined text-5xl mb-3">cloud_off</span>
        <p class="text-lg font-medium">Cannot load files</p>
        <p class="text-sm mt-1">${err.message}</p>
      </div>
    `;
  }
}

function renderFileList(main, folderId) {
  const container = main.querySelector('.file-list-container');

  if (currentFiles.length === 0) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center h-full text-gray-500 dark:text-gray-400">
        <span class="material-icons-outlined text-5xl mb-3">${searchActive ? 'search_off' : 'folder_open'}</span>
        <p class="text-lg font-medium">${searchActive ? 'No files match' : 'This folder is empty'}</p>
        <p class="text-sm mt-1">${searchActive ? 'Try a different keyword' : 'Upload files or create a folder to get started'}</p>
      </div>
    `;
    return;
  }

  if (viewMode === 'grid') {
    renderGridView(container);
  } else {
    renderListView(container);
  }
}

function renderListView(container) {
  container.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full border-collapse">
        <thead>
          <tr class="text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-700">
            <th class="pb-3 pt-2 sticky top-0 bg-white dark:bg-gray-900 z-[5] pl-4">Name</th>
            <th class="pb-3 pt-2 hidden md:table-cell sticky top-0 bg-white dark:bg-gray-900 z-[5]">Modified</th>
            <th class="pb-3 pt-2 hidden sm:table-cell sticky top-0 bg-white dark:bg-gray-900 z-[5]">Size</th>
            <th class="pb-3 pt-2 pr-4 w-10 sticky top-0 bg-white dark:bg-gray-900 z-[5]"></th>
          </tr>
        </thead>
      <tbody>
        ${currentFiles.map(file => {
          const targetId = file.shortcutDetails?.targetId || '';
          const targetMime = file.shortcutDetails?.targetMimeType || '';
          return `
          <tr class="file-item border-b border-gray-100 dark:border-gray-800 cursor-pointer select-none"
              data-id="${file.id}" data-name="${escapeAttr(file.name)}" data-mime="${file.mimeType}" data-target-id="${targetId}" data-target-mime="${targetMime}">
            <td class="py-2 pl-4">
              <div class="flex items-center gap-3">
                <span class="material-icons-outlined text-2xl ${getFileIconColor(file.mimeType)}">${getFileIcon(file.mimeType)}</span>
                <div class="min-w-0">
                  <p class="text-sm font-medium truncate max-w-md">${escapeHtml(file.name)}</p>
                  ${file.path ? `<p class="text-[11px] text-gray-400 dark:text-gray-500 truncate max-w-md">${escapeHtml(file.path)}</p>` : ''}
                </div>
              </div>
            </td>
            <td class="py-2 text-sm text-gray-500 dark:text-gray-400 hidden md:table-cell">${formatDateTime(file.modifiedTime)}</td>
            <td class="py-2 text-sm text-gray-500 dark:text-gray-400 hidden sm:table-cell">${file.mimeType === 'application/vnd.google-apps.folder' ? '—' : formatFileSize(file.size)}</td>
            <td class="py-2 pr-4">
              <button class="file-more-btn btn-icon hover:bg-gray-200 dark:hover:bg-gray-700">
                <span class="material-icons-outlined text-lg">more_vert</span>
              </button>
            </td>
          </tr>
        `;}).join('')}
      </tbody>
      </table>
    </div>
  `;

  bindFileEvents(container);
}

function renderGridView(container) {
  container.innerHTML = `
    <div class="grid relative grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-3">
      ${currentFiles.map(file => {
        const isImage = file.mimeType?.startsWith('image/');
        const targetId = file.shortcutDetails?.targetId || '';
        const targetMime = file.shortcutDetails?.targetMimeType || '';
        const thumbnail = isImage
          ? `<div class="thumb-container absolute inset-0 flex items-center justify-center" data-file-id="${file.id}">
              <span class="material-icons-outlined text-4xl text-gray-300 dark:text-gray-600 thumb-placeholder">image</span>
            </div>`
          : `<span class="material-icons-outlined text-5xl ${getFileIconColor(file.mimeType)}">${getFileIcon(file.mimeType)}</span>`;

        return `
        <div class="file-item group relative flex flex-col overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:shadow-md hover:border-blue-300 dark:hover:border-blue-700 transition-all cursor-pointer select-none"
             data-id="${file.id}" data-name="${escapeAttr(file.name)}" data-mime="${file.mimeType}" data-target-id="${targetId}" data-target-mime="${targetMime}"
             title="${escapeAttr(file.name)}">
          <div class="relative flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-gray-50 dark:bg-gray-800/60">
            ${thumbnail}
            <button class="file-more-btn btn-icon absolute top-1.5 right-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 shadow-sm opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100">
              <span class="material-icons-outlined text-base leading-none">more_vert</span>
            </button>
          </div>
          <div class="min-w-0 px-2.5 py-2">
            <p class="text-xs font-medium leading-snug line-clamp-2 break-words min-h-[2.25rem]">${escapeHtml(file.name)}</p>
            <p class="text-[11px] text-gray-400 dark:text-gray-500 mt-1 truncate">${file.mimeType === 'application/vnd.google-apps.folder' ? 'Folder' : formatFileSize(file.size)}</p>
          </div>
        </div>
      `;
      }).join('')}
    </div>
  `;

  bindFileEvents(container);
  initThumbnailLazyLoad(container);
  initMarqueeSelection(container);
}

function initMarqueeSelection(container) {
  const grid = container.querySelector('.grid');
  if (!grid) return;

  let start = null;
  let box = null;
  let additive = false;

  grid.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.file-item, button')) return;
    additive = e.ctrlKey || e.metaKey || e.shiftKey;
    start = { x: e.clientX, y: e.clientY };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    e.preventDefault();
  });

  function onMove(e) {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!box && Math.hypot(dx, dy) < 4) return;

    const gridRect = grid.getBoundingClientRect();
    if (!box) {
      box = document.createElement('div');
      box.className = 'absolute z-20 rounded border border-blue-500/70 bg-blue-500/10 pointer-events-none';
      grid.appendChild(box);
      if (!additive) clearSelection();
    }

    const left = Math.min(e.clientX, start.x);
    const top = Math.min(e.clientY, start.y);
    const width = Math.abs(dx);
    const height = Math.abs(dy);

    box.style.left = `${left - gridRect.left}px`;
    box.style.top = `${top - gridRect.top}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;

    const hit = new Set(additive ? selectedFiles : []);
    grid.querySelectorAll('.file-item').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.left < left + width && r.right > left && r.top < top + height && r.bottom > top) {
        hit.add(el.dataset.id);
      }
    });
    selectedFiles.clear();
    hit.forEach(id => selectedFiles.add(id));
    updateSelectionUI();
  }

  function onUp() {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    if (box) {
      box.remove();
      box = null;
      selectionMode = selectedFiles.size > 0;
    }
    start = null;
  }
}

function initThumbnailLazyLoad(container) {
  const thumbContainers = container.querySelectorAll('.thumb-container');
  if (thumbContainers.length === 0) return;

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        const fileId = el.dataset.fileId;
        loadThumbnail(el, fileId);
        observer.unobserve(el);
      }
    });
  }, { rootMargin: '100px' });

  thumbContainers.forEach(el => observer.observe(el));
}

function loadThumbnail(container, fileId) {
  const img = new Image();
  img.className = 'w-full h-full object-cover';
  img.decoding = 'async';

  img.onload = () => {
    container.innerHTML = '';
    container.appendChild(img);
  };

  img.onerror = () => {
    // Keep placeholder icon on failure
  };

  img.src = `/api/files/${fileId}/thumbnail?size=200`;
}

let lastClickedIndex = -1;
let selectionMode = false;

function bindFileEvents(container) {
  const fileItems = container.querySelectorAll('.file-item');

  fileItems.forEach((row, index) => {
    let longPressTimer = null;

    row.addEventListener('dblclick', () => {
      if (selectionMode) return;
      const mime = row.dataset.mime;
      const id = row.dataset.id;
      const name = row.dataset.name;
      const targetId = row.dataset.targetId;
      const targetMime = row.dataset.targetMime;

      if (mime === 'application/vnd.google-apps.folder') {
        navigateToFolder(id, name);
      } else if (mime === 'application/vnd.google-apps.shortcut' && targetMime === 'application/vnd.google-apps.folder') {
        navigateToFolder(targetId, name);
      } else if (mime === 'application/vnd.google-apps.shortcut' && targetMime && isPreviewable(targetMime)) {
        openPreview(targetId, name, targetMime);
      } else if (isPreviewable(mime)) {
        openPreview(id, name, mime);
      }
    });

    // Long press for touch devices
    row.addEventListener('touchstart', (e) => {
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        selectionMode = true;
        toggleSelection(row.dataset.id);
        lastClickedIndex = index;
      }, 500);
    }, { passive: true });

    row.addEventListener('touchend', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });

    row.addEventListener('touchmove', () => {
      if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
    });

    row.addEventListener('click', (e) => {
      if (e.target.closest('.file-more-btn')) return;

      if (selectionMode) {
        e.preventDefault();
        toggleSelection(row.dataset.id);
        lastClickedIndex = index;
        if (selectedFiles.size === 0) selectionMode = false;
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        selectionMode = true;
        toggleSelection(row.dataset.id);
        lastClickedIndex = index;
      } else if (e.shiftKey && lastClickedIndex >= 0) {
        e.preventDefault();
        const start = Math.min(lastClickedIndex, index);
        const end = Math.max(lastClickedIndex, index);
        selectedFiles.clear();
        for (let i = start; i <= end; i++) {
          const item = fileItems[i];
          if (item) selectedFiles.add(item.dataset.id);
        }
        selectionMode = true;
        updateSelectionUI();
      } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        if (selectedFiles.size > 0) {
          clearSelection();
          selectionMode = false;
        }
        lastClickedIndex = index;
      }
    });

    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showFileContextMenu(e.clientX, e.clientY, row.dataset);
    });

    row.querySelector('.file-more-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      showFileContextMenu(rect.left, rect.bottom, row.dataset);
    });
  });
}

function showFileContextMenu(x, y, dataset) {
  const isFolder = dataset.mime === 'application/vnd.google-apps.folder';
  const items = [];

  if (isFolder) {
    items.push({ icon: 'folder_open', label: 'Open', action: 'open', handler: () => {
      navigateToFolder(dataset.id, dataset.name);
    }});
  } else {
    if (isPreviewable(dataset.mime) && hasPermission('drive:preview')) {
      items.push({ icon: 'visibility', label: 'Preview', action: 'preview', handler: () => openPreview(dataset.id, dataset.name, dataset.mime) });
    }
    if (hasPermission('drive:download_browser')) {
      items.push({ icon: 'download', label: 'Download (Browser)', action: 'download-browser', handler: () => downloadViaBrowserAction(dataset.id, dataset.name) });
    }
    if (hasPermission('drive:download_background')) {
      items.push({ icon: 'downloading', label: 'Download (Background)', action: 'download-bg', handler: () => downloadBackground(dataset.id, dataset.name) });
    }
  }

  items.push({ icon: 'info', label: 'Info', action: 'info', handler: () => showFileInfo(dataset.id) });

  if (hasPermission('drive:copy')) {
    items.push({ icon: 'content_copy', label: 'Copy', action: 'copy', handler: () => {
      if (!selectedFiles.has(dataset.id)) {
        selectedFiles.clear();
        selectedFiles.add(dataset.id);
        updateSelectionUI();
      }
      setClipboard('copy');
    }});
  }

  if (hasPermission('drive:move')) {
    items.push({ icon: 'content_cut', label: 'Cut', action: 'cut', handler: () => {
      if (!selectedFiles.has(dataset.id)) {
        selectedFiles.clear();
        selectedFiles.add(dataset.id);
        updateSelectionUI();
      }
      setClipboard('cut');
    }});
  }

  if (hasPermission('drive:rename')) {
    items.push({ icon: 'drive_file_rename_outline', label: 'Rename', action: 'rename', handler: () => renameAction(dataset.id, dataset.name) });
  }

  if (hasPermission('drive:transfer_owner') && !isFolder) {
    items.push({ icon: 'swap_horiz', label: 'Transfer Owner', action: 'transfer', handler: () => showTransferModal(dataset.id, dataset.name) });
  }

  if (hasPermission('drive:delete')) {
    items.push({ divider: true });
    items.push({ icon: 'delete', label: 'Delete', action: 'delete', handler: () => deleteAction(dataset.id, dataset.name) });
  }

  showContextMenu(x, y, items);
}

async function showTransferModal(fileId, fileName, fileSize = 0, bulkFiles = null) {
  const existing = document.getElementById('transfer-owner-modal');
  if (existing) existing.remove();

  let accounts;
  try {
    accounts = await api('/api/accounts');
  } catch (err) {
    showToast(err.message, 'error');
    return;
  }

  // Get file info for size and current owner
  let currentOwner = '—';
  let totalSize = fileSize;

  if (bulkFiles) {
    totalSize = bulkFiles.reduce((sum, f) => sum + (parseInt(f.size) || 0), 0);
  } else if (!fileSize) {
    try {
      const info = await api(`/api/files/${fileId}/info`);
      totalSize = parseInt(info.size) || 0;
      currentOwner = info.uploaderName || info.uploaderEmail || '—';
    } catch {}
  }

  const fileLabel = bulkFiles ? `${bulkFiles.length} files` : escapeHtml(fileName);

  const modal = document.createElement('div');
  modal.id = 'transfer-owner-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm mx-4 flex flex-col max-h-[80vh]">
      <div class="p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 class="text-sm font-semibold">Transfer Ownership</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mt-1 truncate">${fileLabel}</p>
        <div class="flex items-center gap-3 mt-2 text-xs text-gray-500 dark:text-gray-400">
          <span>Size: <strong>${formatFileSize(totalSize)}</strong></span>
          ${!bulkFiles ? `<span>Owner: <strong>${escapeHtml(currentOwner)}</strong></span>` : ''}
        </div>
      </div>
      <div class="p-4 overflow-auto space-y-2">
        <p class="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Select target account:</p>
        ${accounts.map(acc => {
          const freeSpace = acc.storage_limit - acc.storage_used;
          const hasSpace = freeSpace >= totalSize;
          return `
          <label class="flex items-center gap-3 p-2 rounded-lg border ${hasSpace ? 'border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer' : 'border-red-200 dark:border-red-900 bg-red-50/50 dark:bg-red-900/10 opacity-60 cursor-not-allowed'}">
            <input type="radio" name="transfer-target" value="${acc.id}" class="text-blue-600" ${!hasSpace ? 'disabled' : ''}>
            <div class="flex-1 min-w-0">
              <p class="text-sm font-medium truncate">${escapeHtml(acc.display_name || acc.email)}</p>
              <p class="text-[10px] text-gray-500 dark:text-gray-400">${(acc.storage_used / (1024**3)).toFixed(1)} / ${(acc.storage_limit / (1024**3)).toFixed(0)} GB · Free: ${formatFileSize(freeSpace)}</p>
            </div>
            ${acc.is_primary ? '<span class="text-[10px] px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 rounded-full shrink-0">Primary</span>' : ''}
            ${!hasSpace ? '<span class="text-[10px] px-1.5 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded-full shrink-0">Full</span>' : ''}
          </label>
        `;}).join('')}
      </div>
      <div class="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-2">
        <button id="transfer-cancel" class="btn-secondary text-sm">Cancel</button>
        <button id="transfer-confirm" class="btn-primary text-sm">Transfer</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  modal.querySelector('#transfer-cancel').addEventListener('click', () => modal.remove());

  modal.querySelector('#transfer-confirm').addEventListener('click', async () => {
    const selected = modal.querySelector('input[name="transfer-target"]:checked');
    if (!selected) { showToast('Select a target account', 'error'); return; }

    const targetId = parseInt(selected.value);

    if (bulkFiles) {
      for (const f of bulkFiles) {
        addTransferOwnership(f.id, f.name, targetId);
      }
      showToast(`${bulkFiles.length} transfer(s) started in background`, 'info');
    } else {
      addTransferOwnership(fileId, fileName, targetId);
      showToast('Transfer started in background', 'info');
    }
    modal.remove();
  });
}

async function downloadViaBrowserAction(fileId, name) {
  try {
    await downloadViaBrowser(fileId, name);
    showToast('Download started in browser', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function renameAction(fileId, currentName) {
  const newName = prompt('Enter new name:', currentName);
  if (!newName || newName === currentName) return;

  try {
    await api(`/api/files/${fileId}`, { method: 'PATCH', body: JSON.stringify({ name: newName }) });
    showToast('Renamed successfully', 'success');
    const params = getQueryParams();
    loadFiles(params.get('folderId'));
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteAction(fileId, name) {
  if (!confirm(`Delete "${name}"?`)) return;

  try {
    const result = await api(`/api/files/${fileId}`, { method: 'DELETE' });

    if (result.queued) {
      showToast('Delete queued — track it in Progress', 'info');
      currentFiles = currentFiles.filter(f => f.id !== fileId);
      const params = getQueryParams();
      renderFileList(document.getElementById('main-content'), params.get('folderId'));
      return;
    }

    if (result.success === false) {
      showToast(`Partial delete: ${result.deletedFiles || 0} files, ${result.deletedFolders || 0} folders deleted, ${result.failed || 0} failed`, 'error');
    } else {
      showToast('Deleted successfully', 'success');
    }

    const params = getQueryParams();
    loadFiles(params.get('folderId'));
    renderSidebar();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function bulkDelete() {
  const count = selectedFiles.size;
  if (!confirm(`Delete ${count} item(s)?`)) return;

  try {
    const fileIds = [...selectedFiles];
    const result = await api('/api/files/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ fileIds })
    });

    if (result.queued) {
      showToast(`${count} item(s) queued for deletion — track it in Progress`, 'info');
      currentFiles = currentFiles.filter(f => !selectedFiles.has(f.id));
      selectedFiles.clear();
      const params = getQueryParams();
      renderFileList(document.getElementById('main-content'), params.get('folderId'));
      return;
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function bulkDownload() {
  for (const fileId of selectedFiles) {
    const file = currentFiles.find(f => f.id === fileId);
    if (file && file.mimeType !== 'application/vnd.google-apps.folder') {
      downloadBackground(fileId, file.name);
    }
  }
}

async function showFileInfo(fileId) {
  const panel = document.getElementById('file-info-panel');
  panel.classList.remove('hidden');
  panel.innerHTML = `
    <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
      <h3 class="font-semibold text-sm">File Info</h3>
      <button id="close-info-panel" class="btn-icon hover:bg-gray-100 dark:hover:bg-gray-800">
        <span class="material-icons-outlined text-lg">close</span>
      </button>
    </div>
    <div class="p-4 flex items-center justify-center h-32">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
    </div>
  `;

  panel.querySelector('#close-info-panel').addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  try {
    const info = await api(`/api/files/${fileId}/info`);

    const detailsHtml = `
      <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 class="font-semibold text-sm">File Info</h3>
        <button id="close-info-panel" class="btn-icon hover:bg-gray-100 dark:hover:bg-gray-800">
          <span class="material-icons-outlined text-lg">close</span>
        </button>
      </div>
      <div class="p-4 space-y-4">
        <div class="flex flex-col items-center pb-4 border-b border-gray-200 dark:border-gray-700">
          <span class="material-icons-outlined text-5xl ${getFileIconColor(info.mimeType)} mb-2">${getFileIcon(info.mimeType)}</span>
          <p class="text-sm font-medium text-center break-all">${escapeHtml(info.name)}</p>
        </div>
        <div class="space-y-3 text-sm">
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400 uppercase font-medium">File ID</p>
            <p class="mt-0.5 font-mono text-xs break-all select-all">${info.id}</p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400 uppercase font-medium">Type</p>
            <p class="mt-0.5">${info.mimeType || '—'}</p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400 uppercase font-medium">Size</p>
            <p class="mt-0.5">${formatFileSize(info.size)}</p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400 uppercase font-medium">Created</p>
            <p class="mt-0.5">${formatDateTime(info.createdTime)}</p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400 uppercase font-medium">Modified</p>
            <p class="mt-0.5">${formatDateTime(info.modifiedTime)}</p>
          </div>
          <div>
            <p class="text-xs text-gray-500 dark:text-gray-400 uppercase font-medium">Uploader</p>
            <div class="mt-1 flex items-center gap-2">
              <span class="material-icons-outlined text-lg text-blue-500">account_circle</span>
              <div>
                <p class="font-medium">${escapeHtml(info.uploaderName || info.uploaderEmail || 'Unknown')}</p>
                ${info.uploaderEmail ? `<p class="text-xs text-gray-500 dark:text-gray-400">${escapeHtml(info.uploaderEmail)}</p>` : ''}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    panel.innerHTML = detailsHtml;
    panel.querySelector('#close-info-panel').addEventListener('click', () => {
      panel.classList.add('hidden');
    });
  } catch (err) {
    panel.innerHTML = `
      <div class="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h3 class="font-semibold text-sm">File Info</h3>
        <button id="close-info-panel" class="btn-icon hover:bg-gray-100 dark:hover:bg-gray-800">
          <span class="material-icons-outlined text-lg">close</span>
        </button>
      </div>
      <div class="p-4 text-sm text-red-500">${err.message}</div>
    `;
    panel.querySelector('#close-info-panel').addEventListener('click', () => {
      panel.classList.add('hidden');
    });
  }
}

export function renderFilesPage() {
  const main = document.getElementById('main-content');
  const params = getQueryParams();
  const folderId = params.get('folderId');

  if (!folderId) {
    folderStack = [];
    saveFolderStack();
  } else {
    // Restore stack from sessionStorage if empty (e.g. page refresh)
    if (folderStack.length === 0) {
      folderStack = loadFolderStack();
    }
    // Trim stack if navigating back via breadcrumb
    const idx = folderStack.findIndex(f => f.id === folderId);
    if (idx !== -1) {
      folderStack = folderStack.slice(0, idx + 1);
      saveFolderStack();
    }
  }

  main.innerHTML = `
    <div class="flex h-full">
      <div class="flex-1 flex flex-col min-h-0">
        <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 p-3 md:p-6 pb-0 md:pb-0">
          <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
            <div class="min-w-0 overflow-hidden">
              ${renderBreadcrumb(folderStack)}
            </div>
            <div class="flex items-center gap-1.5 md:gap-2 shrink-0">
              <div class="relative">
                <span class="material-icons-outlined absolute left-2 top-1/2 -translate-y-1/2 text-base text-gray-400 pointer-events-none">search</span>
                <input id="file-search" type="search" placeholder="Search name"
                  class="w-32 sm:w-48 pl-8 pr-2 py-1.5 text-sm rounded-full border border-gray-300 dark:border-gray-600 bg-transparent focus:outline-none focus:border-blue-500">
              </div>
              <div class="flex items-center border border-gray-300 dark:border-gray-600 rounded-full overflow-hidden">
                <button id="btn-view-list" class="btn-chip ${viewMode === 'list' ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}" title="List view">
                  <span class="material-icons-outlined text-base md:text-lg">view_list</span>
                </button>
                <button id="btn-view-grid" class="btn-chip ${viewMode === 'grid' ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}" title="Grid view">
                  <span class="material-icons-outlined text-base md:text-lg">grid_view</span>
                </button>
            </div>
            ${clipboard.files.length > 0 ? `<button id="btn-paste" class="btn-secondary">
              <span class="material-icons-outlined text-base md:text-lg">content_paste</span>
              <span class="hidden sm:inline">Paste</span>
            </button>` : '<span id="btn-paste" class="hidden"></span>'}
            ${hasPermission('drive:create_folder') ? `<button id="btn-new-folder" class="btn-secondary">
              <span class="material-icons-outlined text-base md:text-lg">create_new_folder</span>
              <span class="hidden sm:inline">New Folder</span>
            </button>` : ''}
            ${hasPermission('drive:upload') ? `<button id="btn-upload" class="btn-primary">
              <span class="material-icons-outlined text-base md:text-lg">upload</span>
              <span class="hidden sm:inline">Upload</span>
            </button>
            <input type="file" id="file-input" class="hidden" multiple>` : ''}
          </div>
        </div>
        </div>

        <div id="bulk-actions" class="hidden fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/90 border border-blue-200 dark:border-blue-800 rounded-full shadow-lg backdrop-blur">
          <span class="selected-count text-xs font-medium text-blue-700 dark:text-blue-300 mr-2">0 selected</span>
          ${hasPermission('drive:copy') ? `<button id="bulk-copy" class="btn-icon hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300" title="Copy">
            <span class="material-icons-outlined">content_copy</span>
          </button>` : ''}
          ${hasPermission('drive:move') ? `<button id="bulk-cut" class="btn-icon hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300" title="Cut">
            <span class="material-icons-outlined">content_cut</span>
          </button>` : ''}
          ${(hasPermission('drive:download_browser') || hasPermission('drive:download_background')) ? `<button id="bulk-download" class="btn-icon hover:bg-blue-100 dark:hover:bg-blue-800 text-blue-700 dark:text-blue-300" title="Download">
            <span class="material-icons-outlined">download</span>
          </button>` : ''}
          ${hasPermission('drive:delete') ? `<button id="bulk-delete" class="btn-icon hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600" title="Delete">
            <span class="material-icons-outlined">delete</span>
          </button>` : ''}
          ${hasPermission('drive:transfer_owner') ? `<button id="bulk-transfer" class="btn-icon hover:bg-purple-100 dark:hover:bg-purple-900/30 text-purple-600" title="Transfer Owner">
            <span class="material-icons-outlined">swap_horiz</span>
          </button>` : ''}
          <button id="bulk-clear" class="btn-icon hover:bg-gray-200 dark:hover:bg-gray-700" title="Clear">
            <span class="material-icons-outlined">close</span>
          </button>
        </div>

        <div class="file-list-container flex-1 overflow-auto p-3 md:p-6 pt-0 md:pt-0 pb-20">
          <div class="flex items-center justify-center h-full">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        </div>
      </div>
      <aside id="file-info-panel" class="hidden w-full md:w-72 border-l-0 md:border-l border-gray-200 dark:border-gray-700 overflow-auto shrink-0"></aside>
    </div>
  `;

  main.querySelector('#btn-view-list').addEventListener('click', () => {
    viewMode = 'list';
    localStorage.setItem('udrive-view-mode', 'list');
    renderFilesPage();
  });

  main.querySelector('#btn-view-grid').addEventListener('click', () => {
    viewMode = 'grid';
    localStorage.setItem('udrive-view-mode', 'grid');
    renderFilesPage();
  });

  const searchInput = main.querySelector('#file-search');
  let searchTimer = null;
  searchInput?.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    searchTimer = setTimeout(() => runSearch(q), 350);
  });

  async function runSearch(q) {
    const container = main.querySelector('.file-list-container');
    if (q.length < 2) {
      searchActive = false;
      currentFiles = folderFiles;
      renderFileList(main, folderId);
      return;
    }

    searchActive = true;
    container.innerHTML = `
      <div class="flex items-center justify-center h-40">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    `;

    try {
      const { matches } = await api(`/api/files/search?q=${encodeURIComponent(q)}`);
      if (searchInput.value.trim() !== q) return;
      matches.forEach(m => { if (m.trail) searchFolderTrail.set(m.id, m.trail); });
      currentFiles = matches;
      renderFileList(main, folderId);
    } catch (err) {
      container.innerHTML = `<p class="text-red-500 text-sm">${escapeHtml(err.message)}</p>`;
    }
  }

  main.querySelector('#btn-upload')?.addEventListener('click', () => {
    main.querySelector('#file-input').click();
  });

  main.querySelector('#file-input')?.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (!files.length) return;

    onUploadComplete(() => {
      loadFiles(folderId);
      renderSidebar();
    });

    for (const file of files) {
      addToUploadQueue(file, folderId);
    }
    e.target.value = '';
  });

  main.querySelector('#btn-new-folder')?.addEventListener('click', async () => {
    const name = prompt('Folder name:');
    if (!name) return;

    try {
      await api('/api/files/folder', { method: 'POST', body: JSON.stringify({ name, parentId: folderId }) });
      showToast('Folder created', 'success');
      loadFiles(folderId);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  main.querySelector('#bulk-delete')?.addEventListener('click', bulkDelete);
  main.querySelector('#bulk-download')?.addEventListener('click', bulkDownload);
  main.querySelector('#bulk-copy')?.addEventListener('click', () => setClipboard('copy'));
  main.querySelector('#bulk-cut')?.addEventListener('click', () => setClipboard('cut'));
  main.querySelector('#bulk-transfer')?.addEventListener('click', () => {
    const bulkFiles = [...selectedFiles].map(id => {
      const file = currentFiles.find(f => f.id === id);
      return file ? { id, name: file.name, size: parseInt(file.size) || 0 } : null;
    }).filter(f => f && f.id);
    if (bulkFiles.length === 0) return;
    showTransferModal(null, null, 0, bulkFiles);
  });
  main.querySelector('#bulk-clear').addEventListener('click', clearSelection);
  main.querySelector('#btn-paste').addEventListener('click', pasteFiles);

  // Keyboard shortcuts
  function keyHandler(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedFiles.size > 0) {
      e.preventDefault();
      setClipboard('copy');
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'x' && selectedFiles.size > 0) {
      e.preventDefault();
      setClipboard('cut');
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'v' && clipboard.files.length > 0) {
      e.preventDefault();
      pasteFiles();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
      e.preventDefault();
      selectAll();
    }
  }
  document.addEventListener('keydown', keyHandler);

  // Drag and drop
  const dropZone = main.querySelector('.file-list-container');
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('ring-2', 'ring-blue-400', 'ring-inset');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('ring-2', 'ring-blue-400', 'ring-inset');
  });
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('ring-2', 'ring-blue-400', 'ring-inset');

    // Read synchronously: Chrome clears dataTransfer after the first await.
    const items = [...e.dataTransfer.items].filter(i => i.kind === 'file');
    const fallbackFiles = [...e.dataTransfer.files];

    onUploadComplete(() => {
      loadFiles(folderId);
      renderSidebar();
    });

    try {
      const count = await uploadDroppedEntries(items, fallbackFiles, folderId);
      if (!count) showToast('No files found in dropped item', 'error');
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  loadFiles(folderId);

  return () => {
    document.removeEventListener('keydown', keyHandler);
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
