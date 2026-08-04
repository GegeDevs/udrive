import { initTheme } from '../theme.js';
import { generateQRCode } from '../qr.js';
import { parseDbDate } from '../time-utils.js';

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
  document.getElementById('mobile-nav')?.classList.add('hidden');
  document.getElementById('topbar-storage-donut')?.classList.add('hidden');

  const hash = window.location.hash.slice(1);
  const match = hash.match(/^\/share\/([a-f0-9]+)$/);

  if (match) {
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
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-sm w-full relative">
      <button id="share-login-close" class="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
        <span class="material-icons-outlined text-xl">close</span>
      </button>
      <div class="text-center mb-5">
        <span class="material-icons-outlined text-blue-600 text-4xl">cloud</span>
        <h2 class="text-xl font-bold mt-2">UDrive</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Sign in to continue</p>
      </div>
      <form id="share-login-form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
          <input type="text" id="share-login-username" required autocomplete="username" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
          <input type="password" id="share-login-password" required autocomplete="current-password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
        </div>
        <p id="share-login-error" class="text-sm text-red-500 hidden"></p>
        <button type="submit" id="share-login-btn" class="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm">
          Sign In
        </button>
      </form>
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

    const username = modal.querySelector('#share-login-username').value.trim();
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
        modal.remove();
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

  modal.querySelector('#share-login-username').focus();
}

