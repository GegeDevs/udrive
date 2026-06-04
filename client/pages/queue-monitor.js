import { api } from '../api.js';
import { hasPermission } from '../auth-state.js';
import { showToast } from '../components/toast.js';
import { formatTimeAgo } from '../time-utils.js';

let pollInterval = null;

export function initQueueMonitor() {
  if (!hasPermission('admin:queue')) {
    const main = document.getElementById('main-content');
    main.innerHTML = `
      <div class="flex items-center justify-center h-screen">
        <div class="text-center">
          <h2 class="text-2xl font-bold mb-4">Access Denied</h2>
          <p class="text-gray-600 dark:text-gray-400">You don't have permission to view queue monitor.</p>
        </div>
      </div>
    `;
    return;
  }

  const main = document.getElementById('main-content');
  main.innerHTML = `
    <div class="p-3 md:p-6">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-xl md:text-2xl font-bold">Queue Monitor</h1>
        <div class="flex items-center gap-4">
          <span id="queue-status" class="text-sm text-gray-600 dark:text-gray-400">Checking...</span>
          <button id="refresh-btn" class="btn-secondary">
            <svg class="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            Refresh
          </button>
        </div>
      </div>

      <!-- Stats Cards -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div class="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
          <div class="text-sm text-gray-600 dark:text-gray-400 mb-1">Queued (Last Hour)</div>
          <div id="stat-queued" class="text-3xl font-bold">-</div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
          <div class="text-sm text-gray-600 dark:text-gray-400 mb-1">Completed (Last Hour)</div>
          <div id="stat-completed" class="text-3xl font-bold text-green-600">-</div>
        </div>
        <div class="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm">
          <div class="text-sm text-gray-600 dark:text-gray-400 mb-1">Pending (Estimate)</div>
          <div id="stat-pending" class="text-3xl font-bold text-orange-600">-</div>
        </div>
      </div>

      <!-- Active Jobs -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm mb-6">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold">Active Jobs (Last 10 Minutes)</h2>
        </div>
        <div id="active-jobs" class="p-4">
          <div class="text-center text-gray-500 dark:text-gray-400 py-8">Loading...</div>
        </div>
      </div>

      <!-- Recent Queued -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm mb-6">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold">Recent Queued Jobs</h2>
        </div>
        <div id="recent-queued" class="p-4">
          <div class="text-center text-gray-500 dark:text-gray-400 py-8">Loading...</div>
        </div>
      </div>

      <!-- Recent Completed -->
      <div class="bg-white dark:bg-gray-800 rounded-lg shadow-sm">
        <div class="p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 class="text-lg font-semibold">Recent Completed Jobs</h2>
        </div>
        <div id="recent-completed" class="p-4">
          <div class="text-center text-gray-500 dark:text-gray-400 py-8">Loading...</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadQueueData();
  });

  loadQueueData();
  startPolling();
}

async function loadQueueData() {
  try {
    const [stats, active] = await Promise.all([
      api('/api/queue/stats'),
      api('/api/queue/active')
    ]);

    updateStats(stats);
    updateActiveJobs(active.jobs || []);
    updateRecentQueued(stats.recentQueued || []);
    updateRecentCompleted(stats.recentCompleted || []);

    document.getElementById('queue-status').textContent = stats.available
      ? `Last updated: ${new Date().toLocaleTimeString()}`
      : 'Queue not configured';
  } catch (error) {
    console.error('Load queue data error:', error);
    showToast('Failed to load queue data', 'error');
  }
}

function updateStats(stats) {
  if (!stats.available) {
    document.getElementById('stat-queued').textContent = 'N/A';
    document.getElementById('stat-completed').textContent = 'N/A';
    document.getElementById('stat-pending').textContent = 'N/A';
    return;
  }

  document.getElementById('stat-queued').textContent = stats.stats.queuedLastHour;
  document.getElementById('stat-completed').textContent = stats.stats.completedLastHour;
  document.getElementById('stat-pending').textContent = stats.stats.pendingEstimate;
}

function updateActiveJobs(jobs) {
  const container = document.getElementById('active-jobs');

  if (jobs.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-500 dark:text-gray-400 py-8">No active jobs</div>';
    return;
  }

  container.innerHTML = `
    <div class="space-y-3">
      ${jobs.map(job => {
        const percent = job.total_items > 0 ? Math.round((job.processed_items / job.total_items) * 100) : 0;
        const statusColors = {
          queued: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
          scanning: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
          processing: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
          completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
          failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
        };

        return `
          <div class="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
            <div class="flex items-start justify-between mb-2">
              <div class="flex-1">
                <div class="font-medium">${escapeHtml(job.username)}</div>
                <div class="text-sm text-gray-600 dark:text-gray-400">${escapeHtml(job.folder_name || job.folder_id)}</div>
              </div>
              <div class="text-right">
                <span class="px-2 py-1 rounded text-xs font-medium ${statusColors[job.status] || statusColors.queued}">
                  ${job.status}
                </span>
                <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  ${formatTimeAgo(job.created_at)}
                </div>
              </div>
            </div>
            ${job.status === 'processing' ? `
              <div class="mt-2">
                <div class="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400 mb-1">
                  <span>${job.processed_items} / ${job.total_items} items</span>
                  <span>${percent}%</span>
                </div>
                <div class="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-2">
                  <div class="bg-blue-600 h-2 rounded-full transition-all duration-300" style="width: ${percent}%"></div>
                </div>
                ${job.failed_items > 0 ? `
                  <div class="text-xs text-red-600 dark:text-red-400 mt-1">
                    ${job.failed_items} failed
                  </div>
                ` : ''}
              </div>
            ` : ''}
            ${job.status === 'scanning' ? `
              <div class="mt-2 text-sm text-gray-600 dark:text-gray-400">
                <div class="flex items-center gap-2">
                  <div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
                  <span>Scanning folder tree...</span>
                </div>
              </div>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function updateRecentQueued(jobs) {
  const container = document.getElementById('recent-queued');

  if (jobs.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-500 dark:text-gray-400 py-8">No recent queued jobs</div>';
    return;
  }

  container.innerHTML = `
    <div class="space-y-2">
      ${jobs.map(job => `
        <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded">
          <div class="flex-1">
            <div class="font-medium">${escapeHtml(job.username)}</div>
            <div class="text-sm text-gray-600 dark:text-gray-400">${escapeHtml(job.detail)}</div>
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            ${formatTimeAgo(job.created_at)}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function updateRecentCompleted(jobs) {
  const container = document.getElementById('recent-completed');

  if (jobs.length === 0) {
    container.innerHTML = '<div class="text-center text-gray-500 dark:text-gray-400 py-8">No recent completed jobs</div>';
    return;
  }

  container.innerHTML = `
    <div class="space-y-2">
      ${jobs.map(job => `
        <div class="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700 rounded">
          <div class="flex-1">
            <div class="font-medium">${escapeHtml(job.username)}</div>
            <div class="text-sm text-gray-600 dark:text-gray-400">${escapeHtml(job.detail)}</div>
          </div>
          <div class="text-xs text-gray-500 dark:text-gray-400">
            ${formatTimeAgo(job.created_at)}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function startPolling() {
  if (pollInterval) clearInterval(pollInterval);
  pollInterval = setInterval(() => {
    loadQueueData();
  }, 5000); // Poll every 5 seconds
}

function stopPolling() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function cleanupQueueMonitor() {
  stopPolling();
}
