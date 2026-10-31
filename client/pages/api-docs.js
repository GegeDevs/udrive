import { api } from '../api.js';
import { showToast } from '../components/toast.js';

const API_DOCS = [
  {
    group: 'Files',
    endpoints: [
      { method: 'GET', path: '/api/v1/files', desc: 'List files in folder', params: [{ name: 'folderId', type: 'query', desc: 'Folder ID (optional, defaults to shared folder)' }], perm: 'api:files:read' },
      { method: 'GET', path: '/api/v1/files/:fileId', desc: 'Get file info', params: [{ name: 'fileId', type: 'path', desc: 'File ID' }], perm: 'api:files:read' },
      { method: 'GET', path: '/api/v1/files/:fileId/download', desc: 'Download file', params: [{ name: 'fileId', type: 'path', desc: 'File ID' }], perm: 'api:files:download' },
      { method: 'POST', path: '/api/v1/files/upload', desc: 'Upload file', params: [{ name: 'file', type: 'form', desc: 'File (multipart)' }, { name: 'folderId', type: 'form', desc: 'Target folder ID (optional)' }], perm: 'api:files:upload' },
      { method: 'POST', path: '/api/v1/files/folder', desc: 'Create folder', params: [{ name: 'name', type: 'body', desc: 'Folder name' }, { name: 'parentId', type: 'body', desc: 'Parent folder ID (optional)' }], perm: 'api:files:write' },
      { method: 'PATCH', path: '/api/v1/files/:fileId', desc: 'Rename file', params: [{ name: 'fileId', type: 'path', desc: 'File ID' }, { name: 'name', type: 'body', desc: 'New name' }], perm: 'api:files:write' },
      { method: 'DELETE', path: '/api/v1/files/:fileId', desc: 'Delete file', params: [{ name: 'fileId', type: 'path', desc: 'File ID' }], perm: 'api:files:write' },
      { method: 'POST', path: '/api/v1/files/:fileId/move', desc: 'Move file', params: [{ name: 'fileId', type: 'path', desc: 'File ID' }, { name: 'newParentId', type: 'body', desc: 'Destination folder ID' }, { name: 'oldParentId', type: 'body', desc: 'Source folder ID (optional)' }], perm: 'api:files:write' },
      { method: 'POST', path: '/api/v1/files/:fileId/copy', desc: 'Copy file', params: [{ name: 'fileId', type: 'path', desc: 'File ID' }, { name: 'destinationId', type: 'body', desc: 'Destination folder ID' }], perm: 'api:files:write' },
      { method: 'POST', path: '/api/v1/files/:fileId/transfer-owner', desc: 'Transfer ownership', params: [{ name: 'fileId', type: 'path', desc: 'File ID' }, { name: 'targetAccountId', type: 'body', desc: 'Target account ID' }], perm: 'api:files:transfer' }
    ]
  },
  {
    group: 'Accounts',
    endpoints: [
      { method: 'GET', path: '/api/v1/accounts', desc: 'List accounts with storage info', params: [], perm: 'api:accounts:read' }
    ]
  }
];

let activeTab = 'docs';
let testApiKey = localStorage.getItem('udrive-test-api-key') || '';
let testBaseUrl = window.location.origin;

export function renderApiDocsPage() {
  const main = document.getElementById('main-content');

  main.innerHTML = `
    <div class="p-3 md:p-6">
      <div class="sticky top-0 z-10 bg-white dark:bg-gray-900 pb-4">
        <h2 class="text-xl md:text-2xl font-semibold mb-4">API Documentation</h2>
        <div class="flex gap-1 border-b border-gray-200 dark:border-gray-700">
          <button class="tab-btn px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'docs' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" data-tab="docs">Endpoints</button>
          <button class="tab-btn px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'test' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}" data-tab="test">Test</button>
        </div>
      </div>
      <div id="api-docs-content"></div>
    </div>
  `;

  main.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      activeTab = btn.dataset.tab;
      renderApiDocsPage();
    });
  });

  if (activeTab === 'docs') renderDocsTab();
  else renderTestTab();
}