async function renderUploadPage(main) {
  let shareInfo;
  try {
    const res = await fetch('/share/info');
    shareInfo = await res.json();
  } catch {
    shareInfo = { enabled: false };
  }

  if (!shareInfo.enabled) {
    main.innerHTML = `
      <div class="flex items-center justify-center min-h-[calc(100vh-3rem)]">
        <div class="text-center">
          <span class="material-icons-outlined text-gray-400 text-5xl">cloud_off</span>
          <p class="mt-4 text-gray-500 dark:text-gray-400">File sharing is currently disabled</p>
        </div>
      </div>
    `;
    return;
  }

  // Show login button in topbar
  const loginTopbar = document.getElementById('btn-login-topbar');
  if (loginTopbar) {
    loginTopbar.classList.remove('hidden');
    loginTopbar.onclick = () => showLoginModal();
  }

  const expiryOptions = [];
  for (let d = 1; d <= shareInfo.maxExpiryDays; d++) {
    if (d === 1 || d === 3 || d === 7 || d === 14 || d === 30 || d === shareInfo.defaultExpiryDays) {
      expiryOptions.push(d);
    }
  }
  const uniqueDays = [...new Set(expiryOptions)].sort((a, b) => a - b);

  const storageHtml = shareInfo.storage ? `
    <div class="mb-4">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs text-gray-500 dark:text-gray-400">Storage</span>
        <span class="text-xs text-gray-400">${Math.round((shareInfo.storage.used / shareInfo.storage.limit) * 100)}%</span>
      </div>
      <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div class="bg-blue-600 h-2 rounded-full" style="width: ${Math.min((shareInfo.storage.used / shareInfo.storage.limit) * 100, 100)}%"></div>
      </div>
      <p class="text-xs text-gray-400 mt-1">${formatFileSize(shareInfo.storage.used)} of ${formatFileSize(shareInfo.storage.limit)} used</p>
    </div>
  ` : '';

  main.innerHTML = `
    <div class="flex items-start md:items-center justify-center min-h-[calc(100vh-3rem)] p-4 pt-6 md:pt-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-6">
          <span class="material-icons-outlined text-blue-600 text-5xl">cloud_upload</span>
          <h1 class="text-2xl font-bold mt-2">UDrive Share</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Upload and share files securely</p>
        </div>

        ${storageHtml}

        <div id="upload-zone" class="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
          <span class="material-icons-outlined text-4xl text-gray-400">upload_file</span>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-400">Drag & drop a file here or click to browse</p>
          <p class="mt-1 text-xs text-gray-400">Max ${shareInfo.maxFileSizeMb}MB</p>
          <input type="file" id="file-input" class="hidden">
        </div>

        <div id="file-selected" class="hidden mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <div class="flex items-center gap-3">
            <span class="material-icons-outlined text-blue-500">description</span>
            <div class="flex-1 min-w-0">
              <p id="selected-file-name" class="text-sm font-medium truncate"></p>
              <p id="selected-file-size" class="text-xs text-gray-500"></p>
            </div>
            <button id="clear-file" class="text-gray-400 hover:text-red-500">
              <span class="material-icons-outlined text-sm">close</span>
            </button>
          </div>
        </div>

        <div class="mt-4 space-y-3">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expiry</label>
            <select id="expiry-select" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
              ${uniqueDays.map(d => `<option value="${d}" ${d === shareInfo.defaultExpiryDays ? 'selected' : ''}>${d} day${d > 1 ? 's' : ''}</option>`).join('')}
            </select>
          </div>

          <div>
            <label class="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 cursor-pointer">
              <input type="checkbox" id="password-toggle" class="rounded border-gray-300 dark:border-gray-600">
              Password protect
            </label>
            <input type="password" id="password-input" placeholder="Enter password" class="hidden w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
          </div>
        </div>

        ${shareInfo.turnstileSiteKey ? `<div id="turnstile-container" class="mt-4 flex justify-center"></div>` : ''}

        <button id="upload-btn" disabled class="w-full mt-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm">
          Upload & Share
        </button>

        <div id="upload-progress" class="hidden mt-4">
          <div class="flex items-center gap-3">
            <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
              <div id="progress-bar" class="bg-blue-600 h-2 rounded-full transition-all" style="width: 0%"></div>
            </div>
            <span id="progress-text" class="text-xs text-gray-500">0%</span>
          </div>
        </div>

        <div id="upload-error" class="hidden mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p id="error-text" class="text-sm text-red-600 dark:text-red-400"></p>
        </div>
      </div>
    </div>
  `;

  const fileInput = main.querySelector('#file-input');
  const uploadZone = main.querySelector('#upload-zone');
  const fileSelected = main.querySelector('#file-selected');
  const uploadBtn = main.querySelector('#upload-btn');
  const passwordToggle = main.querySelector('#password-toggle');
  const passwordInput = main.querySelector('#password-input');
  let selectedFile = null;

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('border-blue-400', 'dark:border-blue-500');
  });
  uploadZone.addEventListener('dragleave', () => {
    uploadZone.classList.remove('border-blue-400', 'dark:border-blue-500');
  });
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('border-blue-400', 'dark:border-blue-500');
    if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) selectFile(fileInput.files[0]);
  });

  function selectFile(file) {
    const maxBytes = shareInfo.maxFileSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      showError(`File exceeds maximum size of ${shareInfo.maxFileSizeMb}MB`);
      return;
    }
    selectedFile = file;
    main.querySelector('#selected-file-name').textContent = file.name;
    main.querySelector('#selected-file-size').textContent = formatFileSize(file.size);
    fileSelected.classList.remove('hidden');
    uploadZone.classList.add('hidden');
    uploadBtn.disabled = false;
  }

  main.querySelector('#clear-file').addEventListener('click', () => {
    selectedFile = null;
    fileSelected.classList.add('hidden');
    uploadZone.classList.remove('hidden');
    uploadBtn.disabled = true;
    fileInput.value = '';
  });

  passwordToggle.addEventListener('change', () => {
    passwordInput.classList.toggle('hidden', !passwordToggle.checked);
  });

  if (shareInfo.turnstileSiteKey && window.turnstile) {
    window.turnstile.render('#turnstile-container', {
      sitekey: shareInfo.turnstileSiteKey,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    });
  }

  uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    main.querySelector('#upload-error').classList.add('hidden');

    const progressEl = main.querySelector('#upload-progress');
    const progressBar = main.querySelector('#progress-bar');
    const progressText = main.querySelector('#progress-text');
    progressEl.classList.remove('hidden');

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('expiry_days', main.querySelector('#expiry-select').value);
    if (passwordToggle.checked && passwordInput.value) {
      formData.append('password', passwordInput.value);
    }
    formData.append('csrf_token', shareInfo.csrfToken);
    const turnstileInput = main.querySelector('[name="cf-turnstile-response"]');
    if (turnstileInput) formData.append('cf-turnstile-response', turnstileInput.value);

    try {
      const xhr = new XMLHttpRequest();
      const result = await new Promise((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            progressBar.style.width = pct + '%';
            progressText.textContent = pct + '%';
          }
        });
        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(JSON.parse(xhr.responseText));
          } else {
            try { reject(new Error(JSON.parse(xhr.responseText).error)); }
            catch { reject(new Error('Upload failed')); }
          }
        });
        xhr.addEventListener('error', () => reject(new Error('Network error')));
        xhr.open('POST', '/share/upload');
        xhr.send(formData);
      });

      progressEl.classList.add('hidden');
      const shareLink = `${window.location.origin}/#/share/${result.shareId}`;
      showShareResultModal(shareLink, result.expiresAt);

    } catch (err) {
      progressEl.classList.add('hidden');
      showError(err.message);
    }

    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload & Share';
  });

  function showError(msg) {
    const el = main.querySelector('#upload-error');
    main.querySelector('#error-text').textContent = msg;
    el.classList.remove('hidden');
  }

  function showShareResultModal(link, expiresAt) {
    const existing = document.getElementById('share-result-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'share-result-modal';
    modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl p-6 max-w-sm w-full relative">
        <button id="share-modal-close" class="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <span class="material-icons-outlined text-xl">close</span>
        </button>
        <div class="text-center mb-4">
          <span class="material-icons-outlined text-green-500 text-4xl">check_circle</span>
          <p class="text-sm font-medium text-green-800 dark:text-green-200 mt-2">File shared successfully!</p>
        </div>
        <div class="flex justify-center mb-4">${generateQRCode(link)}</div>
        <div class="flex items-center gap-2">
          <input type="text" readonly value="${link}" class="flex-1 px-2 py-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded text-xs">
          <button id="share-modal-copy" class="px-3 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">Copy</button>
        </div>
        <p class="text-xs text-gray-500 text-center mt-2">Expires: ${parseDbDate(expiresAt).toLocaleDateString()}</p>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#share-modal-close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#share-modal-copy').addEventListener('click', () => {
      navigator.clipboard.writeText(link);
      modal.querySelector('#share-modal-copy').textContent = 'Copied!';
      setTimeout(() => { modal.querySelector('#share-modal-copy').textContent = 'Copy'; }, 2000);
    });
  }
}

