# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UDrive is a unified Google Drive manager that pools multiple free Google Drive accounts (15GB each) into one seamless storage interface. It uses a shared folder concept where one primary account shares a folder with all other accounts, and uploads are automatically distributed to accounts with available space.

The project now supports Docker and native Node.js only. Hosted edge runtimes and external queue services are intentionally not supported.

## Commands

```bash
npm run dev      # Hono server (port 3000) + Vite dev server (port 5173, hot reload)
npm run build    # Build frontend to dist/
npm start        # Production server (Hono on Node.js, serves dist/)
```

Development: access via `localhost:5173` (Vite proxies /api/, /auth/, /dlink/, and /share/ to :3000).
Production: access via `localhost:3000`.

## Architecture

**Backend** (`src/`): Hono framework on Node.js.

- `src/app.js` — Hono app factory, accepts DB getter and env vars, mounts all routes
- `src/local.js` — Node.js entry point for native/Docker, uses @hono/node-server + better-sqlite3, serves `dist/`, runs keep-alive and share cleanup schedulers
- `src/db/index.js` — SQLite DB factory + initDB (creates tables, runs migrations, migrates old permissions)
- `src/db/local.js` — better-sqlite3 wrapper with async prepare/bind/first/all/run API
- `src/middleware/auth.js` — Session auth: authenticate, requireAuth, requireMaster, requirePermission, hasPageAccess, createSession, deleteSession. Exports ALL_PERMISSIONS and PERMISSION_GROUPS
- `src/middleware/api-auth.js` — API key auth: authenticateApiKey, checkRateLimit, requireApiPermission, generateApiKey
- `src/services/google-drive.js` — All Drive operations via direct REST fetch (no googleapis package)
- `src/services/token-manager.js` — OAuth2 token refresh via fetch
- `src/services/password.js` — PBKDF2 password hashing (Web Crypto API)
- `src/services/account-selector.js` — Picks non-primary account with most available space
- `src/services/keep-alive.js` — Upload+delete temp file per account to maintain activity
- `src/services/share-cleanup.js` — Expired share cleanup
- `src/services/logger.js` — logActivity() and logSystem() with enable/disable check from settings
- `src/routes/auth.js` — Google OAuth2 flow + callback, auto-shares folder, assigns card colors
- `src/routes/files.js` — File CRUD with per-action permission checks, trash/restore, thumbnail proxy, video range requests, transfer ownership, download tokens
- `src/routes/accounts.js` — Account management, card colors, rclone import/export
- `src/routes/settings.js` — Key-value settings, keep-alive trigger, database export/import
- `src/routes/users.js` — User CRUD, login/logout, permissions, session timeout, password change
- `src/routes/activity.js` — Activity log listing with filters
- `src/routes/logs.js` — System log listing with filters
- `src/routes/share.js` — Public file share routes and admin share management
- `src/routes/api-keys.js` — API key management (CRUD, settings)
- `src/routes/api-v1.js` — Public API endpoints (auth via API key, rate limited)

**Frontend** (`client/`): Vanilla JS SPA built with Vite + TailwindCSS v4.

- Hash-based routing (`#/`, `#/accounts`, `#/settings`, `#/trash`, `#/users`, `#/activity`, `#/logs`, `#/transfer`, `#/api-access`, `#/api-docs`, `#/file-share`, `#/login`, `#/share`)
- `client/main.js` — Auth flow (check setup → login → init app), route guards using hasPageAccess()
- `client/auth-state.js` — Shared auth state: currentUser, hasPermission, hasPageAccess, PERMISSION_GROUPS
- `client/time-utils.js` — Shared time formatting (timezone + 12/24h from settings)
- `client/pages/files.js` — File manager: grid/list, multi-select (Ctrl/Shift/long-press), copy/cut/paste, file info, preview, lazy thumbnails, transfer ownership modal
- `client/pages/accounts.js` — Account cards (colored grid), rclone import/export, color picker
- `client/pages/settings.js` — Shared folder ID, theme, timezone, time format, keep-alive, logging toggles, download speed, database download/upload, logout
- `client/pages/trash.js` — Trashed files from all accounts
- `client/pages/users.js` — User management (master only): collapsible permission groups per page
- `client/pages/activity.js` — Activity log viewer with filters
- `client/pages/logs.js` — System log viewer with filters
- `client/pages/transfer.js` — Transfer page: full list of uploads/downloads/transfers with controls
- `client/pages/api-access.js` — API key management: keys tab + settings tab
- `client/pages/api-docs.js` — API documentation page
- `client/pages/file-share.js` — Share admin page
- `client/pages/share-public.js` — Public share page
- `client/pages/login.js` — Login form
- `client/pages/setup.js` — First-run wizard
- `client/components/sidebar.js` — Nav filtered by hasPageAccess, storage bar/donut, transfer summary, collapsed mode
- `client/components/transfer-panel.js` — Unified floating panel for uploads/downloads/transfers with pause/cancel, floating button when hidden
- `client/components/logout-modal.js` — Confirmation modal
- `client/components/context-menu.js` — Right-click menu with viewport boundary detection
- `client/components/breadcrumb.js` — Folder navigation breadcrumb