function renderDocsTab() {
  const container = document.getElementById('api-docs-content');

  container.innerHTML = `
    <div class="mt-4 space-y-6">
      <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
        <h3 class="text-sm font-semibold mb-2">Authentication</h3>
        <p class="text-xs text-gray-600 dark:text-gray-400 mb-2">All API requests require a Bearer token in the Authorization header:</p>
        <code class="text-xs bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded block">Authorization: Bearer udrive_your_api_key_here</code>
      </div>
      <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
        <h3 class="text-sm font-semibold mb-2">Rate Limiting</h3>
        <p class="text-xs text-gray-600 dark:text-gray-400">Responses include rate limit headers: <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining</code>, <code>X-RateLimit-Reset</code>. Exceeding the limit returns <code>429 Too Many Requests</code>.</p>
      </div>
      ${API_DOCS.map(group => `
        <div>
          <h3 class="text-lg font-semibold mb-3">${group.group}</h3>
          <div class="space-y-3">
            ${group.endpoints.map(ep => `
              <div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                <div class="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-gray-800 cursor-pointer endpoint-header" data-path="${ep.path}" data-method="${ep.method}">
                  <span class="px-2 py-0.5 text-[10px] font-bold rounded ${getMethodColor(ep.method)}">${ep.method}</span>
                  <code class="text-xs flex-1">${ep.path}</code>
                  <span class="text-xs text-gray-500 dark:text-gray-400 hidden sm:inline">${ep.desc}</span>
                  <button class="btn-copy-curl btn-icon hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors" title="Copy as cURL" data-endpoint='${JSON.stringify(ep)}'>
                    <span class="material-icons-outlined text-sm">content_copy</span>
                  </button>
                </div>
                <div class="endpoint-body hidden px-4 py-3 text-xs space-y-2">
                  <p class="text-gray-600 dark:text-gray-400">${ep.desc}</p>
                  <p><span class="font-medium">Permission:</span> <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">${ep.perm}</code></p>
                  ${ep.params.length > 0 ? `
                    <div>
                      <p class="font-medium mb-1">Parameters:</p>
                      <table class="w-full">
                        ${ep.params.map(p => `
                          <tr class="border-t border-gray-100 dark:border-gray-800">
                            <td class="py-1 pr-2 font-mono">${p.name}</td>
                            <td class="py-1 pr-2 text-gray-500">${p.type}</td>
                            <td class="py-1 text-gray-500">${p.desc}</td>
                          </tr>
                        `).join('')}
                      </table>
                    </div>
                  ` : ''}
                  <div>
                    <p class="font-medium mb-1">cURL:</p>
                    <pre class="bg-gray-100 dark:bg-gray-900 p-2 rounded text-[11px] overflow-x-auto">${escapeHtml(generateCurl(ep, 'YOUR_API_KEY', 'EXAMPLE_ID'))}</pre>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.endpoint-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.btn-copy-curl')) return;
      const body = header.nextElementSibling;
      body.classList.toggle('hidden');
    });
  });

  container.querySelectorAll('.btn-copy-curl').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ep = JSON.parse(btn.dataset.endpoint);
      const curl = generateCurl(ep, testApiKey || 'YOUR_API_KEY', 'FILE_ID');
      navigator.clipboard.writeText(curl).then(() => showToast('cURL copied', 'success'));
    });
  });
}

function renderTestTab() {
  const container = document.getElementById('api-docs-content');

  container.innerHTML = `
    <div class="mt-4 max-w-2xl space-y-4">
      <div class="space-y-3">
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">API Key</label>
          <input type="text" id="test-api-key" value="${escapeHtml(testApiKey)}" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none" placeholder="udrive_...">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Base URL</label>
          <input type="text" id="test-base-url" value="${escapeHtml(testBaseUrl)}" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-sm focus:ring-2 focus:ring-blue-500 outline-none">
        </div>
      </div>
      <div class="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
        <div class="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-800">
          <select id="test-method" class="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-sm font-bold">
            <option>GET</option>
            <option>POST</option>
            <option>PATCH</option>
            <option>DELETE</option>
          </select>
          <input type="text" id="test-path" value="/api/v1/files" class="flex-1 px-3 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-800 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none">
          <button id="btn-send-test" class="btn-primary text-sm">Send</button>
        </div>
        <div class="p-3">
          <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Body (JSON)</label>
          <textarea id="test-body" rows="3" class="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-xs font-mono focus:ring-2 focus:ring-blue-500 outline-none" placeholder='{"name": "example"}'></textarea>
        </div>
        <div class="p-3 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2">
          <button id="btn-copy-test-curl" class="btn-secondary text-xs">
            <span class="material-icons-outlined text-sm">content_copy</span>
            Copy cURL
          </button>
          <span id="test-status" class="text-xs text-gray-500 dark:text-gray-400 ml-auto"></span>
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Response</label>
        <pre id="test-response" class="bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg p-3 text-xs font-mono overflow-auto max-h-80 whitespace-pre-wrap">No response yet</pre>
      </div>
    </div>
  `;

  container.querySelector('#test-api-key').addEventListener('change', (e) => {
    testApiKey = e.target.value.trim();
    localStorage.setItem('udrive-test-api-key', testApiKey);
  });

  container.querySelector('#test-base-url').addEventListener('change', (e) => {
    testBaseUrl = e.target.value.trim();
  });

  container.querySelector('#btn-send-test').addEventListener('click', sendTestRequest);

  container.querySelector('#btn-copy-test-curl').addEventListener('click', () => {
    const method = document.getElementById('test-method').value;
    const path = document.getElementById('test-path').value;
    const body = document.getElementById('test-body').value.trim();
    const curl = buildCurl(method, testBaseUrl + path, testApiKey, body);
    navigator.clipboard.writeText(curl).then(() => showToast('cURL copied', 'success'));
  });
}

async function sendTestRequest() {
  const method = document.getElementById('test-method').value;
  const path = document.getElementById('test-path').value;
  const body = document.getElementById('test-body').value.trim();
  const statusEl = document.getElementById('test-status');
  const responseEl = document.getElementById('test-response');

  statusEl.textContent = 'Sending...';
  responseEl.textContent = '';

  try {
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${testApiKey}`,
        'Content-Type': 'application/json'
      }
    };
    if (body && method !== 'GET') opts.body = body;

    const start = Date.now();
    const res = await fetch(testBaseUrl + path, opts);
    const elapsed = Date.now() - start;

    statusEl.textContent = `${res.status} ${res.statusText} · ${elapsed}ms`;
    statusEl.className = `text-xs ml-auto ${res.ok ? 'text-green-600' : 'text-red-500'}`;

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('json')) {
      const data = await res.json();
      responseEl.textContent = JSON.stringify(data, null, 2);
    } else {
      responseEl.textContent = await res.text();
    }
  } catch (err) {
    statusEl.textContent = 'Error';
    statusEl.className = 'text-xs ml-auto text-red-500';
    responseEl.textContent = err.message;
  }
}

