import { api } from '../api.js';
import { renderStorageBar } from './storage-bar.js';
import { getCurrentUser, hasPageAccess, hasPermission } from '../auth-state.js';
import { getTransferState, onTransferChange } from './transfer-panel.js';

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
  if (hasPageAccess('drive')) navItems.push({ path: '/', icon: 'folder', label: 'My Drive' });
  navItems.push({ path: '/transfer', icon: 'swap_vert', label: 'Transfers' });
  if (hasPageAccess('trash')) navItems.push({ path: '/trash', icon: 'delete', label: 'Trash' });
  if (hasPageAccess('accounts')) navItems.push({ path: '/accounts', icon: 'people', label: 'Accounts' });
  if (hasPageAccess('settings')) navItems.push({ path: '/settings', icon: 'settings', label: 'Settings' });
  if (isMaster || hasPermission('admin:view_users')) navItems.push({ path: '/users', icon: 'admin_panel_settings', label: 'Users' });
  if (isMaster || hasPermission('admin:view_activity')) navItems.push({ path: '/activity', icon: 'history', label: 'Activity' });
  if (isMaster || hasPermission('admin:view_logs')) navItems.push({ path: '/logs', icon: 'terminal', label: 'Logs' });
  if (isMaster || hasPermission('admin:manage_api')) navItems.push({ path: '/api-access', icon: 'vpn_key', label: 'API Access' });
  if (isMaster || hasPermission('admin:view_api_docs')) navItems.push({ path: '/api-docs', icon: 'menu_book', label: 'API Docs' });
  if (hasPageAccess('share')) navItems.push({ path: '/file-share', icon: 'share', label: 'File Share' });

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
        <div id="sidebar-transfers-collapsed" class="hidden"></div>
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
      <nav class="flex-1 p-3 space-y-1 overflow-y-auto scrollbar-hide">
        ${navItems.map(item => `
          <a href="#${item.path}" class="sidebar-link flex items-center gap-3 px-3 py-2 rounded-full text-sm font-medium hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" data-path="${item.path}">
            <span class="material-icons-outlined text-xl">${item.icon}</span>
            <span>${item.label}</span>
          </a>
        `).join('')}
      </nav>
      <div class="p-4 border-t border-gray-200 dark:border-gray-700">
        <div id="sidebar-transfers" class="hidden mb-3"></div>
        <p class="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">Storage</p>
        ${renderStorageBar(totalUsed, totalLimit)}
      </div>
    `;
  }

  initTransferMonitor();
  updateActiveLink();
}

function initTransferMonitor() {
  onTransferChange(() => updateTransferPanel());
  updateTransferPanel();
}

function updateTransferPanel() {
  const el = document.getElementById('sidebar-transfers');
  const elCollapsed = document.getElementById('sidebar-transfers-collapsed');

  const state = getTransferState();
  const hasActivity = state.uploads.total > 0 || state.downloads.total > 0;

  // Expanded sidebar
  if (el) {
    if (!hasActivity) {
      el.classList.add('hidden');
      el.innerHTML = '';
    } else {
      el.classList.remove('hidden');
      let html = '';
      if (state.uploads.total > 0) {
        const active = state.uploads.active + state.uploads.waiting;
        html += `
          <div class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 mb-1">
            <span class="material-icons-outlined text-sm text-blue-500">upload</span>
            <span>${active > 0 ? `Uploading ${state.uploads.completed}/${state.uploads.total}` : `${state.uploads.completed} uploaded`}</span>
            ${active > 0 ? '<span class="animate-pulse text-blue-500">●</span>' : ''}
          </div>
        `;
      }
      if (state.downloads.total > 0) {
        const active = state.downloads.active;
        html += `
          <div class="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 mb-1">
            <span class="material-icons-outlined text-sm text-green-500">download</span>
            <span>${active > 0 ? `Downloading ${state.downloads.completed}/${state.downloads.total}` : `${state.downloads.completed} downloaded`}</span>
            ${active > 0 ? '<span class="animate-pulse text-green-500">●</span>' : ''}
          </div>
        `;
      }
      el.innerHTML = html;
    }
  }

  // Collapsed sidebar
  if (elCollapsed) {
    if (!hasActivity) {
      elCollapsed.classList.add('hidden');
      elCollapsed.innerHTML = '';
    } else {
      elCollapsed.classList.remove('hidden');
      let html = '';
      const uploadActive = state.uploads.active + state.uploads.waiting;
      const downloadActive = state.downloads.active;
      if (uploadActive > 0) {
        html += `<span class="material-icons-outlined text-lg text-blue-500 animate-pulse" title="Uploading ${state.uploads.completed}/${state.uploads.total}">upload</span>`;
      }
      if (downloadActive > 0) {
        html += `<span class="material-icons-outlined text-lg text-green-500 animate-pulse" title="Downloading ${state.downloads.completed}/${state.downloads.total}">download</span>`;
      }
      elCollapsed.innerHTML = html;
    }
  }
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
