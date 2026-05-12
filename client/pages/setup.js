import { api } from '../api.js';

export function renderSetupPage() {
  const main = document.getElementById('main-content');
  document.getElementById('sidebar')?.classList.add('!hidden');
  document.getElementById('mobile-nav')?.classList.add('hidden');
  document.getElementById('topbar-storage-donut')?.classList.add('hidden');

  main.innerHTML = `
    <div class="flex items-center justify-center min-h-[calc(100vh-3rem)]">
      <div class="w-full max-w-sm mx-4">
        <div class="text-center mb-8">
          <span class="material-icons-outlined text-blue-600 text-5xl">cloud</span>
          <h1 class="text-2xl font-bold mt-2">UDrive Setup</h1>
          <p class="text-sm text-gray-500 dark:text-gray-400 mt-1">Create your master account</p>
        </div>
        <form id="setup-form" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Username</label>
            <input type="text" id="setup-username" required autocomplete="username" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Password</label>
            <input type="password" id="setup-password" required autocomplete="new-password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm Password</label>
            <input type="password" id="setup-confirm" required autocomplete="new-password" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
          </div>
          <p id="setup-error" class="text-sm text-red-500 hidden"></p>
          <button type="submit" id="setup-btn" class="w-full py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors text-sm">
            Create Master Account
          </button>
        </form>
      </div>
    </div>
  `;

  main.querySelector('#setup-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = main.querySelector('#setup-btn');
    const errorEl = main.querySelector('#setup-error');
    errorEl.classList.add('hidden');

    const username = main.querySelector('#setup-username').value.trim();
    const password = main.querySelector('#setup-password').value;
    const confirm = main.querySelector('#setup-confirm').value;

    if (password !== confirm) {
      errorEl.textContent = 'Passwords do not match';
      errorEl.classList.remove('hidden');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Creating...';

    try {
      await api('/api/users/setup', { method: 'POST', body: JSON.stringify({ username, password }) });
      await api('/api/users/login', { method: 'POST', body: JSON.stringify({ username, password }) });
      window.location.hash = '#/';
      window.location.reload();
    } catch (err) {
      errorEl.textContent = err.message;
      errorEl.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Create Master Account';
    }
  });
}