function generateCurl(ep, apiKey, fileId) {
  const url = testBaseUrl + ep.path.replace(':fileId', fileId);
  let curl = `curl -X ${ep.method} "${url}"`;
  curl += ` \\\n  -H "Authorization: Bearer ${apiKey}"`;

  if (['POST', 'PATCH'].includes(ep.method)) {
    const bodyParams = ep.params.filter(p => p.type === 'body');
    const formParams = ep.params.filter(p => p.type === 'form');

    if (formParams.length > 0) {
      formParams.forEach(p => {
        if (p.name === 'file') curl += ` \\\n  -F "file=@/path/to/file"`;
        else curl += ` \\\n  -F "${p.name}=value"`;
      });
    } else if (bodyParams.length > 0) {
      curl += ` \\\n  -H "Content-Type: application/json"`;
      const body = {};
      bodyParams.forEach(p => { body[p.name] = `<${p.name}>`; });
      curl += ` \\\n  -d '${JSON.stringify(body)}'`;
    }
  }

  return curl;
}

function buildCurl(method, url, apiKey, body) {
  let curl = `curl -X ${method} "${url}"`;
  curl += ` \\\n  -H "Authorization: Bearer ${apiKey}"`;
  if (body && method !== 'GET') {
    curl += ` \\\n  -H "Content-Type: application/json"`;
    curl += ` \\\n  -d '${body}'`;
  }
  return curl;
}

function getMethodColor(method) {
  const colors = {
    GET: 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300',
    POST: 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
    PATCH: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
    DELETE: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
  };
  return colors[method] || 'bg-gray-100 text-gray-700';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
