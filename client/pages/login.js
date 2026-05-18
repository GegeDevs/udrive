import { api } from '../api.js';

function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function renderLoginPage() {
  const main = document.getElementById('main-content');
  document.getElementById('sidebar')?.classList.add('!hidden');
  document.getElementById('mobile-nav')?.classList.add('hidden');
  document.getElementById('topbar-storage-donut')?.classList.add('hidden');

  // Check share status first to decide layout
  initLoginLayout(main);
}

async function initLoginLayout(main) {
  let shareInfo;
  try {
    const res = await fetch('/share/info');
    shareInfo = await res.json();
  } catch {
    shareInfo = { enabled: false };
  }

  if (!shareInfo.enabled) {
    renderLoginOnly(main);
  } else {
    renderUploadWithLogin(main, shareInfo);
  }
}

function showLoginModal(main) {
  const existing = document.getElementById('login-modal');
  if (existing) { existing.classList.remove('hidden'); return; }

  const modal = document.createElement('div');
  modal.id = 'login-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm p-6 relative">
      <button id="login-modal-close" class="absolute top-3 right-3 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
        <span class="material-icons-outlined text-xl">close</span>
      </button>
      <div class="text-center mb-5">
        <span class="material-icons-outlined text-blue-600 text-4xl">cloud</span>
        <h2 class="text-xl font-bold mt-2">UDrive</h2>
        <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Sign in to continue</p>
      </div>
      <form id="login-modal-form" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
          <input type="text" id="login-modal-username" required autocomplete="username" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
          <input type="password" id="login-modal-password" required autocomplete="current-password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
        </div>
        <p id="login-modal-error" class="text-sm text-red-500 hidden"></p>
        <button type="submit" id="login-modal-btn" class="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm">
          Sign In
        </button>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#login-modal-close').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); });

  modal.querySelector('#login-modal-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = modal.querySelector('#login-modal-btn');
    const errEl = modal.querySelector('#login-modal-error');
    errEl.classList.add('hidden');

    const username = modal.querySelector('#login-modal-username').value.trim();
    const password = modal.querySelector('#login-modal-password').value;

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      await api('/api/users/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      modal.remove();
      window.location.hash = '#/';
      window.location.reload();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });

  modal.querySelector('#login-modal-username').focus();
}

function renderLoginOnly(main) {
  document.getElementById('btn-login-topbar')?.classList.add('hidden');

  main.innerHTML = `
    <div class="flex items-center justify-center min-h-[calc(100vh-3rem)] p-4">
      <div class="w-full max-w-sm">
        <div class="text-center mb-6">
          <span class="material-icons-outlined text-blue-600 text-5xl">cloud</span>
          <h1 class="text-2xl font-bold mt-2">UDrive</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Sign in to continue</p>
        </div>
        <form id="login-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
            <input type="text" id="login-username" required autocomplete="username" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input type="password" id="login-password" required autocomplete="current-password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
          </div>
          <p id="login-error" class="text-sm text-red-500 hidden"></p>
          <button type="submit" id="login-btn" class="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm">
            Sign In
          </button>
        </form>
      </div>
    </div>
  `;

  main.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = main.querySelector('#login-btn');
    const errorEl = main.querySelector('#login-error');
    errorEl.classList.add('hidden');

    const username = main.querySelector('#login-username').value.trim();
    const password = main.querySelector('#login-password').value;

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      await api('/api/users/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      window.location.hash = '#/';
      window.location.reload();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });
}

