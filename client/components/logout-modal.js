import { api } from '../api.js';

export function showLogoutModal() {
  const existing = document.getElementById('logout-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'logout-modal';
  modal.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50';
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
      <div class="flex items-center gap-3 mb-4">
        <span class="material-icons-outlined text-2xl text-red-500">logout</span>
        <h3 class="text-lg font-semibold">Logout</h3>
      </div>
      <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">Are you sure you want to logout?</p>
      <div class="flex justify-end gap-2">
        <button id="logout-cancel" class="btn-secondary text-sm">Cancel</button>
        <button id="logout-confirm" class="px-4 py-2 bg-red-600 text-white rounded-full font-medium hover:bg-red-700 transition-colors text-sm">Logout</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });

  modal.querySelector('#logout-cancel').addEventListener('click', () => modal.remove());

  modal.querySelector('#logout-confirm').addEventListener('click', async () => {
    try { await api('/api/users/logout', { method: 'POST' }); } catch (e) {}
    modal.remove();
    window.location.hash = '#/login';
    window.location.reload();
  });
}
