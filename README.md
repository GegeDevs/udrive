# UDrive

Unified Google Drive Manager — pool multiple free Google Drive accounts (15GB each) into one seamless storage interface.

## Features

- **Unified File Manager** — Browse, upload, download, create folders, rename, delete, move, copy files across multiple Google Drive accounts
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
- **Responsive Design** — Desktop sidebar collapses to icons; mobile gets bottom navbar
- **Dark/Light/Auto Theme** — Toggle from top bar, persisted in localStorage
- **Account Colors** — Unique color per account card with palette picker
- **Rclone Import/Export** — Import accounts from rclone.conf, export with client_id/secret included

## Tech Stack

- **Backend:** Node.js, Express, better-sqlite3, googleapis, multer
- **Frontend:** Vite, Vanilla JS, TailwindCSS v4
- **Auth:** crypto.scrypt password hashing, session tokens via httpOnly cookies

## Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your Google OAuth credentials

# Development (Express + Vite concurrently)
npm run dev

# Production build
npm run build
npm start
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

Database is persisted in a Docker volume (`udrive-db`). The `.env` file is automatically loaded if present; if not, set environment variables directly in `docker-compose.yaml` under `environment:`.

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
- Session never expires

**Slave:**
- Access controlled per page: Drive, Trash, Accounts, Settings
- Access controlled per action: upload, download, delete, create folder, rename, move, copy, restore, permanent delete, manage accounts, import/export
- Configurable session timeout

## How It Works

- **Primary Account** owns the shared folder and is used for listing/reading files
- **Non-primary Accounts** are used for uploading (quota charged to uploader)
- **Delete** uses the file's owner account (auto-detected via Drive API if not tracked locally)
- **Storage** is tracked per account and displayed as progress bars and donut charts
