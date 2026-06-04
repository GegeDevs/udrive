# Cloudflare Queue Setup untuk Background Folder Delete

## Problem
Cloudflare Workers memiliki limit 50 subrequest per invokasi. Folder besar (>20 items) tidak bisa dihapus dalam satu request karena setiap file delete butuh 2-3 subrequest (token refresh, Drive API call, DB update).

## Solution
Gunakan Cloudflare Queue untuk process folder delete di background tanpa subrequest limit.

## Setup Steps

### 1. Buat Queue di Cloudflare Dashboard

1. Login ke Cloudflare Dashboard
2. Pilih Workers & Pages
3. Klik "Queues" tab
4. Klik "Create Queue"
5. Nama: `udrive-delete-queue`
6. Settings:
   - Max Retries: `3`
   - Max Batch Size: `1` (process satu folder per batch)
   - Max Batch Timeout: `30` seconds
   - Message Retention: `4` days

### 2. Update wrangler.toml

Tambahkan queue binding dan consumer:

```toml
name = "udrive"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[[d1_databases]]
binding = "DB"
database_name = "udrive"
database_id = "your-database-id"

# Queue Producer Binding
[[queues.producers]]
queue = "udrive-delete-queue"
binding = "DELETE_QUEUE"

# Queue Consumer
[[queues.consumers]]
queue = "udrive-delete-queue"
max_batch_size = 1
max_batch_timeout = 30
max_retries = 3
dead_letter_queue = "udrive-delete-dlq"
```

### 3. Deploy Queue Consumer

Deploy queue consumer sebagai separate worker:

```bash
# Deploy consumer
wrangler deploy src/queue-consumer.js --name udrive-queue-consumer
```

Atau tambahkan ke wrangler.toml:

```toml
[[workers]]
name = "udrive-queue-consumer"
main = "src/queue-consumer.js"
compatibility_date = "2024-01-01"

[[workers.queues.consumers]]
queue = "udrive-delete-queue"
max_batch_size = 1
max_batch_timeout = 30
```

### 4. Deploy Main Worker

```bash
npm run build
wrangler pages deploy dist
```

## How It Works

### Small Folders (≤20 items)
1. User click delete
2. Backend scan folder (fast)
3. Delete immediately
4. Return success

### Large Folders (>20 items)
1. User click delete
2. Backend detect folder too large
3. Enqueue job ke `DELETE_QUEUE`
4. Return immediately: "Folder deletion queued for background processing"
5. Queue consumer process job:
   - Scan entire folder tree (no limit)
   - Delete files in batches of 10
   - Delete folders deepest-first
   - Log activity when complete

### User Experience
- **Immediate feedback**: User dapat langsung close browser
- **Background processing**: Deletion jalan otomatis di background
- **Activity log**: Hasilnya masuk activity log dengan status `delete_async`
- **No manual work**: User tidak perlu delete subfolder satu per satu

## Monitoring

### Check Queue Status
```bash
wrangler queues list
wrangler queues consumer udrive-delete-queue
```

### View Logs
```bash
# Main worker logs
wrangler pages deployment tail

# Queue consumer logs  
wrangler tail udrive-queue-consumer
```

### Check Dead Letter Queue
Jika job gagal 3x retry, akan masuk Dead Letter Queue:

```bash
wrangler queues consumer udrive-delete-dlq
```

## Cost Estimation

Cloudflare Queues pricing (as of 2024):
- **Free tier**: 1 million operations/month
- **Paid**: $0.40 per million operations

1 folder delete = ~1 queue operation
→ Free tier = 1 juta folder delete/bulan (lebih dari cukup!)

## Fallback Behavior

Jika `DELETE_QUEUE` tidak tersedia (local dev, older Cloudflare account):
- Backend akan return subfolder guidance
- User harus delete subfolder manual
- Sama seperti sebelumnya

## Local Development

Queue tidak tersedia di local dev (`npm run dev`). Untuk testing:

1. Deploy ke Cloudflare Pages
2. Atau mock queue di local:

```javascript
// src/local.js
const mockQueue = {
  async send(message) {
    console.log('Mock queue: enqueued', message);
    // Immediately process (simulate)
    await processDeleteJob(env, db, message);
  }
};

app.use('*', async (c, next) => {
  c.env.DELETE_QUEUE = mockQueue;
  await next();
});
```

## Migration

Existing users:
1. Deploy dengan queue consumer
2. Queue binding otomatis available
3. Folder besar (>20 items) otomatis ke queue
4. Folder kecil tetap instant delete

No breaking changes!
