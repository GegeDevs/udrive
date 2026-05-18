import { initTheme } from '../theme.js';

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

  const expiryOptions = [];
  for (let d = 1; d <= shareInfo.maxExpiryDays; d++) {
    if (d === 1 || d === 3 || d === 7 || d === 14 || d === 30 || d === shareInfo.defaultExpiryDays) {
      expiryOptions.push(d);
    }
  }
  const uniqueDays = [...new Set(expiryOptions)].sort((a, b) => a - b);

  main.innerHTML = `
    <div class="flex items-center justify-center min-h-[calc(100vh-3rem)] p-4">
      <div class="w-full max-w-md">
        <div class="text-center mb-6">
          <span class="material-icons-outlined text-blue-600 text-5xl">cloud_upload</span>
          <h1 class="text-2xl font-bold mt-2">UDrive Share</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Upload and share files securely</p>
        </div>

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

        <div id="upload-result" class="hidden mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <p class="text-sm font-medium text-green-800 dark:text-green-200 mb-2">File shared successfully!</p>
          <div class="flex items-center gap-2">
            <input type="text" id="share-link" readonly class="flex-1 px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg text-sm">
            <button id="copy-link" class="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">Copy</button>
          </div>
          <p id="share-expiry" class="text-xs text-gray-500 mt-2"></p>
        </div>

        <div id="upload-error" class="hidden mt-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p id="error-text" class="text-sm text-red-600 dark:text-red-400"></p>
        </div>

        <div class="mt-6">
          <button id="login-toggle" class="w-full flex items-center justify-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300 transition-colors">
            <span>Admin Login</span>
            <span class="material-icons-outlined text-base login-chevron">expand_more</span>
          </button>
          <div id="login-form" class="hidden mt-3 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-3">
            <div>
              <input type="text" id="login-username" placeholder="Username" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
            </div>
            <div>
              <input type="password" id="login-password" placeholder="Password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
            </div>
            <p id="login-error" class="text-xs text-red-500 hidden"></p>
            <button id="login-btn" class="w-full py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">Login</button>
          </div>
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

  // Render Turnstile widget
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
    main.querySelector('#upload-result').classList.add('hidden');

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
      const resultEl = main.querySelector('#upload-result');
      const shareLink = `${window.location.origin}/#/share/${result.shareId}`;
      main.querySelector('#share-link').value = shareLink;
      main.querySelector('#share-expiry').textContent = `Expires: ${new Date(result.expiresAt).toLocaleDateString()}`;
      resultEl.classList.remove('hidden');

      main.querySelector('#copy-link').addEventListener('click', () => {
        navigator.clipboard.writeText(shareLink);
        main.querySelector('#copy-link').textContent = 'Copied!';
        setTimeout(() => { main.querySelector('#copy-link').textContent = 'Copy'; }, 2000);
      });

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

  // Login toggle
  main.querySelector('#login-toggle').addEventListener('click', () => {
    const form = main.querySelector('#login-form');
    const chevron = main.querySelector('.login-chevron');
    form.classList.toggle('hidden');
    chevron.textContent = form.classList.contains('hidden') ? 'expand_more' : 'expand_less';
  });

  main.querySelector('#login-btn').addEventListener('click', async () => {
    const username = main.querySelector('#login-username').value.trim();
    const password = main.querySelector('#login-password').value;
    const errEl = main.querySelector('#login-error');
    errEl.classList.add('hidden');

    if (!username || !password) {
      errEl.textContent = 'Username and password required';
      errEl.classList.remove('hidden');
      return;
    }

    const btn = main.querySelector('#login-btn');
    btn.disabled = true;
    btn.textContent = 'Logging in...';

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
    btn.textContent = 'Login';
  });

  main.querySelector('#login-password').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') main.querySelector('#login-btn').click();
  });
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

  const expiresDate = new Date(fileInfo.expiresAt).toLocaleDateString();

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
