const routes = {};
let currentCleanup = null;

export function registerRoute(path, handler) {
  routes[path] = handler;
}

export function navigate(path) {
  window.location.hash = path;
}

export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

function handleRoute() {
  const hash = window.location.hash.slice(1) || '/';
  const path = hash.split('?')[0];

  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  const handler = routes[path] || routes['/'];
  if (handler) {
    const cleanup = handler();
    if (typeof cleanup === 'function') {
      currentCleanup = cleanup;
    }
  }
}

export function getQueryParams() {
  const hash = window.location.hash.slice(1) || '/';
  const queryStr = hash.split('?')[1] || '';
  return new URLSearchParams(queryStr);
}
