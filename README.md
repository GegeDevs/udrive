# UDrive

Unified Google Drive Manager — pool multiple free Google Drive accounts (15GB each) into one seamless storage interface.

## Screenshots

![enter image description here](https://github.com/GegeDevs/udrive/blob/main/screenshots/My%20Drive.png?raw=true)

![enter image description here](https://github.com/GegeDevs/udrive/blob/main/screenshots/Account.png?raw=true)

## Features

- **Unified File Manager** — Browse, upload, download, create folders, rename, delete, move, copy files across multiple Google Drive accounts
- **Dual Download Mode** — Download via Browser (Download Manager with expiry link) or Background (floating progress panel)
- **Auto Storage Distribution** — Automatically selects the account with most available space when uploading
- **Multi-Account Management** — Add accounts via OAuth or import from rclone config, export to rclone format
- **Shared Folder Concept** — One primary account shares a folder with all others; all operations happen within this shared space
- **Grid/List View** — Toggle between table and card view with lazy-loaded image thumbnails
- **File Preview** — View images, play videos (with range request support), and read text files inline
- **Multi-Select & Bulk Actions** — Select multiple files for bulk delete, download, copy, cut/paste
- **Trash Management** — View and manage trashed files from all accounts, restore or permanently delete
- **Upload Queue** — Floating panel showing upload progress with per-file status
- **Keep-Alive** — Automatic activity generation to prevent Google from deleting inactive accounts
- **Authentication** — Master/Slave role system with granular per-page and per-action permissions
- **Activity Log** — Track user actions (upload, download, delete, etc.) with filters
- **System Logs** — Track system events (token refresh, keep-alive, errors) with level filters
- **Responsive Design** — Desktop sidebar collapses to icons; mobile gets bottom navbar
- **Dark/Light/Auto Theme** — Toggle from top bar, persisted in localStorage
- **Timezone Setting** — Configurable timezone for log timestamps
- **Account Colors** — Unique color per account card with palette picker
- **Rclone Import/Export** — Import accounts from rclone.conf, export with client_id/secret included
- **Database Download/Upload** — Migrate data between deployments with selective table export
- **Dual Deploy** — Single codebase deploys to Docker/VPS or Cloudflare Pages

## Tech Stack

- **Backend:** Hono (runs on Node.js and Cloudflare Workers)
- **Database:** better-sqlite3 (local/Docker) / Cloudflare D1 (CF Pages)
- **Frontend:** Vite, Vanilla JS, TailwindCSS v4
- **Auth:** crypto.scrypt password hashing, session tokens via httpOnly cookies
- **Google API:** Direct REST API via fetch (no googleapis dependency at runtime)

## Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Google OAuth credentials

# Development (Hono + Vite with hot reload)
npm run dev
# Open http://localhost:5173

# Production build
npm run build

# Production start (local/Docker)
npm start
# Open http://localhost:3000
```

## Docker

```bash
# Create .env with your credentials
cat > .env << EOF
PORT=3000
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
EOF

# Build and run
docker compose up -d

# View logs
docker compose logs -f

# Stop
docker compose down
```

Database is persisted in a Docker volume (`udrive-db`) at `/app/data/`. The `.env` file is automatically loaded if present.

## Cloudflare Pages

```bash
# Build (generates dist/ with _worker.js)
npm run build

# Upload dist/ folder to CF Pages dashboard
# Or deploy via wrangler:
# wrangler pages deploy dist

# Set in CF Pages dashboard:
# - D1 binding: DB
# - Environment variables: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
# - Compatibility flags: nodejs_compat
# - Run D1 migration: wrangler d1 execute <db-name> --remote --file=./migrations/0001_init.sql
```

## Environment Variables

```
PORT=3000
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
```

## First Run

1. Start the server with `npm run dev`
2. Open `http://localhost:5173` (dev) or `http://localhost:3000` (production)
3. Create your Master account in the setup wizard
4. Add Google Drive accounts via Accounts page
5. Set the first account as Primary
6. Create/choose a shared folder in the Primary account's Drive
7. Enter the Shared Folder ID in Settings
8. All added accounts will be auto-shared access to this folder

## Roles & Permissions

**Master:**
- Full access to all features
- Create/delete Slave users
- Assign granular permissions per Slave
- Access to Activity logs and System logs
- Session never expires

**Slave:**
- Permissions grouped per page (Drive, Trash, Accounts, Settings)
- Page hidden if no permissions in that group
- Granular actions per page:
  - **Drive:** view files, upload, download (browser), download (background), delete, rename, create folder, move, copy, preview, view uploader
  - **Trash:** view, restore, permanent delete, empty trash
  - **Accounts:** view, view email, add, remove, set primary, refresh, import/export, color
  - **Settings:** view, edit, keep-alive, database
- Configurable session timeout

## How It Works

- **Primary Account** owns the shared folder and is used for listing/reading files
- **Non-primary Accounts** are used for uploading (quota charged to uploader)
- **Delete** uses the file's owner account (auto-detected via Drive API if not tracked locally)
- **Storage** is tracked per account and displayed as progress bars and donut charts

## Project Structure

```
udrive/
├── src/                  # Backend (Hono, shared between local and CF)
│   ├── app.js            # Hono app factory
│   ├── local.js          # Entry: Node.js (dev/Docker)
│   ├── cf.js             # Entry: Cloudflare Pages
│   ├── db/               # DB abstraction layer
│   ├── middleware/        # Auth middleware
│   ├── routes/           # API routes
│   └── services/         # Business logic (Google Drive, auth, etc.)
├── client/               # Frontend (Vanilla JS SPA)
├── data/                 # SQLite database (local, gitignored)
├── dist/                 # Build output (frontend + _worker.js)
├── migrations/           # D1 SQL migrations
├── scripts/              # Build scripts
├── Dockerfile
└── docker-compose.yaml
```
