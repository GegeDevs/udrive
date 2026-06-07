# Queue Consumer Deployment Guide

## Problem
Queue consumer hitting "Too many subrequests" limit when processing folders with many files.

## Solution
Changed from parallel batch processing to sequential (one-by-one) processing to stay under the 50 subrequest limit.

## Deploy Steps

### Option 1: Deploy from Local Machine (if wrangler works)

```bash
cd ~/Documents/NodeJS/udrive
npm run build:queue
npx wrangler deploy --config wrangler-consumer.toml
```

### Option 2: Deploy via Cloudflare Dashboard

1. Build the worker bundle:
   ```bash
   npm run build:queue
   ```

2. Open Cloudflare Dashboard:
   - Go to Workers & Pages
   - Find "udrive-queue-consumer"
   - Click "Quick edit" or "Edit code"

3. Upload the bundle:
   - Copy content from `dist/queue-consumer-worker.js`
   - Paste into the editor
   - Click "Save and Deploy"

### Option 3: Deploy via GitHub Actions

Add this to `.github/workflows/deploy-queue-consumer.yml`:

```yaml
name: Deploy Queue Consumer

on:
  push:
    paths:
      - 'src/queue-consumer.js'
      - 'wrangler-consumer.toml'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build:queue
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          command: deploy --config wrangler-consumer.toml
```

## Changes Made

### Before (Parallel Batch - Hitting Limit)
```javascript
// Delete files in batches of 5
for (let i = 0; i < scanned.files.length; i += 5) {
  const batch = scanned.files.slice(i, i + 5);
  await Promise.allSettled(batch.map(async (file) => {
    await deleteOneFile(env, db, file.id, file.accountId);
  }));
}
```

### After (Sequential - Safe)
```javascript
// Delete files one by one (sequential to avoid subrequest limit)
for (let i = 0; i < scanned.files.length; i++) {
  const file = scanned.files[i];
  try {
    await deleteOneFile(env, db, file.id, file.accountId);
    deletedFiles++;
  } catch (err) {
    console.error(`Queue: Failed to delete file ${file.id} (${file.name}):`, err.message);
    errors.push({ id: file.id, name: file.name, error: err.message });
  }
}
```

## Verification

After deployment, check Cloudflare logs:
- `scriptVersion` should change (current: `6c27777a-538a-4567-83ec-9a82e02598fa`)
- No more "Too many subrequests" errors
- All files deleted successfully (not just 20)

## Trade-offs

- **Slower**: Sequential processing takes longer than parallel
- **Safer**: Stays well under 50 subrequest limit
- **More reliable**: Completes full folder deletion without errors
