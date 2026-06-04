import { refreshTokenIfNeeded } from './token-manager.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

async function getAuthHeaders(env, db, accountId) {
  let account = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(accountId).first();
  if (!account) throw new Error('Account not found');
  account = await refreshTokenIfNeeded(env, db, account);
  return { Authorization: `Bearer ${account.access_token}` };
}

export async function listFiles(env, db, accountId, folderId) {
  const headers = await getAuthHeaders(env, db, accountId);
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime,iconLink,thumbnailLink,hasThumbnail,shortcutDetails)');
  const res = await fetch(`${DRIVE_API}/files?q=${q}&fields=${fields}&orderBy=folder,name&pageSize=1000`, { headers });
  if (!res.ok) throw new Error(`List files failed: ${res.status}`);
  const data = await res.json();
  return data.files || [];
}

export async function uploadFile(env, db, accountId, folderId, fileBuffer, metadata) {
  const headers = await getAuthHeaders(env, db, accountId);
  const boundary = 'udrive_boundary';

  const metadataBody = JSON.stringify({ name: metadata.name, parents: [folderId] });
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataBody}\r\n--${boundary}\r\nContent-Type: ${metadata.type}\r\n\r\n`;
  const ending = `\r\n--${boundary}--`;

  const bodyParts = new Uint8Array([
    ...new TextEncoder().encode(body),
    ...new Uint8Array(fileBuffer),
    ...new TextEncoder().encode(ending)
  ]);

  const res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,size`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: bodyParts
  });

  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return res.json();
}

export async function downloadFile(env, db, accountId, fileId) {
  const headers = await getAuthHeaders(env, db, accountId);
  const metaRes = await fetch(`${DRIVE_API}/files/${fileId}?fields=name,mimeType,size`, { headers });
  if (!metaRes.ok) throw new Error('File metadata fetch failed');
  const metadata = await metaRes.json();

  const streamRes = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, { headers });
  if (!streamRes.ok) throw new Error('File download failed');

  return { metadata, body: streamRes.body, headers: streamRes.headers };
}

export async function downloadFileRange(env, db, accountId, fileId, rangeHeader) {
  const headers = await getAuthHeaders(env, db, accountId);
  const metaRes = await fetch(`${DRIVE_API}/files/${fileId}?fields=name,mimeType,size`, { headers });
  if (!metaRes.ok) throw new Error('File metadata fetch failed');
  const metadata = await metaRes.json();

  const streamRes = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { ...headers, Range: rangeHeader }
  });

  return { metadata, body: streamRes.body, status: streamRes.status, headers: streamRes.headers };
}

export async function createFolder(env, db, accountId, parentId, name) {
  const headers = await getAuthHeaders(env, db, accountId);
  const res = await fetch(`${DRIVE_API}/files?fields=id,name,mimeType`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] })
  });
  if (!res.ok) throw new Error(`Create folder failed: ${res.status}`);
  return res.json();
}

export async function renameFile(env, db, accountId, fileId, newName) {
  const headers = await getAuthHeaders(env, db, accountId);
  const res = await fetch(`${DRIVE_API}/files/${fileId}?fields=id,name,mimeType`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName })
  });
  if (!res.ok) throw new Error(`Rename failed: ${res.status}`);
  return res.json();
}

export async function deleteFile(env, db, accountId, fileId) {
  const headers = await getAuthHeaders(env, db, accountId);
  try {
    const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
      method: 'PATCH',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true })
    });
    if (!res.ok) throw new Error();
  } catch {
    await fetch(`${DRIVE_API}/files/${fileId}`, { method: 'DELETE', headers });
  }
}

export async function permanentDeleteFile(env, db, accountId, fileId) {
  const headers = await getAuthHeaders(env, db, accountId);
  await fetch(`${DRIVE_API}/files/${fileId}`, { method: 'DELETE', headers });
}

export async function restoreFile(env, db, accountId, fileId) {
  const headers = await getAuthHeaders(env, db, accountId);
  await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ trashed: false })
  });
}

export async function moveFile(env, db, accountId, fileId, newParentId, oldParentId) {
  const headers = await getAuthHeaders(env, db, accountId);
  const res = await fetch(`${DRIVE_API}/files/${fileId}?addParents=${newParentId}&removeParents=${oldParentId}&fields=id,name,mimeType`, {
    method: 'PATCH',
    headers
  });
  if (!res.ok) throw new Error(`Move failed: ${res.status}`);
  return res.json();
}

export async function copyFile(env, db, accountId, fileId, destinationId) {
  const headers = await getAuthHeaders(env, db, accountId);
  const res = await fetch(`${DRIVE_API}/files/${fileId}/copy?fields=id,name,mimeType,size`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ parents: [destinationId] })
  });
  if (!res.ok) throw new Error(`Copy failed: ${res.status}`);
  return res.json();
}

