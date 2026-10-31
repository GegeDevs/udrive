// Run: node scripts/check-drop-upload.mjs
// Traverses a fake dropped folder tree through uploadDroppedEntries and asserts
// every file lands in the folder created for its parent.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let src = fs.readFileSync(path.join(root, 'client/components/drop-upload.js'), 'utf8');
src = src.replace(/^import .*$/gm, '');

const harness = `
const created = [];
const queued = [];
const queuedWhenFolderCreated = [];
const api = async (p, o) => {
  const b = JSON.parse(o.body);
  queuedWhenFolderCreated.push(queued.length);
  const id = 'f' + created.length;
  created.push({ id, ...b });
  return { id };
};
const addToUploadQueue = (file, folderId) => queued.push({ name: file.name, folderId });
const fileEntry = (name) => ({ isFile: true, isDirectory: false, file: (res) => res({ name, size: 1 }) });
const dirEntry = (name, children) => ({
  isFile: false,
  isDirectory: true,
  name,
  createReader() {
    let i = 0;
    return { readEntries: (res) => { const b = children.slice(i, i + 2); i += b.length; res(b); } };
  }
});
const tree = dirEntry('root', [
  fileEntry('a.txt'),
  dirEntry('sub', [fileEntry('b.txt'), fileEntry('c.txt')]),
  fileEntry('d.txt')
]);
const n = await uploadDroppedEntries([{ kind: 'file', webkitGetAsEntry: () => tree }], [], 'PARENT');
const routed = Object.fromEntries(queued.map(q => [q.name, q.folderId]));
if (n !== 4) throw new Error('expected 4 files, got ' + n);
if (created.length !== 2) throw new Error('expected 2 folders, got ' + created.length);
if (routed['a.txt'] !== 'f0' || routed['d.txt'] !== 'f0') throw new Error('root files misrouted');
if (routed['b.txt'] !== 'f1' || routed['c.txt'] !== 'f1') throw new Error('nested files misrouted');
if (queuedWhenFolderCreated.some(n => n !== 0)) throw new Error('files queued before folder tree was ready');
console.log('PASS: 2 folders created first, then 4 files, routing ok');
`;

const tmp = path.join(os.tmpdir(), 'udrive-drop-check.mjs');
fs.writeFileSync(tmp, harness + src);
execFileSync(process.execPath, [tmp], { stdio: 'inherit' });
fs.unlinkSync(tmp);