**Key design decisions:**
- Docker/native Node.js is the only supported runtime.
- DB abstraction: `src/db/local.js` wraps better-sqlite3 with an async API so route code can consistently use `prepare().bind().first/all/run()`.
- All routes use `c.get('db')` for database and `c.env` for Google/Turnstile credentials.
- `createApp(getDB, envVars)` keeps env injection explicit for the Node entrypoint.
- Google Drive API uses direct REST fetch, not googleapis.
- Cloudflare Turnstile is optional bot protection for sharing, not a deployment target.
- TailwindCSS v4 dark mode: `@custom-variant dark (&:where(.dark, .dark *))` for class-based toggle.
- Vite proxy uses trailing slash (`/api/`, `/auth/`, `/dlink/`, `/share/`) to avoid matching files like `api.js`.
- Transfer panel is global (persists across page navigation).
- Multi-select: Ctrl+Click (toggle), Shift+Click (range), long-press (mobile).
- `.btn-secondary` uses `@apply flex` which overrides `hidden` — use element replacement instead of class toggle.

## Database

SQLite at `data/udrive.db` (native, gitignored) or `/app/data/udrive.db` in Docker. Tables:

- `accounts` — OAuth tokens, storage quota, is_primary, card_color, file_count
- `settings` — Key-value settings
- `file_owners` — Maps file_id to account_id
- `users` — Username, password_hash, role (master/slave), session_timeout_hours
- `user_permissions` — Per-user permission grants
- `sessions` — Session tokens with expiry
- `activity_log` — User action tracking
- `system_log` — System event tracking
- `api_keys` — API key management (name, hash, prefix, permissions, rate_limit, expires_at)
- `api_rate_limits` — Rate limit tracking per key per minute window
- `shared_files` — Public share metadata

Existing databases may contain old tables/permissions from prior builds. Avoid destructive migrations unless explicitly requested.

## Permission System

Hierarchical, grouped per page. Page is visible if user has at least 1 permission in that group.

```text
drive: drive:view, drive:upload, drive:download_browser, drive:download_background, drive:delete, drive:rename, drive:create_folder, drive:move, drive:copy, drive:preview, drive:view_uploader, drive:transfer_owner
trash: trash:view, trash:restore, trash:permanent_delete, trash:empty
accounts: accounts:view, accounts:view_email, accounts:add, accounts:remove, accounts:set_primary, accounts:refresh, accounts:import_export, accounts:color, accounts:clean_all
settings: settings:view, settings:edit, settings:keepalive, settings:database
admin: admin:view_users, admin:manage_users, admin:edit_permissions, admin:view_activity, admin:view_logs, admin:manage_api, admin:view_api_docs
share: share:view, share:manage, share:settings
```

Master has all permissions implicitly. Old permission format (page:*, action:*) is auto-migrated on startup.

## API System

Public API at `/api/v1/*` authenticated via Bearer token (API key format: `udrive_` + 64 hex). Per-key permissions: `api:files:read`, `api:files:download`, `api:files:upload`, `api:files:write`, `api:files:transfer`, `api:accounts:read`. Rate limiting is per key and configurable.

## Deploy Targets

- **Native:** `npm run build && npm start` → `src/local.js` → Hono on @hono/node-server + better-sqlite3
- **Docker:** `docker compose up -d` → same Node runtime, persistent volume at `/app/data`

## Docker

Multi-stage Dockerfile. Volume at `/app/data/` for DB persistence. Reads `.env` if present via docker-compose.

## Large Folder Deletion

Folder deletion is synchronous in Docker/native mode and has safety limits to avoid long-running HTTP requests. Very large folders should be deleted in smaller subfolders. Do not reintroduce Cloudflare Queue-specific behavior unless the deployment model changes again.
