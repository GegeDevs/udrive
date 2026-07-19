# UDrive

Unified Google Drive Manager — pool multiple free Google Drive accounts (15GB each) into one seamless storage interface.

## Screenshots

![My Drive](https://github.com/GegeDevs/udrive/blob/main/screenshots/My%20Drive.png?raw=true)

![Accounts](https://github.com/GegeDevs/udrive/blob/main/screenshots/Account.png?raw=true)

## Features

- **Unified File Manager** — Browse, upload, download, create folders, rename, delete, move, and copy files across multiple Google Drive accounts
- **Dual Download Mode** — Download via browser token links or background transfers with progress tracking
- **Transfer Ownership** — Move file ownership between accounts by copying to the target account and deleting the original
- **Transfer Panel** — Unified floating panel for uploads, downloads, and ownership transfers with pause/cancel support
- **Auto Storage Distribution** — Automatically selects an account with available space when uploading
- **Multi-Account Management** — Add accounts via OAuth or import/export rclone config
- **Shared Folder Concept** — One primary account shares a folder with all other accounts; all operations happen inside that shared space
- **File Sharing** — Public file upload/download with expiry, optional password protection, and auto-cleanup
- **Grid/List View** — Toggle between table and card view with lazy-loaded image thumbnails
- **File Preview** — View images, play videos with range request support, and read text files inline
- **Multi-Select** — Ctrl+Click, Shift+Click, or mobile long-press for bulk actions
- **Trash Management** — View and manage trashed files from all accounts
- **Keep-Alive** — Automatic activity generation to help keep Google accounts active
- **Authentication** — Master/Slave role system with granular permissions
- **Activity and System Logs** — Track user actions and system events with filters
- **Responsive Design** — Desktop sidebar and mobile bottom navigation
- **Dark/Light/Auto Theme** — Persisted theme preference
- **Timezone & Time Format** — Configurable timezone and 12/24-hour format
- **Account Colors** — Unique color per account card
- **Database Export/Import** — Migrate data between native or Docker deployments
- **API Access** — Public REST API with key-based auth, per-key permissions, rate limiting, and management UI
- **Docker/Native Deployment** — Runs as a Node.js app with SQLite persistence

## Tech Stack

- **Backend:** Hono on Node.js
- **Database:** SQLite via `better-sqlite3`
- **Frontend:** Vite, Vanilla JS, TailwindCSS v4
- **Auth:** PBKDF2 password hashing with Web Crypto API, session tokens via httpOnly cookies
- **Google API:** Direct REST API via `fetch` without the `googleapis` package
- **Bot Protection:** Optional Cloudflare Turnstile for public file share, plus CSRF tokens and IP-based rate limiting

## Setup

### Prerequisites

- Node.js 20+ recommended
- Google Cloud project with OAuth 2.0 credentials and Google Drive API enabled
- Docker, if using the recommended container deployment
- Optional Cloudflare Turnstile keys for public share captcha protection

### Installation

```bash
git clone https://github.com/GegeDevs/udrive.git
cd udrive
npm install
```

Create `.env`:

```env
PORT=3000
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback

# Optional, only needed when enabling captcha on public file share
TURNSTILE_SITE_KEY=your-site-key
TURNSTILE_SECRET_KEY=your-secret-key
```

If Turnstile keys are not set, file sharing works without captcha verification.

## Development

```bash
npm run dev
```

This starts two servers:

- Vite dev server: `http://localhost:5173`
- Hono backend: `http://localhost:3000`

Use `http://localhost:5173` during development. Vite proxies `/api/`, `/auth/`, `/dlink/`, and `/share/` to the backend.

## Native Production

```bash
npm run build
npm start
```

Production runs on `http://localhost:3000`. The Node server serves the built frontend from `dist/` and stores SQLite data at `data/udrive.db`.

## Docker

```bash
docker compose up -d
docker compose logs -f
```

Docker uses the same Node runtime as native production:

- App port: `3000`
- Runtime command: `node src/local.js`
- Persistent database volume: `udrive-db:/app/data`
- Optional `.env` file is loaded automatically by Compose

Stop the container:

```bash
docker compose down
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port, defaults to `3000` |
| `GOOGLE_CLIENT_ID` | Yes | Google OAuth 2.0 Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes | Google OAuth 2.0 Client Secret |
| `GOOGLE_REDIRECT_URI` | Yes | OAuth callback URL, for example `http://localhost:3000/auth/callback` |
| `TURNSTILE_SITE_KEY` | No | Cloudflare Turnstile site key for public share captcha |
| `TURNSTILE_SECRET_KEY` | No | Cloudflare Turnstile secret key |

## First Run

1. Start the server with `npm run dev` or `npm start` after a production build.
2. Open `http://localhost:5173` in development or `http://localhost:3000` in production.
3. Create your Master account in the setup wizard.
4. Add Google Drive accounts from the Accounts page.
5. Set the first account as Primary.
6. Create or choose a shared folder in the Primary account's Drive.
7. Enter the Shared Folder ID in Settings.
8. UDrive will auto-share this folder with added accounts.

## File Sharing

UDrive includes public upload/download pages that can be used without logging in.

### Setup

1. Go to **File Share > Settings**.
2. Enable file sharing.
3. Set the **Share Folder ID** to a dedicated Google Drive folder.
4. Configure expiry, file size limits, allowed accounts, and rate limits.

### How It Works

- Public users can upload files via `/#/share`.
- Each upload generates a unique share link with configurable expiry.
- Password protection is optional per file.
- Files are distributed to allowed accounts with available space.
- Expired files are cleaned up by the Node scheduler.
- Orphaned files deleted from Drive are cleaned from the database.

### Security

- **Optional Turnstile** — Captcha for public share forms when keys are configured
- **CSRF Token** — One-time token generated per page load
- **Rate Limiting** — Configurable uploads per hour per IP address
- **Real-time Monitoring** — Admins can see new uploads via SSE

## Roles & Permissions

### Master

- Full access to all features
- Create/delete Slave users
- Assign granular permissions per Slave
- Access Activity logs, System logs, User management, API Access, and API Docs
- Session never expires

### Slave

Permissions are grouped by page. A page is hidden if the user has no permission in that group.

- **Drive:** view, upload, download, delete, rename, create folder, move, copy, preview, view uploader, transfer ownership
- **Trash:** view, restore, permanent delete, empty trash
- **Accounts:** view, view email, add, remove, set primary, refresh, import/export, color, clean all
- **Settings:** view, edit, keep-alive, database
- **File Share:** view shares, manage shares, edit share settings
- **Admin:** view users, manage users, edit permissions, view activity, view logs, manage API, view API docs

## API Access

UDrive provides a public REST API under `/api/v1/*`.

Create API keys from the **API Access** page and use them as Bearer tokens:

```bash
curl -H "Authorization: Bearer udrive_your_api_key_here" \
  http://localhost:3000/api/v1/files
```

Available API permissions:

| Permission | Description |
|-----------|-------------|
| `api:files:read` | List and get file metadata |
| `api:files:download` | Download files |
| `api:files:upload` | Upload files |
| `api:files:write` | Create folders, rename, move, copy, delete |
| `api:files:transfer` | Transfer file ownership |
| `api:accounts:read` | List accounts and storage info |

## How It Works

- **Primary Account** owns the shared folder and is used for listing/reading files.
- **Non-primary Accounts** are used for uploads, so quota is charged to the uploader account.
- **Delete** uses the file's owner account, auto-detected via Drive API if not tracked locally.
- **Folder Delete** runs synchronously with safety limits. Very large folders should be deleted in smaller subfolders.
- **Transfer Ownership** copies a file to the target account, deletes the original, and updates local ownership mapping.
- **Storage** is tracked per account and displayed in progress bars and donut charts.
- **File Share** uploads go to the account with most available space from the allowed account list.

## Project Structure

```text
udrive/
├── src/                  # Backend (Hono on Node.js)
│   ├── app.js            # Hono app factory and route mounting
│   ├── local.js          # Node/Docker entrypoint
│   ├── db/               # SQLite DB factory and better-sqlite3 wrapper
│   ├── middleware/        # Auth and API auth middleware
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
│   └── services/         # Business logic and Google Drive integration
├── client/               # Frontend (Vanilla JS SPA)
│   ├── main.js           # App entry, routing, auth flow
│   ├── router.js         # Hash-based router
│   ├── api.js            # Fetch wrapper
│   ├── auth-state.js     # Permission helpers
│   ├── components/       # Reusable UI
│   └── pages/            # Page views
├── data/                 # SQLite database (native, gitignored)
├── dist/                 # Built frontend assets
├── scripts/              # Build metadata scripts
├── Dockerfile
└── docker-compose.yaml
```

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project or select an existing project.
3. Enable the **Google Drive API**.
4. Go to **Credentials** > **Create Credentials** > **OAuth 2.0 Client ID**.
5. Application type: **Web application**.
6. Add authorized redirect URI: `http://localhost:3000/auth/callback` or your production URL.
7. Copy the Client ID and Client Secret to `.env`.

## Optional Turnstile Setup

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/) > **Turnstile**.
2. Add a new site.
3. Choose widget type: **Managed**.
4. Add your domain(s).
5. Copy the Site Key and Secret Key to `.env`.

## License

GPL-3.0
