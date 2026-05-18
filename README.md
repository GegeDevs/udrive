# UDrive

Unified Google Drive Manager — pool multiple free Google Drive accounts (15GB each) into one seamless storage interface.

## Screenshots

![enter image description here](https://github.com/GegeDevs/udrive/blob/main/screenshots/My%20Drive.png?raw=true)

![enter image description here](https://github.com/GegeDevs/udrive/blob/main/screenshots/Account.png?raw=true)

## Features

- **Unified File Manager** — Browse, upload, download, create folders, rename, delete, move, copy files across multiple Google Drive accounts
- **Dual Download Mode** — Download via Browser (Download Manager with expiry link) or Background (floating progress panel)
- **Transfer Ownership** — Move file ownership between accounts (copy + delete) with storage validation
- **Transfer Panel** — Unified floating panel for uploads, downloads, and ownership transfers with pause/cancel support
- **Auto Storage Distribution** — Automatically selects the account with most available space when uploading
- **Multi-Account Management** — Add accounts via OAuth or import from rclone config, export to rclone format
- **Shared Folder Concept** — One primary account shares a folder with all others; all operations happen within this shared space
- **File Sharing** — Public file upload/download with expiry, optional password protection, and auto-cleanup
- **Grid/List View** — Toggle between table and card view with lazy-loaded image thumbnails
- **File Preview** — View images, play videos (with range request support), and read text files inline
- **Multi-Select** — Ctrl+Click, Shift+Click (desktop) or long-press (mobile) for bulk actions
- **Trash Management** — View and manage trashed files from all accounts, restore or permanently delete
- **Keep-Alive** — Automatic activity generation to prevent Google from deleting inactive accounts
- **Authentication** — Master/Slave role system with granular per-page and per-action permissions
- **Activity Log** — Track user actions (upload, download, delete, etc.) with filters
- **System Logs** — Track system events (token refresh, keep-alive, errors) with level filters
- **Responsive Design** — Desktop sidebar collapses to icons with vertical scroll; mobile gets horizontal-scrolling bottom navbar
- **Dark/Light/Auto Theme** — Toggle from top bar, persisted in localStorage
- **Timezone & Time Format** — Configurable timezone and 12/24-hour format
- **Account Colors** — Unique color per account card with palette picker
- **Rclone Import/Export** — Import accounts from rclone.conf, export with client_id/secret included
- **Database Download/Upload** — Migrate data between deployments with selective table export
- **API Access** — Public REST API with key-based auth, per-key permissions, rate limiting, and management UI
- **Dual Deploy** — Single codebase deploys to Docker/VPS or Cloudflare Pages

## Tech Stack

- **Backend:** Hono (runs on Node.js and Cloudflare Workers)
- **Database:** better-sqlite3 (local/Docker) / Cloudflare D1 (CF Pages)
- **Frontend:** Vite, Vanilla JS, TailwindCSS v4
- **Auth:** PBKDF2 password hashing (Web Crypto API), session tokens via httpOnly cookies
- **Google API:** Direct REST API via fetch (no googleapis dependency at runtime)
- **Bot Protection:** Cloudflare Turnstile, CSRF tokens, IP-based rate limiting

## Setup

### Prerequisites

- Node.js 18+
- Google Cloud project with OAuth 2.0 credentials (Drive API enabled)
- (Optional) Cloudflare account for Turnstile and CF Pages deployment

### Installation

```bash
# Clone the repository
git clone https://github.com/GegeDevs/udrive.git
cd udrive

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your credentials (see Environment Variables below)
```

### Development

```bash
npm run dev
# Opens two servers:
#   - Vite dev server: http://localhost:5173 (with hot reload)
#   - Hono backend: http://localhost:3000
# Access via localhost:5173 — Vite proxies API calls to :3000
```

### Production

```bash
npm run build   # Build frontend to dist/ + bundle _worker.js
npm start       # Start Hono server on port 3000, serves dist/
```

## Docker

```bash
# Create .env with your credentials
cat > .env << EOF
PORT=3000
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
TURNSTILE_SITE_KEY=your-site-key
TURNSTILE_SECRET_KEY=your-secret-key
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

# Set in CF Pages dashboard:
# - D1 binding: DB
# - Environment variables:
#     GOOGLE_CLIENT_ID
#     GOOGLE_CLIENT_SECRET
#     GOOGLE_REDIRECT_URI
#     TURNSTILE_SITE_KEY
#     TURNSTILE_SECRET_KEY
# - Compatibility flags: nodejs_compat
# Schema auto-migrates on first request.
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | Yes | OAuth callback URL (e.g., `http://localhost:3000/auth/callback`) |
| `TURNSTILE_SITE_KEY` | No | Cloudflare Turnstile site key (for bot protection on file share) |
| `TURNSTILE_SECRET_KEY` | No | Cloudflare Turnstile secret key |

If Turnstile keys are not set, file sharing works without captcha verification (suitable for development).

Example `.env`:

```env
PORT=3000
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
TURNSTILE_SITE_KEY=your-site-key
TURNSTILE_SECRET_KEY=your-secret-key
```

## First Run

1. Start the server with `npm run dev`
2. Open `http://localhost:5173` (dev) or `http://localhost:3000` (production)
3. Create your Master account in the setup wizard
4. Add Google Drive accounts via the Accounts page
5. Set the first account as Primary
6. Create/choose a shared folder in the Primary account's Drive
7. Enter the Shared Folder ID in Settings
8. All added accounts will be auto-shared access to this folder

## File Sharing

UDrive includes a public file sharing feature that allows anyone to upload files without logging in.

### Setup

1. Go to **File Share > Settings**
2. Enable file sharing
3. Set the **Share Folder ID** (a dedicated folder in Google Drive for shared files)
4. Configure expiry, file size limits, and rate limits as needed

### How It Works

- Public users can upload files via the homepage or `/#/share`
- Each upload generates a unique share link with configurable expiry
- Optional password protection per file
- Files are automatically distributed to accounts with available space
- Expired files are automatically cleaned up on a configurable interval
- Orphaned files (deleted from Drive) are also cleaned from the database

### Security

- **Cloudflare Turnstile** — Invisible captcha to verify human users
- **CSRF Token** — One-time token generated per page load, prevents direct API abuse
- **Rate Limiting** — Configurable uploads per hour per IP address (default: 10)
- **Real-time Monitoring** — Admin can see new uploads in real-time via SSE (Active Shares tab)

## Roles & Permissions

### Master

- Full access to all features
- Create/delete Slave users
- Assign granular permissions per Slave (collapsible groups per page)
- Access to Activity logs, System logs, and User management
- Session never expires

### Slave

- Permissions grouped per page (Drive, Trash, Accounts, Settings, File Share, Admin)
- Page hidden if no permissions in that group
- Granular actions per page:
  - **Drive:** view files, upload, download (browser), download (background), delete, rename, create folder, move, copy, preview, view uploader, transfer ownership
  - **Trash:** view, restore, permanent delete, empty trash
  - **Accounts:** view, view email, add, remove, set primary, refresh, import/export, color
  - **Settings:** view, edit, keep-alive, database
  - **File Share:** view shares, manage (delete/cleanup), settings, accounts
  - **Admin:** view activity, view logs, manage users, manage API, view API docs
- Configurable session timeout

## API Access

UDrive provides a public REST API at `/api/v1/*` for programmatic access.

### Setup

1. Go to **API Access** page
2. Create an API key with desired permissions
3. Use the key as Bearer token in requests

### Authentication

```bash
curl -H "Authorization: Bearer udrive_your_api_key_here" \
  http://localhost:3000/api/v1/files
```

### Available Permissions

| Permission | Description |
|-----------|-------------|
| `api:files:read` | List and get file metadata |
| `api:files:download` | Download files |
| `api:files:upload` | Upload files |
| `api:files:write` | Create folders, rename, move, copy, delete |
| `api:files:transfer` | Transfer file ownership |
| `api:accounts:read` | List accounts and storage info |

### Rate Limiting

Each API key has a configurable rate limit (requests per minute). Default: 60/min.

## How It Works

- **Primary Account** owns the shared folder and is used for listing/reading files
- **Non-primary Accounts** are used for uploading (quota charged to uploader)
- **Delete** uses the file's owner account (auto-detected via Drive API if not tracked locally)
- **Transfer Ownership** copies file to target account, deletes original, moves to correct folder
- **Storage** is tracked per account and displayed as progress bars and donut charts
- **File Share** uploads go to the account with most available space (from allowed accounts list)

## Project Structure

```
udrive/
├── src/                  # Backend (Hono, shared between local and CF)
│   ├── app.js            # Hono app factory
│   ├── local.js          # Entry: Node.js (dev/Docker)
│   ├── cf.js             # Entry: Cloudflare Pages
│   ├── db/               # DB abstraction layer
│   ├── middleware/        # Auth, API auth middleware
│   ├── routes/           # API routes
│   │   ├── auth.js       # OAuth flow
│   │   ├── files.js      # File CRUD
│   │   ├── accounts.js   # Account management
│   │   ├── settings.js   # App settings
│   │   ├── users.js      # User management
│   │   ├── share.js      # File sharing (public + admin)
│   │   ├── activity.js   # Activity logs
│   │   ├── logs.js       # System logs
│   │   ├── api-keys.js   # API key management
│   │   └── api-v1.js     # Public API endpoints
│   └── services/         # Business logic
│       ├── google-drive.js     # Drive API operations
│       ├── token-manager.js    # OAuth token refresh
│       ├── account-selector.js # Storage distribution
│       ├── password.js         # PBKDF2 hashing
│       ├── keep-alive.js       # Account activity
│       ├── share-cleanup.js    # Expired share removal
│       ├── share-events.js     # SSE broadcaster
│       └── logger.js           # Activity/system logging
├── client/               # Frontend (Vanilla JS SPA)
│   ├── main.js           # App entry, routing, auth flow
│   ├── router.js         # Hash-based router
│   ├── api.js            # Fetch wrapper
│   ├── auth-state.js     # Permission helpers
│   ├── theme.js          # Dark/light mode
│   ├── time-utils.js     # Date/time formatting
│   ├── components/       # Reusable UI
│   │   ├── sidebar.js    # Navigation sidebar
│   │   ├── transfer-panel.js  # Upload/download panel
│   │   ├── storage-bar.js     # Storage progress bar
│   │   ├── context-menu.js    # Right-click menu
│   │   ├── breadcrumb.js      # Folder navigation
│   │   ├── toast.js           # Notifications
│   │   └── logout-modal.js    # Logout confirmation
│   ├── pages/            # Page views
│   │   ├── files.js      # File manager
│   │   ├── accounts.js   # Account cards
│   │   ├── settings.js   # App settings
│   │   ├── trash.js      # Trash management
│   │   ├── users.js      # User management
│   │   ├── activity.js   # Activity log viewer
│   │   ├── logs.js       # System log viewer
│   │   ├── transfer.js   # Transfer list
│   │   ├── file-share.js # File share admin
│   │   ├── share-public.js   # Public share page
│   │   ├── api-access.js # API key management
│   │   ├── api-docs.js   # API documentation
│   │   ├── login.js      # Login + quick share
│   │   └── setup.js      # First-run wizard
│   └── public/           # Static assets
│       └── favicon.svg   # App icon
├── data/                 # SQLite database (local, gitignored)
├── dist/                 # Build output (frontend + _worker.js)
├── migrations/           # D1 SQL migrations
├── scripts/              # Build scripts
├── Dockerfile
└── docker-compose.yaml
```

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable the **Google Drive API**
4. Go to **Credentials** > **Create Credentials** > **OAuth 2.0 Client ID**
5. Application type: **Web application**
6. Add authorized redirect URI: `http://localhost:3000/auth/callback` (or your production URL)
7. Copy the Client ID and Client Secret to your `.env` file

## Cloudflare Turnstile Setup

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) > **Turnstile**
2. Add a new site
3. Choose widget type: **Managed** (invisible when possible)
4. Add your domain(s)
5. Copy the Site Key and Secret Key to your `.env` file

## License

GPL-3.0