export async function getStorageQuota(env, db, accountId) {
  const headers = await getAuthHeaders(env, db, accountId);
  const res = await fetch(`${DRIVE_API}/about?fields=storageQuota`, { headers });
  if (!res.ok) throw new Error('Quota fetch failed');
  const data = await res.json();

  // Count files owned by this account
  const countRes = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent("'me' in owners and trashed = false")}&fields=files(id)&pageSize=1000`, { headers });
  let fileCount = 0;
  if (countRes.ok) {
    const countData = await countRes.json();
    fileCount = countData.files?.length || 0;
  }

  return {
    limit: parseInt(data.storageQuota.limit || '16106127360'),
    used: parseInt(data.storageQuota.usage || '0'),
    fileCount
  };
}

export async function shareFolder(env, db, primaryAccountId, folderId, email) {
  const headers = await getAuthHeaders(env, db, primaryAccountId);
  await fetch(`${DRIVE_API}/files/${folderId}/permissions`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email })
  });
}

export async function getFileOwnerEmail(env, db, accountId, fileId) {
  const headers = await getAuthHeaders(env, db, accountId);
  const res = await fetch(`${DRIVE_API}/files/${fileId}?fields=owners(emailAddress)`, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  return data.owners?.[0]?.emailAddress || null;
}

export async function getFileInfo(env, db, accountId, fileId) {
  const headers = await getAuthHeaders(env, db, accountId);
  const res = await fetch(`${DRIVE_API}/files/${fileId}?fields=id,name,mimeType,size,modifiedTime,createdTime,parents,owners(emailAddress,displayName),shared`, { headers });
  if (!res.ok) throw new Error('File info fetch failed');
  return res.json();
}

export async function checkFileExists(env, db, accountId, fileId) {
  try {
    const headers = await getAuthHeaders(env, db, accountId);
    const res = await fetch(`${DRIVE_API}/files/${fileId}?fields=id,trashed`, { headers });
    if (!res.ok) return false;
    const data = await res.json();
    return !data.trashed;
  } catch {
    return false;
  }
}

export async function listTrash(env, db, accountId) {
  const headers = await getAuthHeaders(env, db, accountId);
  const q = encodeURIComponent('trashed = true');
  const fields = encodeURIComponent('files(id,name,mimeType,size,modifiedTime,trashedTime)');
  const res = await fetch(`${DRIVE_API}/files?q=${q}&fields=${fields}&orderBy=modifiedTime desc&pageSize=200&includeItemsFromAllDrives=true&supportsAllDrives=true`, { headers });
  if (!res.ok) throw new Error('List trash failed');
  const data = await res.json();
  return data.files || [];
}

export async function getThumbnail(env, db, accountId, fileId, size = 200) {
  const headers = await getAuthHeaders(env, db, accountId);
  const res = await fetch(`${DRIVE_API}/files/${fileId}?fields=thumbnailLink`, { headers });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.thumbnailLink) return null;

  const sizedLink = data.thumbnailLink.replace(/=s\d+/, `=s${size}`);
  const thumbRes = await fetch(sizedLink, { headers });
  if (!thumbRes.ok) return null;

  return {
    body: thumbRes.body,
    contentType: thumbRes.headers.get('content-type'),
    contentLength: thumbRes.headers.get('content-length')
  };
}

export async function cleanAllFiles(env, db, accountId) {
  const headers = await getAuthHeaders(env, db, accountId);
  let deleted = 0;
  let failed = 0;
  const errors = [];

  // List all files owned by this account (including trashed)
  const allFiles = [];
  let pageToken = null;

  do {
    const q = encodeURIComponent("'me' in owners");
    const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType)');
    let url = `${DRIVE_API}/files?q=${q}&fields=${fields}&pageSize=1000`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const res = await fetch(url, { headers });
    if (!res.ok) {
      errors.push({ accountId, error: `List failed: ${res.status}` });
      break;
    }

    const data = await res.json();
    if (data.files) allFiles.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);

  // Separate non-folders and folders
  const nonFolders = allFiles.filter(f => f.mimeType !== 'application/vnd.google-apps.folder');
  const folders = allFiles.filter(f => f.mimeType === 'application/vnd.google-apps.folder');

  // Delete non-folders first
  for (const file of nonFolders) {
    const res = await fetch(`${DRIVE_API}/files/${file.id}`, { method: 'DELETE', headers });
    if (res.ok || res.status === 404) {
      deleted++;
      await db.prepare('DELETE FROM file_owners WHERE file_id = ?').bind(file.id).run();
    } else {
      failed++;
      errors.push({ accountId, fileId: file.id, error: `${res.status}` });
    }
  }

  // Delete folders
  for (const folder of folders) {
    const res = await fetch(`${DRIVE_API}/files/${folder.id}`, { method: 'DELETE', headers });
    if (res.ok || res.status === 404) {
      deleted++;
      await db.prepare('DELETE FROM file_owners WHERE file_id = ?').bind(folder.id).run();
    } else {
      failed++;
      errors.push({ accountId, fileId: folder.id, error: `${res.status}` });
    }
  }

  return { deleted, failed, errors };
}
