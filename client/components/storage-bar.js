export function renderStorageBar(used, limit, fileCount = null) {
  const percent = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
  const usedGB = (used / (1024 ** 3)).toFixed(2);
  const limitGB = (limit / (1024 ** 3)).toFixed(1);
  const countStr = fileCount !== null && fileCount !== undefined ? ` (${fileCount})` : '';

  return `
    <div class="storage-bar">
      <div class="storage-bar-fill" style="width: ${percent}%"></div>
    </div>
    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${usedGB} GB of ${limitGB} GB used${countStr}</p>
  `;
}
