import { Router } from 'express';
import multer from 'multer';
import { Readable } from 'stream';
import db from '../db/init.js';
import { selectAccount } from '../services/account-selector.js';
import { requirePermission } from '../middleware/auth.js';
import * as driveService from '../services/google-drive.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

function getSharedFolderId() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'shared_folder_id'").get();
  return row?.value || null;
}

function getPrimaryAccountId() {
  const row = db.prepare('SELECT id FROM accounts WHERE is_primary = 1').get();
  return row?.id || null;
}

router.get('/', async (req, res, next) => {
  try {
    const folderId = req.query.folderId || getSharedFolderId();
    if (!folderId) return res.status(400).json({ error: 'No shared folder configured' });

    const accountId = getPrimaryAccountId();
    if (!accountId) return res.status(400).json({ error: 'No primary account set' });

    const files = await driveService.listFiles(accountId, folderId);
    res.json(files);
  } catch (err) {
    next(err);
  }
});

router.get('/trash/list', async (req, res, next) => {
  try {
    const accounts = db.prepare('SELECT id, email, display_name FROM accounts').all();
    const allTrash = [];

    for (const acc of accounts) {
      try {
        const files = await driveService.listTrash(acc.id);
        for (const file of files) {
          allTrash.push({ ...file, ownerEmail: acc.email, ownerName: acc.display_name, accountId: acc.id });
        }
      } catch (e) {}
    }

    allTrash.sort((a, b) => new Date(b.trashedTime || 0) - new Date(a.trashedTime || 0));
    res.json(allTrash);
  } catch (err) {
    next(err);
  }
});

router.post('/upload', requirePermission('action:upload'), upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });

    const folderId = req.body.folderId || getSharedFolderId();
    if (!folderId) return res.status(400).json({ error: 'No shared folder configured' });

    const account = selectAccount(req.file.size);
    if (!account) return res.status(507).json({ error: 'Insufficient storage across all accounts' });

    const stream = Readable.from(req.file.buffer);
    const result = await driveService.uploadFile(account.id, folderId, stream, req.file);

    db.prepare('UPDATE accounts SET storage_used = storage_used + ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(req.file.size, account.id);

    db.prepare('INSERT OR REPLACE INTO file_owners (file_id, account_id) VALUES (?, ?)')
      .run(result.id, account.id);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/:fileId/info', async (req, res, next) => {
  try {
    const { fileId } = req.params;
    const primaryId = getPrimaryAccountId();
    if (!primaryId) return res.status(400).json({ error: 'No primary account set' });

    const fileInfo = await driveService.getFileInfo(primaryId, fileId);

    let uploaderEmail = null;
    let uploaderName = null;

    const owner = db.prepare('SELECT account_id FROM file_owners WHERE file_id = ?').get(fileId);
    if (owner) {
      const acc = db.prepare('SELECT email, display_name FROM accounts WHERE id = ?').get(owner.account_id);
      if (acc) {
        uploaderEmail = acc.email;
        uploaderName = acc.display_name;
      }
    } else {
      const ownerEmail = await driveService.getFileOwnerEmail(primaryId, fileId);
      if (ownerEmail) {
        uploaderEmail = ownerEmail;
        const acc = db.prepare('SELECT display_name FROM accounts WHERE email = ?').get(ownerEmail);
        if (acc) uploaderName = acc.display_name;
      }
    }

    res.json({ ...fileInfo, uploaderEmail, uploaderName });
  } catch (err) {
    next(err);
  }
});

