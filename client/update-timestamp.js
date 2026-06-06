import { BUILD_TIMESTAMP } from './build-info.js';

export function updateLastDeployTime() {
  const element = document.getElementById('last-deploy-time');
  if (!element) return;

  if (BUILD_TIMESTAMP === '__BUILD_TIMESTAMP__') {
    element.textContent = 'Last updated: Dev mode';
    return;
  }

  try {
    const deployTime = new Date(BUILD_TIMESTAMP);
    const formatted = deployTime.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }) + ' ' + deployTime.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }) + ' UTC';

    element.textContent = `Last updated: ${formatted}`;
  } catch (err) {
    console.error('Failed to parse build timestamp:', err);
    element.textContent = 'Last updated: Unknown';
  }
}