async function renderDownloadPage(main, shareId) {
  main.innerHTML = `
    <div class="flex items-center justify-center min-h-[calc(100vh-3rem)] p-4">
      <div class="w-full max-w-sm">
        <div class="text-center mb-6">
          <span class="material-icons-outlined text-blue-600 text-5xl">cloud_download</span>
          <h1 class="text-2xl font-bold mt-2">UDrive Share</h1>
        </div>
        <div id="download-content" class="text-center">
          <p class="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    </div>
  `;

  const content = main.querySelector('#download-content');

  let fileInfo;
  try {
    const res = await fetch(`/share/${shareId}`);
    if (res.status === 404) {
      content.innerHTML = `
        <span class="material-icons-outlined text-gray-400 text-4xl">link_off</span>
        <p class="mt-3 text-gray-500 dark:text-gray-400">Share not found</p>
        <a href="#/share" class="inline-block mt-4 text-sm text-blue-600 hover:text-blue-700">Upload a file</a>
      `;
      return;
    }
    if (res.status === 410) {
      content.innerHTML = `
        <span class="material-icons-outlined text-gray-400 text-4xl">timer_off</span>
        <p class="mt-3 text-gray-500 dark:text-gray-400">This share has expired</p>
        <a href="#/share" class="inline-block mt-4 text-sm text-blue-600 hover:text-blue-700">Upload a file</a>
      `;
      return;
    }
    fileInfo = await res.json();
  } catch {
    content.innerHTML = `<p class="text-red-500">Failed to load share info</p>`;
    return;
  }

  const expiresDate = parseDbDate(fileInfo.expiresAt).toLocaleDateString();

  content.innerHTML = `
    <div class="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg text-left">
      <div class="flex items-center gap-3">
        <span class="material-icons-outlined text-blue-500 text-3xl">description</span>
        <div class="flex-1 min-w-0">
          <p class="font-medium truncate">${escapeHtml(fileInfo.fileName)}</p>
          <p class="text-xs text-gray-500">${formatFileSize(fileInfo.fileSize)}</p>
        </div>
      </div>
    </div>
    <p class="text-xs text-gray-400 mt-2">Expires: ${expiresDate}</p>

    ${fileInfo.hasPassword ? `
      <div id="password-section" class="mt-4">
        <input type="password" id="dl-password" placeholder="Enter password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
        <p id="dl-password-error" class="text-xs text-red-500 mt-1 hidden"></p>
      </div>
    ` : ''}

    <button id="dl-btn" class="w-full mt-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm">
      Download
    </button>

    <div class="mt-4 text-center">
      <a href="#/share" class="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400">Upload a file</a>
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
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
