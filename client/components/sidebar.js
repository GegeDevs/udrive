import { api } from '../api.js';
import { renderStorageBar } from './storage-bar.js';
import { getCurrentUser, hasPermission } from '../auth-state.js';

export async function renderSidebar() {
  const sidebar = document.getElementById('sidebar');

  let totalUsed = 0;
  let totalLimit = 0;
  try {
    const accounts = await api('/api/accounts');
    for (const acc of accounts) {
      totalUsed += acc.storage_used;
      totalLimit += acc.storage_limit;
    }
  } catch (e) {}

  const collapsed = localStorage.getItem('udrive-sidebar-hidden') === 'true';
  updateSidebarContent(sidebar, totalUsed, totalLimit, collapsed);
  renderTopbarDonut(totalUsed, totalLimit);

  updateActiveLink();
  window.addEventListener('hashchange', updateActiveLink);
}

export function updateSidebarContent(sidebar, totalUsed, totalLimit, collapsed) {
  const user = getCurrentUser();
  const isMaster = user?.role === 'master';

  const navItems = [];
  if (hasPermission('page:drive')) navItems.push({ path: '/', icon: 'folder', label: 'My Drive' });
  if (hasPermission('page:trash')) navItems.push({ path: '/trash', icon: 'delete', label: 'Trash' });
  if (hasPermission('page:accounts')) navItems.push({ path: '/accounts', icon: 'people', label: 'Accounts' });
  if (hasPermission('page:settings')) navItems.push({ path: '/settings', icon: 'settings', label: 'Settings' });
  if (isMaster) navItems.push({ path: '/users', icon: 'admin_panel_settings', label: 'Users' });

  if (collapsed) {
    const percent = totalLimit > 0 ? Math.min((totalUsed / totalLimit) * 100, 100) : 0;
    const radius = 14;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (percent / 100) * circumference;

    sidebar.className = 'hidden md:flex w-14 border-r border-gray-200 dark:border-gray-700 flex-col shrink-0 transition-all duration-200';
    sidebar.innerHTML = `
      <nav class="flex-1 py-3 flex flex-col items-center space-y-2">
        ${navItems.map(item => `
          <a href="#${item.path}" class="sidebar-link p-2 rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" data-path="${item.path}" title="${item.label}">
            <span class="material-icons-outlined text-xl">${item.icon}</span>
          </a>
        `).join('')}
      </nav>
      <div class="py-3 flex flex-col items-center gap-2">
        <div title="${(totalUsed / (1024 ** 3)).toFixed(1)} / ${(totalLimit / (1024 ** 3)).toFixed(0)} GB">
          <svg width="36" height="36" class="transform -rotate-90">
            <circle cx="18" cy="18" r="${radius}" fill="none" stroke-width="4" class="stroke-gray-200 dark:stroke-gray-700"></circle>
            <circle cx="18" cy="18" r="${radius}" fill="none" stroke-width="4" stroke-linecap="round" class="stroke-blue-500" style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}; transition: stroke-dashoffset 0.3s;"></circle>
          </svg>
        </div>
      </div>
    `;
  } else {
    sidebar.className = 'hidden md:flex w-64 border-r border-gray-200 dark:border-gray-700 flex-col shrink-0 transition-all duration-200';
    sidebar.innerHTML = `
      <nav class="flex-1 p-3 space-y-1">
        ${navItems.map(item => `
          <a href="#${item.path}" class="sidebar-link flex items-center gap-3 px-3 py-2 rounded-full text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" data-path="${item.path}">
            <span class="material-icons-outlined text-xl">${item.icon}</span>
            <span>${item.label}</span>
          </a>
        `).join('')}
      </nav>
      <div class="p-4 border-t border-gray-200 dark:border-gray-700">
        <p class="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Storage</p>
        ${renderStorageBar(totalUsed, totalLimit)}
      </div>
    `;
  }

  updateActiveLink();
}

function updateActiveLink() {
  const hash = window.location.hash.slice(1) || '/';
  const path = hash.split('?')[0];
  document.querySelectorAll('.sidebar-link').forEach(link => {
    const linkPath = link.dataset.path;
    if (linkPath === path || (linkPath === '/' && path.startsWith('/folder'))) {
      link.classList.add('bg-blue-50', 'dark:bg-blue-900/30', 'text-blue-700', 'dark:text-blue-300');
    } else {
      link.classList.remove('bg-blue-50', 'dark:bg-blue-900/30', 'text-blue-700', 'dark:text-blue-300');
    }
  });
}

function renderTopbarDonut(totalUsed, totalLimit) {
  const container = document.getElementById('topbar-storage-donut');
  if (!container) return;

  const percent = totalLimit > 0 ? Math.min((totalUsed / totalLimit) * 100, 100) : 0;
  const radius = 12;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const usedGB = (totalUsed / (1024 ** 3)).toFixed(1);
  const limitGB = (totalLimit / (1024 ** 3)).toFixed(0);

  container.innerHTML = `
    <div class="flex items-center gap-1.5" title="${usedGB} / ${limitGB} GB">
      <svg width="28" height="28" class="transform -rotate-90">
        <circle cx="14" cy="14" r="${radius}" fill="none" stroke-width="3" class="stroke-gray-200 dark:stroke-gray-700"></circle>
        <circle cx="14" cy="14" r="${radius}" fill="none" stroke-width="3" stroke-linecap="round" class="stroke-blue-500" style="stroke-dasharray: ${circumference}; stroke-dashoffset: ${offset}; transition: stroke-dashoffset 0.3s;"></circle>
      </svg>
      <span class="text-[10px] text-gray-500 dark:text-gray-400">${usedGB}GB</span>
    </div>
  `;
}
