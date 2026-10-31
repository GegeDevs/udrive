// Runnable check for the WebDAV endpoint.
//
//   PORT=3999 node src/local.js          # in one shell
//   node scripts/check-webdav.mjs        # in another
//
// Creates a temp folder + file through WebDAV, reads it back, then deletes it.
// Requires a configured shared folder and at least one account.

import Database from 'better-sqlite3';
import { randomUUID, createHash } from 'node:crypto';

const BASE = `http://localhost:${process.env.PORT || 3999}`;

const db = new Database('data/udrive.db');
const user = db.prepare('SELECT id FROM users LIMIT 1').get();
const token = `check-webdav-${randomUUID()}`;
db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
  .run(token, user.id, new Date(Date.now() + 3600e3).toISOString());
db.close();

const headers = { authorization: `Bearer ${token}` };
const url = (p) => `${BASE}/webdav${p}`;
const tmp = `__webdav_${Date.now().toString(36)}`;
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

try {
  const options = await fetch(url('/'), { method: 'OPTIONS', headers });
  assert(options.status === 200, `OPTIONS ${options.status}`);
  assert(options.headers.get('dav') === '1', 'missing DAV: 1 header');
  assert((options.headers.get('allow') || '').includes('PROPFIND'), 'OPTIONS Allow missing PROPFIND');

  const root = await fetch(url('/'), { method: 'PROPFIND', headers: { ...headers, depth: '1' } });
  assert(root.status === 207, `PROPFIND root ${root.status}`);
  const rootXml = await root.text();
  assert(rootXml.includes('<d:multistatus'), 'PROPFIND root not multistatus');
  assert(rootXml.includes('xmlns:d="DAV:"'), 'PROPFIND missing DAV namespace');

  const mkcol = await fetch(url(`/${tmp}`), { method: 'MKCOL', headers });
  assert(mkcol.status === 201, `MKCOL ${mkcol.status}`);

  const put = await fetch(url(`/${tmp}/hello.txt`), {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'text/plain' },
    body: 'webdav roundtrip',
  });
  assert(put.status === 201, `PUT ${put.status}`);

  const get = await fetch(url(`/${tmp}/hello.txt`), { headers });
  assert(get.status === 200, `GET ${get.status}`);
  assert((await get.text()) === 'webdav roundtrip', 'GET body mismatch');

  // Basic auth with the session token as username.
  const basicHeader = { authorization: `Basic ${Buffer.from(`${token}:x`).toString('base64')}` };
  const basicGet = await fetch(url(`/${tmp}/hello.txt`), { headers: basicHeader });
  assert(basicGet.status === 200, `GET with Basic auth ${basicGet.status}`);

  // Long-lived API key as the Basic password (what Finder / Windows send).
  const rawKey = `udrive_check_${randomUUID().replace(/-/g, '')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyDb = new Database('data/udrive.db');
  keyDb.prepare('INSERT INTO api_keys (name, key_hash, key_prefix, user_id, permissions, rate_limit) VALUES (?, ?, ?, ?, ?, ?)')
    .run('webdav-check', keyHash, rawKey.slice(0, 14), user.id, '["api:files:read"]', 600);
  keyDb.close();
  const keyHeader = {
    authorization: `Basic ${Buffer.from(`any:${rawKey}`).toString('base64')}`,
  };
  const keyGet = await fetch(url(`/${tmp}/hello.txt`), { headers: keyHeader });
  assert(keyGet.status === 200, `GET with API key ${keyGet.status}`);

  const list = await fetch(url(`/${tmp}`), { method: 'PROPFIND', headers: { ...headers, depth: '1' } });
  const listXml = await list.text();
  assert(listXml.includes('hello.txt'), 'PROPFIND depth 1 missing child');
  assert(listXml.includes('<d:collection/>'), 'PROPFIND missing collection for folder');
  assert(listXml.includes('getcontentlength'), 'PROPFIND missing props');

  // Names with spaces must survive percent-encoding on the way in and out.
  const putSpace = await fetch(url(`/${tmp}/hello%20world.txt`), {
    method: 'PUT',
    headers: { ...headers, 'content-type': 'text/plain' },
    body: 'spaced name',
  });
  assert(putSpace.status === 201, `PUT spaced name ${putSpace.status}`);
  const getSpace = await fetch(url(`/${tmp}/hello%20world.txt`), { headers });
  assert(getSpace.status === 200 && (await getSpace.text()) === 'spaced name', 'GET spaced name failed');

  // MOVE: rename hello.txt -> moved.txt
  const move = await fetch(url(`/${tmp}/hello.txt`), {
    method: 'MOVE',
    headers: { ...headers, destination: url(`/${tmp}/moved.txt`) },
  });
  assert(move.status === 201, `MOVE ${move.status}`);
  const afterMove = await fetch(url(`/${tmp}`), { method: 'PROPFIND', headers: { ...headers, depth: '1' } });
  const movedXml = await afterMove.text();
  assert(movedXml.includes('moved.txt') && !movedXml.includes('hello.txt'), 'MOVE did not rename');

  // COPY: moved.txt -> copied.txt
  const copy = await fetch(url(`/${tmp}/moved.txt`), {
    method: 'COPY',
    headers: { ...headers, destination: url(`/${tmp}/copied.txt`) },
  });
  assert(copy.status === 201, `COPY ${copy.status}`);
  const afterCopy = await fetch(url(`/${tmp}`), { method: 'PROPFIND', headers: { ...headers, depth: '1' } });
  const copiedXml = await afterCopy.text();
  assert(copiedXml.includes('copied.txt') && copiedXml.includes('moved.txt'), 'COPY missing result');

  const delFile = await fetch(url(`/${tmp}/moved.txt`), { method: 'DELETE', headers });
  assert(delFile.status === 204, `DELETE file ${delFile.status}`);

  const delDir = await fetch(url(`/${tmp}`), { method: 'DELETE', headers });
  assert(delDir.status === 204, `DELETE folder ${delDir.status}`);

  const unauth = await fetch(url('/'), { method: 'PROPFIND', headers: { depth: '0' } });
  assert(unauth.status === 401, `unauthenticated PROPFIND should be 401, got ${unauth.status}`);
  assert((unauth.headers.get('www-authenticate') || '').startsWith('Basic'), 'missing WWW-Authenticate');

  console.log('WebDAV check passed');
} finally {
  // best-effort cleanup if an assertion failed midway
  await fetch(url(`/${tmp}`), { method: 'DELETE', headers }).catch(() => {});
  const cleanup = new Database('data/udrive.db');
  cleanup.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  cleanup.prepare("DELETE FROM api_keys WHERE name = 'webdav-check'").run();
  cleanup.close();
}
