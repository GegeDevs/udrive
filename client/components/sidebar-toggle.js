import { updateSidebarContent } from './sidebar.js';
import { api } from '../api.js';

export function initSidebarToggle() {
  const btn = document.getElementById('btn-toggle-sidebar');

  btn.addEventListener('click', async () => {
    const sidebar = document.getElementById('sidebar');
    const isCollapsed = localStorage.getItem('udrive-sidebar-hidden') === 'true';
    const newState = !isCollapsed;
    localStorage.setItem('udrive-sidebar-hidden', String(newState));

    let totalUsed = 0;
    let totalLimit = 0;
    try {
      const accounts = await api('/api/accounts');
      for (const acc of accounts) {
        totalUsed += acc.storage_used;
        totalLimit += acc.storage_limit;
      }
    } catch (e) {}

    updateSidebarContent(sidebar, totalUsed, totalLimit, newState);
  });
}
