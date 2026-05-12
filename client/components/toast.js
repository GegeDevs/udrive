export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');

  const colors = {
    info: 'bg-gray-800 dark:bg-gray-200 text-white dark:text-gray-900',
    success: 'bg-green-600 text-white',
    error: 'bg-red-600 text-white'
  };

  toast.className = `px-4 py-3 rounded-lg shadow-lg ${colors[type] || colors.info} text-sm font-medium transition-all duration-300 transform translate-y-2 opacity-0`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-2', 'opacity-0');
  });

  setTimeout(() => {
    toast.classList.add('translate-y-2', 'opacity-0');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