function renderUploadWithLogin(main, shareInfo) {
  // Show login button in topbar on mobile
  const loginTopbar = document.getElementById('btn-login-topbar');
  if (loginTopbar) {
    loginTopbar.classList.remove('hidden');
    loginTopbar.classList.add('md:hidden');
    loginTopbar.onclick = () => showLoginModal(main);
  }

  main.innerHTML = `
    <div class="flex items-start md:items-center justify-center min-h-[calc(100vh-3rem)] p-4 pt-6 md:pt-4">
      <div class="w-full max-w-4xl flex flex-col md:flex-row gap-8 md:gap-0 items-center md:items-center justify-center">

        <!-- Left: Upload Section -->
        <div class="w-full max-w-sm order-1 md:order-1 flex flex-col items-center">
          <div class="w-full">
            <div class="text-center mb-4">
              <span class="material-icons-outlined text-blue-600 text-4xl">cloud_upload</span>
              <h2 class="text-lg font-bold mt-1">Quick Share</h2>
              <p class="text-xs text-gray-500 dark:text-gray-400">Upload and share files instantly</p>
            </div>

            <div id="login-upload-zone" class="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 dark:hover:border-blue-500 transition-colors">
              <span class="material-icons-outlined text-3xl text-gray-400">upload_file</span>
              <p class="mt-1 text-sm text-gray-600 dark:text-gray-400">Drag & drop or click to browse</p>
              <p id="login-upload-max" class="mt-1 text-xs text-gray-400">Max ${shareInfo.maxFileSizeMb}MB</p>
              <input type="file" id="login-file-input" class="hidden">
            </div>

            <div id="login-file-selected" class="hidden mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <div class="flex items-center gap-3">
                <span class="material-icons-outlined text-blue-500">description</span>
                <div class="flex-1 min-w-0">
                  <p id="login-selected-name" class="text-sm font-medium truncate"></p>
                  <p id="login-selected-size" class="text-xs text-gray-500"></p>
                </div>
                <button id="login-clear-file" class="text-gray-400 hover:text-red-500">
                  <span class="material-icons-outlined text-sm">close</span>
                </button>
              </div>
            </div>

            <div id="login-upload-options" class="mt-3 space-y-2">
              <div>
                <label class="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">Expiry</label>
                <select id="login-expiry-select" class="w-full px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
                </select>
              </div>
              <div>
                <label class="flex items-center gap-2 text-xs font-medium text-gray-700 dark:text-gray-300 cursor-pointer">
                  <input type="checkbox" id="login-password-toggle" class="rounded border-gray-300 dark:border-gray-600">
                  Password protect
                </label>
                <input type="password" id="login-password-input" placeholder="Enter password" class="hidden w-full mt-1 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
              </div>
            </div>

            ${shareInfo.turnstileSiteKey ? `<div id="login-turnstile-container" class="mt-3 flex justify-center"></div>` : ''}

            <button id="login-upload-btn" disabled class="w-full mt-3 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm">
              Upload & Share
            </button>

            <div id="login-upload-progress" class="hidden mt-3">
              <div class="flex items-center gap-3">
                <div class="flex-1 bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                  <div id="login-progress-bar" class="bg-blue-600 h-2 rounded-full transition-all" style="width: 0%"></div>
                </div>
                <span id="login-progress-text" class="text-xs text-gray-500">0%</span>
              </div>
            </div>

            <div id="login-upload-result" class="hidden mt-3 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <p class="text-sm font-medium text-green-800 dark:text-green-200 mb-2">Shared!</p>
              <div class="flex items-center gap-2">
                <input type="text" id="login-share-link" readonly class="flex-1 px-2 py-1.5 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded text-xs">
                <button id="login-copy-link" class="px-2 py-1.5 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">Copy</button>
              </div>
            </div>

            <div id="login-upload-error" class="hidden mt-3 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
              <p id="login-error-upload-text" class="text-xs text-red-600 dark:text-red-400"></p>
            </div>
          </div>
        </div>

        <!-- Divider -->
        <div class="hidden md:flex flex-col items-center self-stretch mx-8 order-2">
          <div class="flex-1 w-px bg-gray-200 dark:bg-gray-700"></div>
          <span class="py-3 text-xs text-gray-400">or</span>
          <div class="flex-1 w-px bg-gray-200 dark:bg-gray-700"></div>
        </div>

        <!-- Right: Login Section (desktop only) -->
        <div class="w-full max-w-sm hidden md:flex order-3 flex-col items-center">
          <div class="w-full">
            <div class="text-center mb-6">
              <span class="material-icons-outlined text-blue-600 text-5xl">cloud</span>
              <h1 class="text-2xl font-bold mt-2">UDrive</h1>
              <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Sign in to continue</p>
            </div>
            <form id="login-form" class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
                <input type="text" id="login-username" required autocomplete="username" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
                <input type="password" id="login-password" required autocomplete="current-password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
              </div>
              <p id="login-error" class="text-sm text-red-500 hidden"></p>
              <button type="submit" id="login-btn" class="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm">
                Sign In
              </button>
            </form>
          </div>
        </div>

      </div>
    </div>
  `;

  // Login form handler (desktop)
  main.querySelector('#login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = main.querySelector('#login-btn');
    const errorEl = main.querySelector('#login-error');
    errorEl.classList.add('hidden');

    const username = main.querySelector('#login-username').value.trim();
    const password = main.querySelector('#login-password').value;

    btn.disabled = true;
    btn.textContent = 'Signing in...';

    try {
      await api('/api/users/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      window.location.hash = '#/';
      window.location.reload();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Sign In';
    }
  });

  // Upload section
  initLoginUpload(main, shareInfo);
}

