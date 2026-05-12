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
import { showLogoutModal } from './components/logout-modal.js';
import { api } from './api.js';
import { setCurrentUser, hasPermission, getCurrentUser } from './auth-state.js';

initTheme();

async function initApp() {
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

    renderSidebar();
    initSidebarToggle();
    initMobileNav();

    document.getElementById('sidebar')?.classList.remove('!hidden');
    document.getElementById('mobile-nav')?.classList.remove('hidden');
    document.getElementById('topbar-storage-donut')?.classList.remove('hidden');

    const logoutBtn = document.getElementById('btn-logout-topbar');
    if (logoutBtn) {
      if (hasPermission('page:settings')) {
        logoutBtn.classList.add('hidden');
      } else {
        logoutBtn.classList.remove('hidden');
      }
      logoutBtn.addEventListener('click', () => showLogoutModal());
    }

    registerRoute('/', () => {
      if (!hasPermission('page:drive')) { navigate('/login'); return; }
      return renderFilesPage();
    });
    registerRoute('/accounts', () => {
      if (!hasPermission('page:accounts')) { navigate('/'); return; }
      renderAccountsPage();
    });
    registerRoute('/settings', () => {
      if (!hasPermission('page:settings')) { navigate('/'); return; }
      renderSettingsPage();
    });
    registerRoute('/trash', () => {
      if (!hasPermission('page:trash')) { navigate('/'); return; }
      renderTrashPage();
    });
    registerRoute('/users', () => {
      if (getCurrentUser()?.role !== 'master') { navigate('/'); return; }
      renderUsersPage();
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

  // Filter nav items based on permissions
  mobileNav.querySelectorAll('.mobile-nav-link').forEach(link => {
    const path = link.dataset.path;
    let visible = true;
    if (path === '/' && !hasPermission('page:drive')) visible = false;
    if (path === '/trash' && !hasPermission('page:trash')) visible = false;
    if (path === '/accounts' && !hasPermission('page:accounts')) visible = false;
    if (path === '/settings' && !hasPermission('page:settings')) visible = false;
    if (path === '/users' && getCurrentUser()?.role !== 'master') visible = false;
    link.classList.toggle('hidden', !visible);
  });

  // Hide entire navbar if only 1 or fewer visible items
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
