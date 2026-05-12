export function renderBreadcrumb(folderStack) {
  if (!folderStack || folderStack.length === 0) {
    return `<div class="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400">
      <span class="font-medium text-gray-900 dark:text-gray-100">My Drive</span>
    </div>`;
  }

  let html = `<div class="flex items-center gap-1 text-sm text-gray-600 dark:text-gray-400 flex-wrap">`;
  html += `<a href="#/" class="hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer">My Drive</a>`;

  for (let i = 0; i < folderStack.length; i++) {
    const folder = folderStack[i];
    html += `<span class="material-icons-outlined text-base">chevron_right</span>`;
    if (i === folderStack.length - 1) {
      html += `<span class="font-medium text-gray-900 dark:text-gray-100">${escapeHtml(folder.name)}</span>`;
    } else {
      html += `<a href="#/?folderId=${folder.id}" class="hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer">${escapeHtml(folder.name)}</a>`;
    }
  }

  html += `</div>`;
  return html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