async function initLoginUpload(main, shareInfo) {
  main.querySelector('#login-upload-max').textContent = `Max ${shareInfo.maxFileSizeMb}MB`;

  // Populate expiry options
  const expirySelect = main.querySelector('#login-expiry-select');
  const expiryOptions = [1, 3, 7, 14, 30].filter(d => d <= shareInfo.maxExpiryDays);
  if (!expiryOptions.includes(shareInfo.defaultExpiryDays)) expiryOptions.push(shareInfo.defaultExpiryDays);
  [...new Set(expiryOptions)].sort((a, b) => a - b).forEach(d => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `${d} day${d > 1 ? 's' : ''}`;
    if (d === shareInfo.defaultExpiryDays) opt.selected = true;
    expirySelect.appendChild(opt);
  });

  // Password toggle
  const passwordToggle = main.querySelector('#login-password-toggle');
  const passwordInput = main.querySelector('#login-password-input');
  passwordToggle.addEventListener('change', () => {
    passwordInput.classList.toggle('hidden', !passwordToggle.checked);
  });

  const fileInput = main.querySelector('#login-file-input');
  const uploadZone = main.querySelector('#login-upload-zone');
  const fileSelected = main.querySelector('#login-file-selected');
  const uploadBtn = main.querySelector('#login-upload-btn');
  let selectedFile = null;

  uploadZone.addEventListener('click', () => fileInput.click());
  uploadZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadZone.classList.add('border-blue-400');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('border-blue-400'));
  uploadZone.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadZone.classList.remove('border-blue-400');
    if (e.dataTransfer.files.length) selectFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) selectFile(fileInput.files[0]);
  });

  function selectFile(file) {
    const maxBytes = shareInfo.maxFileSizeMb * 1024 * 1024;
    if (file.size > maxBytes) {
      showError(`File exceeds ${shareInfo.maxFileSizeMb}MB limit`);
      return;
    }
    selectedFile = file;
    main.querySelector('#login-selected-name').textContent = file.name;
    main.querySelector('#login-selected-size').textContent = formatFileSize(file.size);
    fileSelected.classList.remove('hidden');
    uploadZone.classList.add('hidden');
    uploadBtn.disabled = false;
  }

  main.querySelector('#login-clear-file').addEventListener('click', () => {
    selectedFile = null;
    fileSelected.classList.add('hidden');
    uploadZone.classList.remove('hidden');
    uploadBtn.disabled = true;
    fileInput.value = '';
  });

  // Render Turnstile widget
  if (shareInfo.turnstileSiteKey && window.turnstile) {
    window.turnstile.render('#login-turnstile-container', {
      sitekey: shareInfo.turnstileSiteKey,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    });
  }

  uploadBtn.addEventListener('click', async () => {
    if (!selectedFile) return;

    uploadBtn.disabled = true;
    uploadBtn.textContent = 'Uploading...';
    main.querySelector('#login-upload-error').classList.add('hidden');
    main.querySelector('#login-upload-result').classList.add('hidden');

    const progressEl = main.querySelector('#login-upload-progress');
    const progressBar = main.querySelector('#login-progress-bar');
    const progressText = main.querySelector('#login-progress-text');
    progressEl.classList.remove('hidden');

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('expiry_days', main.querySelector('#login-expiry-select').value);
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
      main.querySelector('#login-share-link').value = shareLink;
      main.querySelector('#login-upload-result').classList.remove('hidden');

      main.querySelector('#login-copy-link').addEventListener('click', () => {
        navigator.clipboard.writeText(shareLink);
        main.querySelector('#login-copy-link').textContent = 'Copied!';
        setTimeout(() => { main.querySelector('#login-copy-link').textContent = 'Copy'; }, 2000);
      });
    } catch (err) {
      progressEl.classList.add('hidden');
      showError(err.message);
    }

    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload & Share';
  });

  function showError(msg) {
    main.querySelector('#login-error-upload-text').textContent = msg;
    main.querySelector('#login-upload-error').classList.remove('hidden');
  }
}

