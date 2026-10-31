import { api } from '../api.js';
import { addToUploadQueue } from './transfer-panel.js';

// Dropped directories arrive as DataTransferItem entries, not as files.
// Sending a directory File to XHR uploads nothing and aborts the request
// (server logs ECONNRESET), so walk the tree and recreate it server-side.
export async function uploadDroppedEntries(items, fallbackFiles, folderId) {
  const entries = items.map(i => i.webkitGetAsEntry?.()).filter(Boolean);

  if (!entries.length) {
    for (const file of fallbackFiles) addToUploadQueue(file, folderId);
    return fallbackFiles.length;
  }

  // Phase 1: recreate the whole folder tree first.
  const pending = [];
  for (const entry of entries) await walk(entry, folderId);

  // Phase 2: queue files only once every target folder exists.
  for (const { file, parentId } of pending) addToUploadQueue(file, parentId);
  return pending.length;

  async function walk(entry, parentId) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
      pending.push({ file, parentId });
      return;
    }
    if (!entry.isDirectory) return;

    const created = await api('/api/files/folder', {
      method: 'POST',
      body: JSON.stringify({ name: entry.name, parentId })
    });
    const targetId = created.id || parentId;

    // readEntries returns at most ~100 entries per call; poll until empty.
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      for (const child of batch) await walk(child, targetId);
    }
  }
}
