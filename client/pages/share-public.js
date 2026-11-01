import { initTheme } from '../theme.js';
import { generateQRCode } from '../qr.js';
import { parseDbDate } from '../time-utils.js';
import { escapeHtml, isTextType, isPreviewable, beautyKind, highlightCode, renderCsv, highlightJson, renderMarkdown } from '../lib/beautify.js';

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function renderSharePublicPage() {
  initTheme();
  const main = document.getElementById('main-content');
  document.getElementById('sidebar')?.classList.add('!hidden');
  document.getElementById('mobile-nav')?.classList.add('!hidden');
  document.getElementById('topbar-storage-donut')?.classList.add('!hidden');

  const hash = window.location.hash.slice(1);
  const linkMatch = hash.match(/^\/link\/([a-f0-9]+)$/);
  const match = hash.match(/^\/share\/([a-f0-9]+)$/);

  if (linkMatch) {
    renderLinkPage(main, linkMatch[1]);
  } else if (match) {
    renderDownloadPage(main, match[1]);
  } else {
    renderUploadPage(main);
  }
}

function showLoginModal() {
  const existing = document.getElementById('share-login-modal');
  if (existing) { existing.classList.remove('hidden'); return; }

  const modal = document.createElement('div');
  modal.id = 'share-login-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md relative">
      <button id="share-login-close" class="absolute top-4 right-4 btn-icon text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
        <span class="material-icons-outlined">close</span>
      </button>
      <div class="p-8">
        <div class="text-center mb-6">
          <span class="material-icons-outlined text-blue-600 dark:text-blue-400 text-4xl">cloud</span>
          <h2 class="text-xl font-bold mt-2">UDRIVE</h2>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Sign in to continue</p>
        </div>
        <form id="share-login-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
            <input type="text" id="share-login-username" required autocomplete="username" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input type="password" id="share-login-password" required autocomplete="current-password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent">
          </div>
          <p id="share-login-error" class="text-sm text-red-500 hidden"></p>
          <button type="submit" id="share-login-btn" class="btn-block">Sign In</button>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#share-login-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  modal.querySelector('#share-login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = modal.querySelector('#share-login-btn');
    const errEl = modal.querySelector('#share-login-error');
    errEl.classList.add('hidden');

    const username = modal.querySelector('#share-login-username').value;
    const password = modal.querySelector('#share-login-password').value;

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      const res = await fetch('/api/users/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Login failed';
        errEl.classList.remove('hidden');
      } else {
        window.location.hash = '/';
        window.location.reload();
      }
    } catch {
      errEl.textContent = 'Network error';
      errEl.classList.remove('hidden');
    }

    btn.disabled = false;
    btn.textContent = 'Sign In';
  });
}

async function renderLinkPage(main, token) {
  main.innerHTML = `
    <div class="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4">
      <div class="w-full max-w-2xl">
        <div class="text-center mb-8">
          <span class="material-icons-outlined text-blue-600 dark:text-blue-400 text-5xl">link</span>
          <h1 class="text-2xl font-bold mt-4">Share</h1>
        </div>
        <div id="link-content" class="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
          <div class="p-8 text-center">
            <p class="text-gray-500">Loading...</p>
          </div>
        </div>
      </div>
    </div>`;
  const content = main.querySelector('#link-content');

  let info;
  try {
    const res = await fetch(`/link/${token}`);
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      throw new Error('Invalid response');
    }
    info = await res.json();
    if (!res.ok) throw new Error(info.error || 'Failed to load');
  } catch (err) {
    content.innerHTML = `<div class="p-8 text-center"><p class="text-red-500">${err.message}</p><a href="#/" class="inline-block mt-4 text-blue-600">Go home</a></div>`;
    return;
  }

  let pwValue = null;

  if (info.hasPassword) {
    content.innerHTML = `
      <div class="p-6">
        <h2 class="text-lg font-semibold mb-2">${escapeHtml(info.name)}</h2>
        <p class="text-sm text-gray-500 mb-4">This link is password protected</p>
        <input id="link-pw" type="password" placeholder="Enter password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg">
        <p id="link-pw-err" class="text-xs text-red-500 mt-1 hidden"></p>
        <button id="link-pw-btn" class="btn-block mt-3">Unlock</button>
      </div>`;
    main.querySelector('#link-pw-btn').addEventListener('click', async () => {
      const pw = main.querySelector('#link-pw').value;
      const errEl = main.querySelector('#link-pw-err');
      errEl.classList.add('hidden');
      const res = await fetch(`/link/${token}?pw=${encodeURIComponent(pw)}`);
      const data = await res.json();
      if (!res.ok) { errEl.textContent = data.error; errEl.classList.remove('hidden'); return; }
      pwValue = pw;
      renderLinkLoaded(content, token, data, pwValue);
    });
    return;
  }

  renderLinkLoaded(content, token, info);
}

