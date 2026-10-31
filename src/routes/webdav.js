import { Hono } from 'hono';
import { authenticate } from '../middleware/auth.js';
import { authenticateApiKey } from '../middleware/api-auth.js';
import * as drive from '../services/google-drive.js';

const webdav = new Hono();
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PROPFIND_CAP = 1000;

async function getSharedFolderId(db) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").first();
  return row?.value || null;
}
async function getPrimaryAccountId(db) {
  const row = await db.prepare('SELECT id FROM accounts WHERE is_primary = 1').first();
  return row?.id || null;
}

// ---------- auth (WebDAV clients send credentials in various shapes) ----------

// Credentials to try, in order: explicit header, Bearer, then Basic user/pass.
// Basic is what Finder / Windows send, so both fields are tried — a session
// token or a long-lived API key (udrive_...) can go in either one.
function candidateTokens(headers) {
  const tokens = [];
  const explicit = headers.get('x-session-token');
  if (explicit) tokens.push(explicit);

  const auth = headers.get('authorization') || '';
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer) tokens.push(bearer[1].trim());

  const basic = auth.match(/^Basic\s+(.+)$/i);
  if (basic) {
    try {
      const decoded = Buffer.from(basic[1], 'base64').toString('utf-8');
      const [username, ...rest] = decoded.split(':');
      const password = rest.join(':');
      if (username) tokens.push(username);
      if (password) tokens.push(password);
    } catch {}
  }
  return tokens.filter(Boolean);
}

async function resolveUser(db, headers) {
  for (const token of candidateTokens(headers)) {
    // session token?
    const sessionHeaders = new Headers();
    sessionHeaders.set('x-session-token', token);
    const probe = new Request('http://webdav.local/', { method: 'GET', headers: sessionHeaders });
    const user = await authenticate(db, probe);
    if (user) return user;

    // long-lived API key?
    if (token.startsWith('udrive_')) {
      const keyProbe = new Request('http://webdav.local/', {
        method: 'GET',
        headers: { authorization: `Bearer ${token}` },
      });
      const apiKey = await authenticateApiKey(db, keyProbe);
      if (apiKey) return { id: apiKey.userId, username: apiKey.name, role: 'api' };
    }
  }
  return null;
}

webdav.use('*', async (c, next) => {
  // OPTIONS only advertises capabilities; clients often probe it before auth.
  if (c.req.method === 'OPTIONS') return next();
  const user = await resolveUser(c.get('db'), c.req.raw.headers);
  if (!user) {
    return c.json({ error: 'Authentication required' }, 401, {
      'WWW-Authenticate': 'Basic realm="UDrive WebDAV"',
    });
  }
  c.set('user', user);
  await next();
});

// ---------- helpers ----------

