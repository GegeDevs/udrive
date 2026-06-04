import './style.css';
import { initTheme } from './theme.js';
import { registerRoute, initRouter, navigate } from './router.js';
import { renderSidebar } from './components/sidebar.js';
import { initSidebarToggle } from './components/sidebar-toggle.js';
import { renderFilesPage } from './pages/files.js';
import { renderAccountsPage } from './pages/accounts.js';
import { renderSettingsPage } from './pages/settings.js';
import { renderTrashPage } from './pages/trash.js';
import { renderLoginPage } from './pages/login.js';
import { renderSetupPage } from './pages/setup.js';
import { renderUsersPage } from './pages/users.js';
import { renderActivityPage } from './pages/activity.js';
import { renderLogsPage } from './pages/logs.js';
import { renderTransferPage } from './pages/transfer.js';
import { renderApiAccessPage } from './pages/api-access.js';
import { renderApiDocsPage } from './pages/api-docs.js';
import { renderSharePublicPage } from './pages/share-public.js';
import { renderFileSharePage, destroyFileSharePage } from './pages/file-share.js';
import { initQueueMonitor, cleanupQueueMonitor } from './pages/queue-monitor.js';
import { showLogoutModal } from './components/logout-modal.js';
import { api } from './api.js';
import { setCurrentUser, hasPermission, hasPageAccess, getCurrentUser } from './auth-state.js';
import { loadTimeSettings } from './time-utils.js';

initTheme();

async function initApp() {
  // Public share routes bypass auth
  const hash = window.location.hash.slice(1) || '/';
  if (hash === '/share' || hash.startsWith('/share/')) {
    renderSharePublicPage();
    window.addEventListener('hashchange', () => {
      const h = window.location.hash.slice(1) || '/';
      if (h === '/share' || h.startsWith('/share/')) {
        renderSharePublicPage();
      } else {
        window.location.reload();
      }
    });
    return;
  }

  try {
    const { initialized } = await api('/api/users/check');

    if (!initialized) {
      renderSetupPage();
      return;
    }

    let user;
    try {
      user = await api('/api/users/me');
    } catch (e) {
      renderLoginPage();
      return;
    }

    setCurrentUser(user);
    await loadTimeSettings();

    renderSidebar();
    initSidebarToggle();
    initMobileNav();

    document.getElementById('sidebar')?.classList.remove('!hidden');
    document.getElementById('mobile-nav')?.classList.remove('hidden');
    document.getElementById('topbar-storage-donut')?.classList.remove('hidden');

    const logoutBtn = document.getElementById('btn-logout-topbar');
    if (logoutBtn) {
      if (hasPageAccess('settings')) {
        logoutBtn.classList.add('hidden');
      } else {
        logoutBtn.classList.remove('hidden');
      }
      logoutBtn.addEventListener('click', () => showLogoutModal());
    }

    registerRoute('/', () => {
      if (!hasPageAccess('drive')) { navigate('/login'); return; }
      return renderFilesPage();
    });
    registerRoute('/accounts', () => {
      if (!hasPageAccess('accounts')) { navigate('/'); return; }
      renderAccountsPage();
    });
    registerRoute('/settings', () => {
      if (!hasPageAccess('settings')) { navigate('/'); return; }
      renderSettingsPage();
    });
    registerRoute('/trash', () => {
      if (!hasPageAccess('trash')) { navigate('/'); return; }
      renderTrashPage();
    });
    registerRoute('/users', () => {
      if (!hasPermission('admin:view_users') && getCurrentUser()?.role !== 'master') { navigate('/'); return; }
      renderUsersPage();
    });
    registerRoute('/activity', () => {
      if (!hasPermission('admin:view_activity') && getCurrentUser()?.role !== 'master') { navigate('/'); return; }
      renderActivityPage();
    });
    registerRoute('/logs', () => {
      if (!hasPermission('admin:view_logs') && getCurrentUser()?.role !== 'master') { navigate('/'); return; }
      renderLogsPage();
    });
    registerRoute('/transfer', () => {
      renderTransferPage();
    });
    registerRoute('/api-access', () => {
      if (!hasPermission('admin:manage_api') && getCurrentUser()?.role !== 'master') { navigate('/'); return; }
      renderApiAccessPage();
    });
    registerRoute('/api-docs', () => {
      if (!hasPermission('admin:view_api_docs') && getCurrentUser()?.role !== 'master') { navigate('/'); return; }
      renderApiDocsPage();
    });
    registerRoute('/queue-monitor', () => {
      if (!hasPermission('admin:queue') && getCurrentUser()?.role !== 'master') { navigate('/'); return; }
      initQueueMonitor();
      return cleanupQueueMonitor;
    });
    registerRoute('/file-share', () => {
      if (!hasPageAccess('share')) { navigate('/'); return; }
      renderFileSharePage();
      return destroyFileSharePage;
    });
    registerRoute('/login', renderLoginPage);

    initRouter();
  } catch (err) {
    console.error('Init failed:', err);
    renderLoginPage();
  }
}

function initMobileNav() {
  const mobileNav = document.getElementById('mobile-nav');
  if (!mobileNav) return;

  mobileNav.querySelectorAll('.mobile-nav-link').forEach(link => {
    const path = link.dataset.path;
    let visible = true;
    if (path === '/' && !hasPageAccess('drive')) visible = false;
    if (path === '/trash' && !hasPageAccess('trash')) visible = false;
    if (path === '/accounts' && !hasPageAccess('accounts')) visible = false;
    if (path === '/settings' && !hasPageAccess('settings')) visible = false;
    if (path === '/users' && !hasPermission('admin:view_users') && getCurrentUser()?.role !== 'master') visible = false;
    if (path === '/activity' && !hasPermission('admin:view_activity') && getCurrentUser()?.role !== 'master') visible = false;
    if (path === '/logs' && !hasPermission('admin:view_logs') && getCurrentUser()?.role !== 'master') visible = false;
    if (path === '/queue-monitor' && !hasPermission('admin:queue') && getCurrentUser()?.role !== 'master') visible = false;
    if (path === '/api-access' && !hasPermission('admin:manage_api') && getCurrentUser()?.role !== 'master') visible = false;
    if (path === '/api-docs' && !hasPermission('admin:view_api_docs') && getCurrentUser()?.role !== 'master') visible = false;
    if (path === '/file-share' && !hasPageAccess('share')) visible = false;
    link.classList.toggle('hidden', !visible);
  });

  const visibleLinks = mobileNav.querySelectorAll('.mobile-nav-link:not(.hidden)');
  if (visibleLinks.length <= 1) {
    mobileNav.style.display = 'none';
  }

  function updateMobileNav() {
    const hash = window.location.hash.slice(1) || '/';
    const path = hash.split('?')[0];
    document.querySelectorAll('.mobile-nav-link').forEach(link => {
      const linkPath = link.dataset.path;
      if (linkPath === path) {
        link.classList.add('text-blue-600', 'dark:text-blue-400');
        link.classList.remove('text-gray-500', 'dark:text-gray-400');
      } else {
        link.classList.remove('text-blue-600', 'dark:text-blue-400');
        link.classList.add('text-gray-500', 'dark:text-gray-400');
      }
    });
  }
  updateMobileNav();
  window.addEventListener('hashchange', updateMobileNav);
}

initApp();