function renderLinkLoaded(container, token, info, pw = null) {
  const isFolder = info.resourceType === 'folder';
  const perms = info.permissions || [];
  const q = pw ? `?pw=${encodeURIComponent(pw)}` : '';
  container.innerHTML = `
    <div class="p-6 border-b border-gray-200 dark:border-gray-700">
      <div class="flex items-center gap-3">
        <span class="material-icons-outlined text-3xl text-blue-600">${isFolder ? 'folder' : 'description'}</span>
        <div class="flex-1 min-w-0">
          <h2 class="font-semibold truncate">${escapeHtml(info.name)}</h2>
          <p class="text-xs text-gray-500">${info.size ? formatFileSize(info.size) : isFolder ? 'Folder' : ''} · ${perms.join(', ')}${info.expiresAt ? ` · expires ${parseDbDate(info.expiresAt).toLocaleString()}` : ''}</p>
        </div>
      </div>
    </div>
    <div class="p-6 space-y-3">
      ${perms.includes('read') && !isFolder ? `<button id="lnk-preview" class="btn-secondary w-full">Preview</button>` : ''}
      ${perms.includes('download') && !isFolder ? `<button id="lnk-dl" class="btn-primary w-full">Download</button>` : ''}
      ${perms.includes('write') && !isFolder ? `<button id="lnk-edit" class="btn-secondary w-full">Edit (text)</button>` : ''}
      ${isFolder && perms.includes('read') ? `<button id="lnk-browse" class="btn-secondary w-full">Browse</button>` : ''}
      ${isFolder && perms.includes('upload') ? `<button id="lnk-upload" class="btn-secondary w-full">Upload files</button>` : ''}
    </div>
    <div id="lnk-panel" class="p-6 border-t border-gray-200 dark:border-gray-700 hidden"></div>`;

  const panel = container.querySelector('#lnk-panel');

  container.querySelector('#lnk-dl')?.addEventListener('click', () => {
    window.location.href = `/link/${token}/download/${info.fileId}${q}`;
  });
  container.querySelector('#lnk-preview')?.addEventListener('click', () => {
    openLinkPreview(token, pw, info.fileId, info.name, info.mimeType, perms, false);
  });
  container.querySelector('#lnk-edit')?.addEventListener('click', () => {
    openLinkPreview(token, pw, info.fileId, info.name, info.mimeType, perms, true);
  });

  container.querySelector('#lnk-browse')?.addEventListener('click', async () => {
    panel.classList.remove('hidden');
    panel.innerHTML = '<p class="text-sm text-gray-500">Loading...</p>';
    try {
      const res = await fetch(`/link/${token}/children${q}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load');
      renderLinkChildren(panel, token, pw, data.items, perms);
    } catch (e) {
      panel.innerHTML = `<p class="text-red-500 text-sm">${e.message}</p>`;
    }
  });

  container.querySelector('#lnk-upload')?.addEventListener('click', () => {
    panel.classList.remove('hidden');
    panel.innerHTML = `
      <form id="lnk-up-form" class="space-y-2">
        <input type="file" id="lnk-up-file" class="w-full text-sm">
        <button class="btn-primary w-full" type="submit">Upload</button>
      </form>
      <p id="lnk-up-msg" class="text-xs text-gray-500 mt-2"></p>`;
    panel.querySelector('#lnk-up-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = panel.querySelector('#lnk-up-file').files[0];
      if (!f) return;
      const fd = new FormData();
      fd.append('file', f);
      const msg = panel.querySelector('#lnk-up-msg');
      msg.textContent = 'Uploading...';
      try {
        const res = await fetch(`/link/${token}/upload${q}`, { method: 'POST', body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Upload failed');
        msg.textContent = 'Uploaded';
      } catch (err) {
        msg.textContent = err.message;
      }
    });
  });
}

function renderLinkChildren(panel, token, pw, items, perms) {
  const q = pw ? `?pw=${encodeURIComponent(pw)}` : '';
  const images = items.filter(f => f.mimeType?.startsWith('image/'));
  panel.innerHTML = `<div class="space-y-1">${items.map(f => {
    const isDir = f.mimeType === 'application/vnd.google-apps.folder';
    return `<a href="#" data-id="${f.id}" data-name="${escapeHtml(f.name)}" data-mime="${f.mimeType}" class="flex items-center gap-2 p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer">
      <span class="material-icons-outlined text-sm text-gray-500">${isDir ? 'folder' : 'description'}</span>
      <span class="flex-1 text-sm truncate">${escapeHtml(f.name)}</span>
      ${!isDir && perms.includes('download') ? '<span class="material-icons-outlined text-sm text-gray-400">download</span>' : ''}
    </a>`;
  }).join('')}</div>`;
  panel.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', async (e) => {
      e.preventDefault();
      const mime = a.dataset.mime;
      const fid = a.dataset.id;
      const isDir = mime === 'application/vnd.google-apps.folder';
      if (isDir) {
        const res = await fetch(`/link/${token}/children?folderId=${fid}${q ? '&' + q.slice(1) : ''}`);
        const d = await res.json();
        if (res.ok) renderLinkChildren(panel, token, pw, d.items, perms);
      } else if (isPreviewable(mime, a.dataset.name)) {
        const idx = images.findIndex(f => f.id === fid);
        openLinkPreview(token, pw, fid, a.dataset.name, mime, perms, false, images.length > 1 ? images : null, idx);
      } else if (perms.includes('download')) {
        window.location.href = `/link/${token}/download/${fid}${q}`;
      }
    });
  });
}

function openLinkPreview(token, pw, fileId, name, mimeType, perms, startInEdit = false, images = null, index = 0) {
  document.getElementById('link-preview-modal')?.remove();
  const q = pw ? `?pw=${encodeURIComponent(pw)}` : '';
  const srcFor = (id) => `/link/${token}/preview/${id}${q}`;
  const isImage = mimeType.startsWith('image/');
  const isVideo = mimeType.startsWith('video/');
  const isPdf = mimeType === 'application/pdf';
  const isText = isTextType(mimeType, name);
  const canEdit = isText && perms.includes('write');
  const beauty = isText ? beautyKind(mimeType, name) : null;
  const imageList = isImage && images && images.length > 1 ? images : null;
  let imageIndex = imageList ? Math.max(0, index) : -1;
  let raw = false;
  let editing = canEdit && startInEdit;
  let content = '';

  let body;
  if (isImage) body = `
    <div class="w-full h-full flex items-center justify-center relative">
      <div id="lp-loading" class="absolute inset-0 flex items-center justify-center bg-black/80 z-10">
        <div class="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin"></div>
      </div>
      <img id="lp-img" src="${srcFor(fileId)}" alt="${escapeHtml(name)}" class="max-w-full max-h-full object-contain">
    </div>`;
  else if (isVideo) body = `<video src="${srcFor(fileId)}" controls autoplay class="w-full h-full object-contain"></video>`;
  else if (isPdf) body = `<iframe src="${srcFor(fileId)}" title="${escapeHtml(name)}" class="w-full h-full border-0 bg-white"></iframe>`;
  else if (isText) body = `
    <div class="w-full h-full relative bg-white dark:bg-gray-900">
      <textarea id="lp-text" spellcheck="false" placeholder="Loading…" class="w-full h-full resize-none overflow-auto p-4 text-sm font-mono leading-relaxed bg-transparent text-gray-800 dark:text-gray-200 focus:outline-none"></textarea>
      <div id="lp-rendered" class="hidden absolute inset-0 overflow-auto px-6 py-5 md-body"></div>
    </div>`;
  else body = `<div class="w-full h-full flex flex-col items-center justify-center gap-3 text-gray-300"><span class="material-icons-outlined text-5xl">visibility_off</span><p class="text-sm">Preview not available</p>${perms.includes('download') ? `<a href="/link/${token}/download/${fileId}${q}" class="btn-primary">Download</a>` : ''}</div>`;

  const modal = document.createElement('div');
  modal.id = 'link-preview-modal';
  modal.className = 'fixed inset-0 z-50 bg-black/80';
  modal.innerHTML = `
    <div class="absolute inset-0 flex flex-col">
      <div class="flex items-center justify-between gap-2 px-3 py-1.5 bg-black/80 text-white shrink-0">
        <p class="truncate text-xs font-medium"><span id="lp-name">${escapeHtml(name)}</span><span id="lp-dirty" class="hidden text-amber-300 ml-2" title="Unsaved changes">●</span></p>
        <div class="flex items-center gap-1 shrink-0">
          ${imageList ? `<button id="lp-prev" class="btn-icon hover:bg-white/10 text-white" title="Previous image" ${imageIndex <= 0 ? 'disabled' : ''}><span class="material-icons-outlined">chevron_left</span></button>
          <button id="lp-next" class="btn-icon hover:bg-white/10 text-white" title="Next image" ${imageIndex >= imageList.length - 1 ? 'disabled' : ''}><span class="material-icons-outlined">chevron_right</span></button>` : ''}
          ${beauty ? `<button id="lp-format" class="btn-icon hover:bg-white/10 text-white" title="Plain text"><span class="material-icons-outlined">code</span></button>` : ''}
          ${canEdit ? `<button id="lp-toggle" class="btn-icon hover:bg-white/10 text-white" title="Edit mode"><span class="material-icons-outlined">edit</span></button>` : ''}
          ${canEdit ? `<button id="lp-save" class="btn-icon hover:bg-white/10 text-white hidden" title="Save"><span class="material-icons-outlined">save</span></button>` : ''}
          <button id="lp-close" class="btn-icon hover:bg-white/10 text-white" title="Close"><span class="material-icons-outlined">close</span></button>
        </div>
      </div>
      <div class="flex-1 overflow-hidden bg-black/90">${body}</div>
    </div>`;
  document.body.appendChild(modal);

  if (isImage) {
    const img = modal.querySelector('#lp-img');
    const loading = modal.querySelector('#lp-loading');
    const hide = () => loading?.classList.add('hidden');
    img.onload = img.onerror = hide;
    if (img.complete) hide();
  }

  const close = () => { modal.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => {
    if (e.key === 'Escape') return close();
    if (imageList && e.key === 'ArrowLeft') showImage(imageList[imageIndex - 1]?.id);
    if (imageList && e.key === 'ArrowRight') showImage(imageList[imageIndex + 1]?.id);
  };
  document.addEventListener('keydown', onKey);
  modal.querySelector('#lp-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

  const showImage = (newId) => {
    if (!imageList) return;
    const idx = imageList.findIndex(f => f.id === newId);
    if (idx < 0) return;
    imageIndex = idx;
    const item = imageList[idx];
    const img = modal.querySelector('#lp-img');
    const loading = modal.querySelector('#lp-loading');
    img.style.opacity = '0.4';
    loading?.classList.remove('hidden');
    img.onload = img.onerror = () => { img.style.opacity = '1'; loading?.classList.add('hidden'); };
    img.src = `${srcFor(newId)}${q ? '&' : '?'}t=${Date.now()}`;
    img.alt = escapeHtml(item.name);
    modal.querySelector('#lp-name').textContent = item.name;
    const prev = modal.querySelector('#lp-prev');
    const next = modal.querySelector('#lp-next');
    if (prev) prev.disabled = imageIndex <= 0;
    if (next) next.disabled = imageIndex >= imageList.length - 1;
  };
  modal.querySelector('#lp-prev')?.addEventListener('click', () => showImage(imageList[imageIndex - 1]?.id));
  modal.querySelector('#lp-next')?.addEventListener('click', () => showImage(imageList[imageIndex + 1]?.id));

  if (isText) {
    const ta = modal.querySelector('#lp-text');
    const rendered = modal.querySelector('#lp-rendered');
    const dirty = modal.querySelector('#lp-dirty');
    const saveBtn = modal.querySelector('#lp-save');
    const formatBtn = modal.querySelector('#lp-format');

    const renderBeauty = () => {
      if (beauty === 'markdown') rendered.innerHTML = renderMarkdown(content);
      else if (beauty === 'csv') rendered.innerHTML = renderCsv(content, /\.tsv$/i.test(name) ? '\t' : ',');
      else if (beauty === 'code') rendered.innerHTML = `<pre class="p-4 text-[13px] font-mono leading-relaxed whitespace-pre-wrap break-words">${highlightCode(content)}</pre>`;
      else rendered.innerHTML = `<pre class="p-4 text-sm font-mono whitespace-pre-wrap break-words">${highlightJson(content)}</pre>`;
    };
    const updateView = () => {
      const showRendered = !!beauty && !editing && !raw;
      rendered.classList.toggle('hidden', !showRendered);
      ta.classList.toggle('hidden', showRendered);
      if (showRendered) renderBeauty();
      if (formatBtn) formatBtn.title = raw ? 'Beautify' : 'Plain text';
    };

    fetch(srcFor(fileId))
      .then(async (r) => {
        if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.error || 'Preview failed'); }
        return r.text();
      })
      .then((t) => { content = t; ta.value = t; ta.readOnly = !canEdit; if (editing) ta.focus(); else updateView(); })
      .catch((e) => { ta.value = ''; ta.placeholder = e.message; });

    ta.addEventListener('input', () => {
      content = ta.value;
      dirty?.classList.toggle('hidden', false);
      saveBtn?.classList.toggle('hidden', false);
      if (!editing) updateView();
    });
    formatBtn?.addEventListener('click', () => { raw = !raw; updateView(); });
    modal.querySelector('#lp-toggle')?.addEventListener('click', () => {
      editing = !editing;
      if (!editing) content = ta.value;
      updateView();
      if (editing) ta.focus();
    });
    saveBtn?.addEventListener('click', async () => {
      saveBtn.querySelector('span').textContent = 'progress_activity';
      try {
        const r = await fetch(`/link/${token}/content/${fileId}${q}`, { method: 'PUT', headers: { 'Content-Type': 'text/plain' }, body: ta.value });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Save failed');
        content = ta.value;
        dirty?.classList.add('hidden');
        saveBtn.classList.add('hidden');
        updateView();
      } catch (e) {
        alert(e.message);
      } finally {
        saveBtn.querySelector('span').textContent = 'save';
      }
    });
  }
}

function renderDownloadPage(main, shareId) {
  main.innerHTML = `
    <div class="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <span class="material-icons-outlined text-blue-600 dark:text-blue-400 text-5xl">cloud_download</span>
          <h1 class="text-2xl font-bold mt-4">Download File</h1>
        </div>
        <div id="download-content" class="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
          <div class="p-8 text-center">
            <p class="text-gray-500">Loading...</p>
          </div>
        </div>
      </div>
    </div>
  `;

  loadDownloadInfo(main, shareId);
}

async function loadDownloadInfo(main, shareId) {
  const content = main.querySelector('#download-content');
  try {
    const res = await fetch(`/share/${shareId}`);
    const fileInfo = await res.json();
    if (!res.ok) throw new Error(fileInfo.error || 'Failed to load share info');

    content.innerHTML = `
      <div class="p-6 border-b border-gray-200 dark:border-gray-700">
        <div class="flex items-center gap-3">
          <span class="material-icons-outlined text-3xl text-blue-600">description</span>
          <div class="flex-1 min-w-0">
            <h2 class="font-semibold truncate">${escapeHtml(fileInfo.fileName)}</h2>
            <p class="text-sm text-gray-500">${formatFileSize(fileInfo.fileSize)}</p>
          </div>
        </div>
      </div>
      <div class="p-6">
        ${fileInfo.hasPassword ? `
          <div class="mb-4">
            <input type="password" id="dl-password" placeholder="Enter password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent">
            <p id="dl-password-error" class="text-xs text-red-500 mt-1 hidden"></p>
          </div>
        ` : ''}
        <button id="dl-btn" class="btn-block">Download</button>
        <p class="text-xs text-gray-500 text-center mt-2">Expires: ${fileInfo.expiresAt ? new Date(fileInfo.expiresAt).toLocaleString() : 'N/A'}</p>

        ${fileInfo.hasPassword ? `
        <div class="mt-4 text-center">
          <a href="#/share" class="text-sm text-blue-600 dark:text-blue-400 hover:underline">Upload a file</a>
        </div>
        ` : ''}
      </div>
    `;

    main.querySelector('#dl-btn').addEventListener('click', async () => {
      const btn = main.querySelector('#dl-btn');
      if (fileInfo.hasPassword) {
        const pw = main.querySelector('#dl-password').value;
        if (!pw) {
          const errEl = main.querySelector('#dl-password-error');
          errEl.textContent = 'Password required';
          errEl.classList.remove('hidden');
          return;
        }
        btn.disabled = true;
        btn.textContent = 'Verifying...';
        try {
          const res = await fetch(`/share/${shareId}/verify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pw })
          });
          const data = await res.json();
          if (!data.verified) {
            const errEl = main.querySelector('#dl-password-error');
            errEl.textContent = data.error || 'Invalid password';
            errEl.classList.remove('hidden');
            btn.disabled = false;
            btn.textContent = 'Download';
            return;
          }
        } catch {
          btn.disabled = false;
          btn.textContent = 'Download';
          return;
        }
        window.location.href = `/share/${shareId}/download?pw=${encodeURIComponent(pw)}`;
        btn.disabled = false;
        btn.textContent = 'Download';
      } else {
        window.location.href = `/share/${shareId}/download`;
      }
    });
  } catch (err) {
    content.innerHTML = `<p class="text-red-500">Failed to load share info</p>`;
  }
}