async function getRoot(c) {
  const db = c.get('db');
  const rootId = await getSharedFolderId(db);
  const accountId = await getPrimaryAccountId(db);
  if (!rootId || !accountId) return null;
  return { env: c.env, db, rootId, accountId };
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function httpDate(iso) {
  return new Date(iso || 0).toUTCString();
}

// Path below /webdav, percent-decoded, without leading or trailing slashes.
function relPath(c) {
  const p = c.req.path;
  if (p === '/webdav') return '';
  return p
    .slice('/webdav'.length)
    .split('/')
    .filter(Boolean)
    .map((s) => {
      try { return decodeURIComponent(s); } catch { return s; }
    })
    .join('/');
}

// Resolve a webdav path (/a/b/c) to a drive file. Null when missing.
async function resolvePath(env, db, accountId, rootId, path) {
  const segments = path.split('/').filter(Boolean);
  let fileId = rootId;
  let mimeType = FOLDER_MIME;
  let name = 'My Drive';
  for (const seg of segments) {
    const children = await drive.listFiles(env, db, accountId, fileId);
    const child = children.find((f) => f.name === seg);
    if (!child) return null;
    fileId = child.id;
    mimeType = child.mimeType || FOLDER_MIME;
    name = child.name;
  }
  return { id: fileId, name, mimeType };
}

const isFolder = (f) => (f.mimeType || f.mime) === FOLDER_MIME;

function hrefFor(segments) {
  return '/webdav/' + segments.map((s) => encodeURIComponent(s)).join('/');
}

function propXml(file, href, folder) {
  const size = folder ? '0' : String(file.size || 0);
  const type = folder ? 'httpd/unix-directory' : (file.mimeType || file.mime || 'application/octet-stream');
  const etag = file.etag || file.id;
  return `
    <d:response>
      <d:href>${esc(href)}</d:href>
      <d:propstat>
        <d:prop>
          <d:resourcetype>${folder ? '<d:collection/>' : ''}</d:resourcetype>
          <d:getcontentlength>${size}</d:getcontentlength>
          <d:getcontenttype>${esc(type)}</d:getcontenttype>
          <d:getlastmodified>${esc(httpDate(file.modifiedTime || file.modifiedDate))}</d:getlastmodified>
          <d:creationdate>${esc(new Date(file.createdTime || file.modifiedTime || 0).toISOString())}</d:creationdate>
          <d:getetag>"${esc(etag)}"</d:getetag>
          <d:displayname>${esc(file.name)}</d:displayname>
        </d:prop>
        <d:status>HTTP/1.1 200 OK</d:status>
      </d:propstat>
    </d:response>`;
}

function multistatus(responses) {
  return `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">${responses.join('')}</d:multistatus>`;
}

const xml = (c, body, status = 207) =>
  c.body(body, status, { 'Content-Type': 'application/xml; charset=utf-8', 'DAV': '1' });

// ---------- PROPFIND ----------

webdav.on('PROPFIND', '/*', async (c) => {
  const ctx = await getRoot(c);
  if (!ctx) return c.json({ error: 'Shared folder not configured' }, 500);
  const { env, db, rootId, accountId } = ctx;
  const path = relPath(c);
  const segments = path.split('/').filter(Boolean);
  const depth = c.req.header('Depth') || '1';

  const target = await resolvePath(env, db, accountId, rootId, path);
  if (!target) return c.body(null, 404);

  const responses = [propXml(target, hrefFor(segments), target.mimeType === FOLDER_MIME)];
  if (depth === '0' || target.mimeType !== FOLDER_MIME) return xml(c, multistatus(responses));

  if (depth === 'infinity') {
    // BFS with a hard cap so a deep tree cannot run away.
    let queue = [{ id: target.id, segments }];
    let seen = 0;
    while (queue.length && seen < PROPFIND_CAP) {
      const next = [];
      for (const item of queue) {
        const children = await drive.listFiles(env, db, accountId, item.id);
        for (const child of children) {
          if (seen++ >= PROPFIND_CAP) break;
          const childSegments = [...item.segments, child.name];
          responses.push(propXml(child, hrefFor(childSegments), isFolder(child)));
          if (isFolder(child)) next.push({ id: child.id, segments: childSegments });
        }
        if (seen >= PROPFIND_CAP) break;
      }
      queue = next;
    }
  } else {
    const children = await drive.listFiles(env, db, accountId, target.id);
    for (const child of children) {
      responses.push(propXml(child, hrefFor([...segments, child.name]), isFolder(child)));
    }
  }

  return xml(c, multistatus(responses));
});

// ---------- OPTIONS ----------

webdav.options('/*', (c) =>
  c.body(null, 200, {
    'DAV': '1',
    'Allow': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, COPY, MOVE',
    'MS-Author-Via': 'DA',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Depth, Destination, Content-Type, X-Session-Token, Authorization',
    'Access-Control-Allow-Methods': 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, COPY, MOVE',
  })
);

// ---------- GET / HEAD ----------

webdav.get('/*', async (c) => {
  const ctx = await getRoot(c);
  if (!ctx) return c.json({ error: 'Shared folder not configured' }, 500);
  const { env, db, rootId, accountId } = ctx;
  const target = await resolvePath(env, db, accountId, rootId, relPath(c));
  if (!target) return c.body(null, 404);
  if (target.mimeType === FOLDER_MIME) return c.body('Collection cannot be downloaded', 403);

  const file = await drive.downloadFile(env, db, accountId, target.id);
  // No Content-Length: Docs/shortcut downloads may not report a size.
  return new Response(file.body, {
    status: 200,
    headers: {
      'Content-Type': file.metadata?.mimeType || 'application/octet-stream',
      'DAV': '1',
    },
  });
});

webdav.on('HEAD', '/*', async (c) => {
  const ctx = await getRoot(c);
  if (!ctx) return c.body(null, 500);
  const { db, rootId, accountId } = ctx;
  const target = await resolvePath(c.env, db, accountId, rootId, relPath(c));
  if (!target) return c.body(null, 404);
  if (target.mimeType === FOLDER_MIME) return c.body(null, 403);
  const headers = {
    'Content-Type': target.mimeType || 'application/octet-stream',
    'DAV': '1',
  };
  if (target.size) headers['Content-Length'] = String(target.size);
  return c.body(null, 200, headers);
});

// ---------- PUT (create / overwrite file) ----------

webdav.put('/*', async (c) => {
  const ctx = await getRoot(c);
  if (!ctx) return c.json({ error: 'Shared folder not configured' }, 500);
  const { env, db, rootId, accountId } = ctx;
  const path = relPath(c);
  const segments = path.split('/').filter(Boolean);
  const name = segments.pop();
  if (!name) return c.body(null, 400);

  const parent = await resolvePath(env, db, accountId, rootId, segments.join('/'));
  if (!parent || parent.mimeType !== FOLDER_MIME) return c.body(null, 409);

  const existing = await resolvePath(env, db, accountId, rootId, path);
  const buffer = Buffer.from(await c.req.raw.arrayBuffer());
  // Drive has no simple in-place overwrite in our helper, so remove first.
  if (existing && existing.mimeType !== FOLDER_MIME) {
    await drive.deleteFile(env, db, accountId, existing.id);
  }
  await drive.uploadFile(env, db, accountId, parent.id, buffer, {
    name,
    type: c.req.header('Content-Type') || 'application/octet-stream',
  });
  return c.body(null, existing ? 204 : 201);
});

// ---------- MKCOL (create folder) ----------

webdav.on('MKCOL', '/*', async (c) => {
  const ctx = await getRoot(c);
  if (!ctx) return c.json({ error: 'Shared folder not configured' }, 500);
  const { env, db, rootId, accountId } = ctx;
  const path = relPath(c);
  const segments = path.split('/').filter(Boolean);
  const name = segments.pop();
  if (!name) return c.body(null, 400);

  const parent = await resolvePath(env, db, accountId, rootId, segments.join('/'));
  if (!parent || parent.mimeType !== FOLDER_MIME) return c.body(null, 409);
  if (await resolvePath(env, db, accountId, rootId, path)) return c.body(null, 405);

  await drive.createFolder(env, db, accountId, parent.id, name);
  return c.body(null, 201);
});

// ---------- DELETE ----------

webdav.delete('/*', async (c) => {
  const ctx = await getRoot(c);
  if (!ctx) return c.json({ error: 'Shared folder not configured' }, 500);
  const { env, db, rootId, accountId } = ctx;
  const path = relPath(c);
  if (!path) return c.body(null, 405); // never delete the shared root
  const target = await resolvePath(env, db, accountId, rootId, path);
  if (!target) return c.body(null, 404);
  await drive.deleteFile(env, db, accountId, target.id);
  return c.body(null, 204);
});

// ---------- MOVE / COPY ----------

function destPath(c) {
  const header = c.req.header('Destination');
  if (!header) return null;
  const url = new URL(header, `http://${c.req.header('host') || 'localhost'}`);
  if (!url.pathname.startsWith('/webdav')) return null;
  return decodeURIComponent(url.pathname.slice('/webdav'.length).replace(/^\/+/, '').replace(/\/+$/, ''));
}

async function destinationParent(env, db, accountId, rootId, dst) {
  const segments = dst.split('/').filter(Boolean);
  segments.pop(); // destination file name, unused by move/copy
  const parent = await resolvePath(env, db, accountId, rootId, segments.join('/'));
  return parent && parent.mimeType === FOLDER_MIME ? parent : null;
}

webdav.on('MOVE', '/*', async (c) => {
  const ctx = await getRoot(c);
  if (!ctx) return c.json({ error: 'Shared folder not configured' }, 500);
  const { env, db, rootId, accountId } = ctx;
  const srcRaw = relPath(c);
  const dstRaw = destPath(c);
  if (!srcRaw || !dstRaw) return c.body(null, 400);

  const src = await resolvePath(env, db, accountId, rootId, srcRaw);
  if (!src) return c.body(null, 404);
  const parent = await destinationParent(env, db, accountId, rootId, dstRaw);
  if (!parent) return c.body(null, 409);

  const info = await drive.getFileInfo(env, db, accountId, src.id);
  const oldParent = (info.parents || [rootId])[0];
  const dstName = dstRaw.split('/').filter(Boolean).pop();
  // WebDAV MOVE renames and/or reparents; Drive needs both as separate calls.
  if (dstName && dstName !== src.name) {
    await drive.renameFile(env, db, accountId, src.id, dstName);
  }
  if (oldParent !== parent.id) {
    await drive.moveFile(env, db, accountId, src.id, parent.id, oldParent);
  }
  return c.body(null, 201);
});

webdav.on('COPY', '/*', async (c) => {
  const ctx = await getRoot(c);
  if (!ctx) return c.json({ error: 'Shared folder not configured' }, 500);
  const { env, db, rootId, accountId } = ctx;
  const srcRaw = relPath(c);
  const dstRaw = destPath(c);
  if (!srcRaw || !dstRaw) return c.body(null, 400);

  const src = await resolvePath(env, db, accountId, rootId, srcRaw);
  if (!src) return c.body(null, 404);
  const parent = await destinationParent(env, db, accountId, rootId, dstRaw);
  if (!parent) return c.body(null, 409);

  const result = await drive.copyFile(env, db, accountId, src.id, parent.id);
  const dstName = dstRaw.split('/').filter(Boolean).pop();
  if (dstName && dstName !== src.name && result?.id) {
    await drive.renameFile(env, db, accountId, result.id, dstName);
  }
  return c.body(null, 201);
});

export default webdav;
