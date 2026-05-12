export function initTheme() {
  const saved = localStorage.getItem('udrive-theme') || 'auto';
  applyTheme(saved);
  initThemeToggle();
}

export function setTheme(theme) {
  localStorage.setItem('udrive-theme', theme);
  applyTheme(theme);
  updateThemeIcon();
}

export function getTheme() {
  return localStorage.getItem('udrive-theme') || 'auto';
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else if (theme === 'light') {
    root.classList.remove('dark');
  } else {
    if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }
}

function initThemeToggle() {
  const btn = document.getElementById('btn-toggle-theme');
  if (!btn) return;

  updateThemeIcon();

  btn.addEventListener('click', () => {
    const current = getTheme();
    const next = current === 'light' ? 'dark' : current === 'dark' ? 'auto' : 'light';
    setTheme(next);
  });
}

function updateThemeIcon() {
  const btn = document.getElementById('btn-toggle-theme');
  if (!btn) return;
  const icon = btn.querySelector('.material-icons-outlined');
  const theme = getTheme();
  const isDark = document.documentElement.classList.contains('dark');

  if (theme === 'auto') {
    icon.textContent = 'brightness_auto';
    btn.title = 'Theme: Auto';
  } else if (theme === 'dark') {
    icon.textContent = 'dark_mode';
    btn.title = 'Theme: Dark';
  } else {
    icon.textContent = 'light_mode';
    btn.title = 'Theme: Light';
  }
}

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  const theme = getTheme();
  if (theme === 'auto') applyTheme('auto');
});