function renderUploadPage(main) {
  main.innerHTML = `
    <div class="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <span class="material-icons-outlined text-blue-600 dark:text-blue-400 text-5xl">cloud_upload</span>
          <h1 class="text-2xl font-bold mt-4">Upload File</h1>
          <p class="text-gray-500 dark:text-gray-400 mt-2">Share files securely</p>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
          <div class="p-6">
            <form id="upload-form" enctype="multipart/form-data">
              <input type="file" id="file-input" name="file" required class="hidden">
              <div id="drop-zone" class="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 transition-colors">
                <span class="material-icons-outlined text-gray-400 text-4xl">upload_file</span>
                <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">Click or drag file to upload</p>
                <p id="file-name" class="mt-2 text-sm text-blue-600 hidden"></p>
              </div>
              <div id="upload-options" class="mt-4 hidden">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password (optional)</label>
                <input type="password" id="upload-password" name="password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 mt-3">Expiry</label>
                <select id="upload-expiry" name="expiry_days" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-500 focus:border-transparent">
                  <option value="1">1 day</option>
                  <option value="3">3 days</option>
                  <option value="7" selected>7 days</option>
                  <option value="30">30 days</option>
                </select>
              </div>
              <div id="upload-error" class="hidden mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                <p id="error-text" class="text-sm text-red-600 dark:text-red-400"></p>
              </div>
              <button type="submit" id="upload-btn" class="btn-block mt-4" disabled>Upload</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  `;

  initUpload();
}

