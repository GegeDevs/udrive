import { google } from 'googleapis';
import { getOAuth2Client, refreshAccountIfNeeded } from './token-manager.js';
import db from '../db/init.js';

async function getDrive(accountId) {
  let account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  if (!account) throw Object.assign(new Error('Account not found'), { status: 404 });
  account = await refreshAccountIfNeeded(account);
  const auth = getOAuth2Client(account);
  return google.drive({ version: 'v3', auth });
}

export async function getFileOwnerEmail(accountId, fileId) {
  const drive = await getDrive(accountId);
  const res = await drive.files.get({
    fileId,
    fields: 'owners(emailAddress)'
  });
  const owners = res.data.owners;
  if (owners && owners.length > 0) {
    return owners[0].emailAddress;
  }
  return null;
}

export async function getFileInfo(accountId, fileId) {
  const drive = await getDrive(accountId);
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, modifiedTime, createdTime, owners(emailAddress, displayName), shared'
  });
  return res.data;
}

export async function listFiles(accountId, folderId) {
  const drive = await getDrive(accountId);
  const res = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: 'files(id, name, mimeType, size, modifiedTime, iconLink, thumbnailLink, hasThumbnail, imageMediaMetadata(width, height))',
    orderBy: 'folder,name',
    pageSize: 1000
  });
  return res.data.files || [];
}

export async function getThumbnail(accountId, fileId, size = 200) {
  const drive = await getDrive(accountId);
  const res = await drive.files.get({
    fileId,
    fields: 'thumbnailLink'
  });

  const link = res.data.thumbnailLink;
  if (!link) return null;

  const sizedLink = link.replace(/=s\d+/, `=s${size}`);

  let account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  account = await refreshAccountIfNeeded(account);

  const response = await fetch(sizedLink, {
    headers: { Authorization: `Bearer ${account.access_token}` }
  });

  if (!response.ok) return null;

  return {
    stream: response.body,
    contentType: response.headers.get('content-type'),
    contentLength: response.headers.get('content-length')
  };
}

export async function uploadFile(accountId, folderId, fileStream, metadata) {
  const drive = await getDrive(accountId);
  const res = await drive.files.create({
    requestBody: {
      name: metadata.originalname,
      parents: [folderId]
    },
    media: {
      mimeType: metadata.mimetype,
      body: fileStream
    },
    fields: 'id, name, mimeType, size'
  });
  return res.data;
}

export async function downloadFile(accountId, fileId) {
  const drive = await getDrive(accountId);
  const meta = await drive.files.get({ fileId, fields: 'name, mimeType, size' });
  const stream = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  return { metadata: meta.data, stream: stream.data };
}

export async function downloadFileRange(accountId, fileId, rangeHeader) {
  const drive = await getDrive(accountId);
  const meta = await drive.files.get({ fileId, fields: 'name, mimeType, size' });
  const stream = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream', headers: { Range: rangeHeader } }
  );
  return { metadata: meta.data, stream: stream.data, headers: stream.headers };
}

export async function createFolder(accountId, parentId, name) {
  const drive = await getDrive(accountId);
  const res = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    },
    fields: 'id, name, mimeType'
  });
  return res.data;
}

export async function copyFile(accountId, fileId, newParentId) {
  const drive = await getDrive(accountId);
  const res = await drive.files.copy({
    fileId,
    requestBody: {
      parents: [newParentId]
    },
    fields: 'id, name, mimeType, size'
  });
  return res.data;
}

export async function renameFile(accountId, fileId, newName) {
  const drive = await getDrive(accountId);
  const res = await drive.files.update({
    fileId,
    requestBody: { name: newName },
    fields: 'id, name, mimeType'
  });
  return res.data;
}

export async function deleteFile(accountId, fileId) {
  const drive = await getDrive(accountId);
  try {
    await drive.files.update({ fileId, requestBody: { trashed: true } });
  } catch (e) {
    // Fallback: if can't trash (not owner), remove directly
    await drive.files.delete({ fileId });
  }
}

export async function permanentDeleteFile(accountId, fileId) {
  const drive = await getDrive(accountId);
  await drive.files.delete({ fileId });
}

export async function restoreFile(accountId, fileId) {
  const drive = await getDrive(accountId);
  await drive.files.update({ fileId, requestBody: { trashed: false } });
}

export async function listTrash(accountId) {
  const drive = await getDrive(accountId);
  const res = await drive.files.list({
    q: 'trashed = true',
    fields: 'files(id, name, mimeType, size, modifiedTime, trashedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 200,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true
  });
  return res.data.files || [];
}

export async function moveFile(accountId, fileId, newParentId, oldParentId) {
  const drive = await getDrive(accountId);
  const res = await drive.files.update({
    fileId,
    addParents: newParentId,
    removeParents: oldParentId,
    fields: 'id, name, mimeType'
  });
  return res.data;
}

export async function getStorageQuota(accountId) {
  const drive = await getDrive(accountId);
  const res = await drive.about.get({ fields: 'storageQuota' });
  const quota = res.data.storageQuota;
  return {
    limit: parseInt(quota.limit || '16106127360'),
    used: parseInt(quota.usage || '0')
  };
}

export async function shareFolder(primaryAccountId, folderId, email) {
  const drive = await getDrive(primaryAccountId);
  await drive.permissions.create({
    fileId: folderId,
    requestBody: {
      type: 'user',
      role: 'writer',
      emailAddress: email
    },
    sendNotificationEmail: false
  });
}
