import { api } from '../api.js';
import { formatDateTime } from '../time-utils.js';
import { showToast } from '../components/toast.js';

const REFRESH_MS = 2000;

export function renderProgressPage() {
  const main = document.getElementById('main-content');
  let timer = null;
  let stopped = false;
  let lastJobs = [];

  main.innerHTML = `
    <div class="p-3 md:p-6">
      <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-4 flex items-center justify-between gap-3">
        <h2 class="text-xl md:text-2xl font-semibold">Progress <span id="progress-count" class="text-gray-400 font-normal"></span></h2>
        <button id="progress-clear" class="btn-secondary text-xs" title="Remove finished jobs">
          <span class="material-icons-outlined">delete_sweep</span>
          <span class="hidden sm:inline">Clear finished</span>
        </button>
      </div>
      <div id="progress-list">
        <div class="flex items-center justify-center h-48 text-gray-500 dark:text-gray-400">
          <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    </div>
  `;

  const list = main.querySelector('#progress-list');
  const countEl = main.querySelector('#progress-count');

  async function load() {
    if (stopped) return;
    try {
      const jobs = await api('/api/jobs');
      lastJobs = jobs;
      render(jobs);
    } catch (err) {
      if (!lastJobs.length) {
        list.innerHTML = `<div class="flex flex-col items-center justify-center h-48 text-gray-500 dark:text-gray-400">
          <span class="material-icons-outlined text-5xl mb-3">cloud_off</span>
          <p class="text-lg font-medium">Cannot load jobs</p>
          <p class="text-sm mt-1">${escapeHtml(err.message)}</p>
        </div>`;
      }
    }
  }

  function render(jobs) {
    countEl.textContent = jobs.length ? `(${jobs.length})` : '';
    if (!jobs.length) {
      list.innerHTML = `<div class="flex flex-col items-center justify-center h-48 text-gray-500 dark:text-gray-400">
        <span class="material-icons-outlined text-5xl mb-3">pending_actions</span>
        <p class="text-lg font-medium">No jobs yet</p>
        <p class="text-sm mt-1">Long-running actions like folder deletes show up here</p>
      </div>`;
      return;
    }
    list.innerHTML = `<div class="space-y-2">${jobs.map(renderJob).join('')}</div>`;
  }

  list.addEventListener('click', async (e) => {
    const cancelBtn = e.target.closest('[data-job-cancel]');
    const removeBtn = e.target.closest('[data-job-remove]');
    if (!cancelBtn && !removeBtn) return;

    const id = (cancelBtn || removeBtn).dataset.jobCancel || (cancelBtn || removeBtn).dataset.jobRemove;
    try {
      if (cancelBtn) {
        await api(`/api/jobs/${id}/cancel`, { method: 'POST' });
        showToast('Job cancelled', 'info');
      } else {
        await api(`/api/jobs/${id}`, { method: 'DELETE' });
      }
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  main.querySelector('#progress-clear')?.addEventListener('click', async () => {
    try {
      await api('/api/jobs', { method: 'DELETE' });
      await load();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  load();
  timer = setInterval(load, REFRESH_MS);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}

function renderJob(job) {
  const active = job.status === 'queued' || job.status === 'running';
  const percent = job.total > 0 ? Math.min(100, Math.round((job.done / job.total) * 100)) : 0;
  const { icon, color, label } = statusStyle(job.status);
  const barColor = job.status === 'failed' ? 'bg-red-500' : job.status === 'cancelled' ? 'bg-gray-400' : job.status === 'done' ? 'bg-green-500' : 'bg-blue-500';

  return `
    <div class="border border-gray-200 dark:border-gray-700 rounded-xl p-3">
      <div class="flex items-start gap-3">
        <span class="material-icons-outlined text-2xl ${color} shrink-0">${icon}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <p class="text-sm font-medium truncate">${escapeHtml(job.label)}</p>
            <span class="text-[11px] font-medium ${color} shrink-0">${label}</span>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
            ${escapeHtml(job.message || job.error || job.type)}
          </p>
          ${active || job.total > 0 ? `
            <div class="mt-2 h-1.5 rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
              <div class="h-full rounded-full ${barColor} transition-all duration-300" style="width: ${percent}%"></div>
            </div>
            <div class="flex items-center justify-between mt-1 text-[11px] text-gray-500 dark:text-gray-400">
              <span>${job.done || 0}${job.total > 0 ? ` / ${job.total}` : ''}${job.failed > 0 ? ` · ${job.failed} failed` : ''}</span>
              <span>${formatDateTime(job.created_at)}</span>
            </div>
          ` : `
            <p class="text-[11px] text-gray-400 mt-1">${formatDateTime(job.created_at)}</p>
          `}
        </div>
        <div class="flex items-center gap-1 shrink-0">
          ${active ? `<button data-job-cancel="${job.id}" class="btn-icon hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500" title="Cancel">
            <span class="material-icons-outlined">close</span>
          </button>` : `<button data-job-remove="${job.id}" class="btn-icon hover:bg-gray-200 dark:hover:bg-gray-700" title="Remove">
            <span class="material-icons-outlined">delete</span>
          </button>`}
        </div>
      </div>
    </div>
  `;
}

function statusStyle(status) {
  switch (status) {
    case 'queued': return { icon: 'schedule', color: 'text-gray-500 dark:text-gray-400', label: 'Queued' };
    case 'running': return { icon: 'autorenew', color: 'text-blue-500', label: 'Running' };
    case 'done': return { icon: 'check_circle', color: 'text-green-500', label: 'Done' };
    case 'failed': return { icon: 'error', color: 'text-red-500', label: 'Failed' };
    case 'cancelled': return { icon: 'cancel', color: 'text-gray-400', label: 'Cancelled' };
    default: return { icon: 'help', color: 'text-gray-400', label: status };
  }
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