router.get('/:fileId/download', requirePermission('action:download'), async (req, res, next) => {
  try {
    const accountId = getPrimaryAccountId();
    if (!accountId) return res.status(400).json({ error: 'No primary account set' });

    const { metadata, stream } = await driveService.downloadFile(accountId, req.params.fileId);
    res.setHeader('Content-Type', metadata.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(metadata.name)}"`);
    if (metadata.size) res.setHeader('Content-Length', metadata.size);
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

router.get('/:fileId/thumbnail', async (req, res, next) => {
  try {
    const accountId = getPrimaryAccountId();
    if (!accountId) return res.status(400).json({ error: 'No primary account set' });

    const size = parseInt(req.query.size) || 200;
    const result = await driveService.getThumbnail(accountId, req.params.fileId, size);

    if (!result) return res.status(404).json({ error: 'No thumbnail available' });

    res.setHeader('Content-Type', result.contentType || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    if (result.contentLength) res.setHeader('Content-Length', result.contentLength);

    const { Readable } = await import('stream');
    const nodeStream = Readable.fromWeb(result.stream);
    nodeStream.pipe(res);
  } catch (err) {
    next(err);
  }
});

router.get('/:fileId/preview', async (req, res, next) => {
  try {
    const accountId = getPrimaryAccountId();
    if (!accountId) return res.status(400).json({ error: 'No primary account set' });

    const rangeHeader = req.headers.range;

    if (rangeHeader) {
      const { metadata, stream, headers } = await driveService.downloadFileRange(accountId, req.params.fileId, rangeHeader);
      const totalSize = parseInt(metadata.size);
      const parts = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0]);
      const end = parts[1] ? parseInt(parts[1]) : totalSize - 1;
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader('Content-Type', metadata.mimeType || 'application/octet-stream');
      res.setHeader('Content-Range', `bytes ${start}-${end}/${totalSize}`);
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Length', chunkSize);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(metadata.name)}"`);
      stream.pipe(res);
    } else {
      const { metadata, stream } = await driveService.downloadFile(accountId, req.params.fileId);
      res.setHeader('Content-Type', metadata.mimeType || 'application/octet-stream');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(metadata.name)}"`);
      res.setHeader('Accept-Ranges', 'bytes');
      if (metadata.size) res.setHeader('Content-Length', metadata.size);
      stream.pipe(res);
    }
  } catch (err) {
    next(err);
  }
});

router.post('/folder', requirePermission('action:create_folder'), async (req, res, next) => {
  try {
    const { name, parentId } = req.body;
    const folderId = parentId || getSharedFolderId();
    if (!folderId) return res.status(400).json({ error: 'No shared folder configured' });

    const accountId = getPrimaryAccountId();
    if (!accountId) return res.status(400).json({ error: 'No primary account set' });

    const result = await driveService.createFolder(accountId, folderId, name);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.patch('/:fileId', requirePermission('action:rename'), async (req, res, next) => {
  try {
    const { name } = req.body;
    const accountId = getPrimaryAccountId();
    if (!accountId) return res.status(400).json({ error: 'No primary account set' });

    const result = await driveService.renameFile(accountId, req.params.fileId, name);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.delete('/:fileId', requirePermission('action:delete'), async (req, res, next) => {
  try {
    const { fileId } = req.params;

    let accountId;
    const owner = db.prepare('SELECT account_id FROM file_owners WHERE file_id = ?').get(fileId);

    if (owner) {
      accountId = owner.account_id;
    } else {
      const primaryId = getPrimaryAccountId();
      if (!primaryId) return res.status(400).json({ error: 'No primary account set' });

      const ownerEmail = await driveService.getFileOwnerEmail(primaryId, fileId);
      if (ownerEmail) {
        const matchedAccount = db.prepare('SELECT id FROM accounts WHERE email = ?').get(ownerEmail);
        if (matchedAccount) {
          accountId = matchedAccount.id;
          db.prepare('INSERT OR REPLACE INTO file_owners (file_id, account_id) VALUES (?, ?)').run(fileId, accountId);
        }
      }

      if (!accountId) accountId = primaryId;
    }

    await driveService.deleteFile(accountId, fileId);
    db.prepare('DELETE FROM file_owners WHERE file_id = ?').run(fileId);

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:fileId/move', requirePermission('action:move'), async (req, res, next) => {
  try {
    const { newParentId, oldParentId } = req.body;
    const accountId = getPrimaryAccountId();
    if (!accountId) return res.status(400).json({ error: 'No primary account set' });

    const result = await driveService.moveFile(accountId, req.params.fileId, newParentId, oldParentId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/:fileId/copy', requirePermission('action:copy'), async (req, res, next) => {
  try {
    const { destinationId } = req.body;
    const accountId = getPrimaryAccountId();
    if (!accountId) return res.status(400).json({ error: 'No primary account set' });

    const result = await driveService.copyFile(accountId, req.params.fileId, destinationId);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/:fileId/restore', requirePermission('action:restore'), async (req, res, next) => {
  try {
    const { fileId } = req.params;
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ error: 'No accountId provided' });

    await driveService.restoreFile(accountId, fileId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/:fileId/permanent-delete', requirePermission('action:permanent_delete'), async (req, res, next) => {
  try {
    const { fileId } = req.params;
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ error: 'No accountId provided' });

    await driveService.permanentDeleteFile(accountId, fileId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
