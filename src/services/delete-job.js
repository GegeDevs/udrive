// Durable Object for long-running delete operations
export class DeleteJob {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/start') {
      const { folderId, accountId, userId, username } = await request.json();

      // Start background delete
      this.state.waitUntil(this.deleteInBackground(folderId, accountId, userId, username));

      return new Response(JSON.stringify({
        jobId: this.state.id.toString(),
        status: 'started'
      }));
    }

    if (url.pathname === '/status') {
      const status = await this.state.storage.get('status');
      return new Response(JSON.stringify(status || { status: 'unknown' }));
    }

    return new Response('Not found', { status: 404 });
  }

  async deleteInBackground(folderId, accountId, userId, username) {
    await this.state.storage.put('status', {
      status: 'scanning',
      progress: 0,
      startedAt: new Date().toISOString()
    });

    try {
      // Scan with no limits
      const scanned = await this.scanUnlimited(folderId, accountId);

      await this.state.storage.put('status', {
        status: 'deleting',
        progress: 0,
        totalFiles: scanned.files.length,
        totalFolders: scanned.folders.length
      });

      // Delete in batches
      let deletedFiles = 0;
      let deletedFolders = 0;
      const errors = [];

      // Delete files in batches of 50
      for (let i = 0; i < scanned.files.length; i += 50) {
        const batch = scanned.files.slice(i, i + 50);
        for (const file of batch) {
          try {
            await this.deleteOne(file.id, file.accountId);
            deletedFiles++;
          } catch (err) {
            errors.push({ id: file.id, error: err.message });
          }
        }

        await this.state.storage.put('status', {
          status: 'deleting',
          progress: Math.round((deletedFiles / scanned.files.length) * 50),
          deletedFiles,
          deletedFolders
        });
      }

      // Delete folders
      for (const folder of scanned.folders) {
        try {
          await this.deleteOne(folder.id, folder.accountId);
          deletedFolders++;
        } catch (err) {
          errors.push({ id: folder.id, error: err.message });
        }
      }

      // Delete root
      try {
        await this.deleteOne(folderId, accountId);
        deletedFolders++;
      } catch (err) {
        errors.push({ id: folderId, error: err.message });
      }

      await this.state.storage.put('status', {
        status: 'completed',
        progress: 100,
        deletedFiles,
        deletedFolders,
        failed: errors.length,
        errors: errors.slice(0, 10),
        completedAt: new Date().toISOString()
      });

    } catch (err) {
      await this.state.storage.put('status', {
        status: 'failed',
        error: err.message,
        failedAt: new Date().toISOString()
      });
    }
  }

  async scanUnlimited(folderId, accountId, depth = 0) {
    // Similar to scanFolderTree but without limits
    // Implementation details...
    return { files: [], folders: [] };
  }

  async deleteOne(fileId, accountId) {
    // Delete via Drive API
    // Implementation details...
  }
}