function initUpload() {
  const form = document.getElementById('upload-form');
  const fileInput = document.getElementById('file-input');
  const dropZone = document.getElementById('drop-zone');
  const fileName = document.getElementById('file-name');
  const uploadOptions = document.getElementById('upload-options');
  const uploadBtn = document.getElementById('upload-btn');

  dropZone.addEventListener('click', () => fileInput.click());

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('border-blue-500');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('border-blue-500');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('border-blue-500');
    if (e.dataTransfer.files.length) {
      fileInput.files = e.dataTransfer.files;
      handleFileSelect();
    }
  });

  fileInput.addEventListener('change', handleFileSelect);

  function handleFileSelect() {
    if (fileInput.files.length) {
      fileName.textContent = fileInput.files[0].name;
      fileName.classList.remove('hidden');
      uploadOptions.classList.remove('hidden');
      uploadBtn.disabled = false;
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(form);
    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    document.getElementById('upload-error').classList.add('hidden');

    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/share/upload');
      xhr.withCredentials = true;

      const csrfToken = document.cookie.split('; ').find(row => row.startsWith('csrf_token='))?.split('=')[1];
      if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);

      const turnstileToken = document.querySelector('[name="cf-turnstile-response"]')?.value;
      if (turnstileToken) formData.append('cf-turnstile-response', turnstileToken);

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          uploadBtn.textContent = `Uploading ${percent}%`;
        }
      });

      xhr.onload = async () => {
        if (xhr.status === 200) {
          const result = JSON.parse(xhr.responseText);
          showUploadSuccess(result.shareId, result.shareLink);
        } else {
          try {
            const err = JSON.parse(xhr.responseText);
            showError(err.error || 'Upload failed');
          } catch {
            showError('Upload failed');
          }
          uploadBtn.disabled = false;
          uploadBtn.textContent = 'Upload';
        }
      };

      xhr.onerror = () => {
        showError('Network error');
        uploadBtn.disabled = false;
        uploadBtn.textContent = 'Upload';
      };

      xhr.send(formData);
    } catch (err) {
      showError(err.message);
      uploadBtn.disabled = false;
      uploadBtn.textContent = 'Upload';
    }
  });

  function showError(msg) {
    const el = document.getElementById('upload-error');
    document.getElementById('error-text').textContent = msg;
    el.classList.remove('hidden');
  }
}

function showUploadSuccess(shareId, shareLink) {
  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="flex items-center justify-center min-h-[calc(100vh-4rem)] p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-8">
          <span class="material-icons-outlined text-green-600 text-5xl">check_circle</span>
          <h1 class="text-2xl font-bold mt-4">Upload Successful</h1>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden">
          <div class="p-6">
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-3">Share link:</p>
            <div class="flex gap-2">
              <input type="text" id="share-link-input" value="${shareLink}" readonly class="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900 text-sm">
              <button id="copy-btn" class="btn-secondary">Copy</button>
            </div>
            <button id="new-upload-btn" class="btn-block mt-4">Upload Another</button>
            <a href="#/share/${shareId}" class="btn-block mt-2 text-center">View Download Page</a>
          </div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('copy-btn').addEventListener('click', () => {
    const input = document.getElementById('share-link-input');
    input.select();
    document.execCommand('copy');
    document.getElementById('copy-btn').textContent = 'Copied!';
    setTimeout(() => {
      document.getElementById('copy-btn').textContent = 'Copy';
    }, 2000);
  });

  document.getElementById('new-upload-btn').addEventListener('click', () => {
    window.location.hash = '/share';
    window.location.reload();
  });
}

