# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

UDrive is a unified Google Drive manager that pools multiple free Google Drive accounts (15GB each) into one seamless storage interface. It uses a shared folder concept where one primary account shares a folder with all other accounts, and uploads are automatically distributed to accounts with available space.

## Commands

```bash
npm run dev      # Start both Express server (port 3000) and Vite dev server (port 5173) concurrently
npm run build    # Build frontend to dist/
npm start        # Start production server (serves built frontend from dist/)
docker compose up -d --build  # Build and run via Docker
```

## Architecture

**Backend** (`server/`): Express.js with SQLite (better-sqlite3), googleapis for Drive API, cookie-parser for sessions.

- `server/index.js` — Express app entry, mounts routes, applies auth middleware, serves static dist/
- `server/db/init.js` — SQLite database singleton, creates all tables + runs migrations on import
- `server/middleware/auth.js` — Session-based auth: authenticate, requireAuth, requireMaster, requirePermission(perm), createSession, deleteSession
- `server/services/token-manager.js` — OAuth2 client factory, auto-refreshes tokens on expiry
- `server/services/google-drive.js` — All Drive API operations (list, upload, download, mkdir, rename, delete/trash, restore, permanentDelete, move, copy, share, quota, thumbnail, getFileInfo, getFileOwnerEmail, listTrash)
- `server/services/account-selector.js` — Picks non-primary account with most available space for uploads
- `server/services/keep-alive.js` — Uploads+deletes a temp file per account to maintain activity; scheduler with configurable interval
- `server/services/password.js` — crypto.scrypt password hashing and verification
- `server/routes/auth.js` — Google OAuth2 login flow + callback, auto-shares folder with new accounts, assigns unique card colors
- `server/routes/files.js` — File CRUD with per-action permission checks, trash/restore/permanent-delete, thumbnail proxy, video range requests
- `server/routes/accounts.js` — Account management, set primary, card colors, rclone import/export
- `server/routes/settings.js` — Key-value settings store, keep-alive trigger
- `server/routes/users.js` — Auth system: setup wizard, login/logout, user CRUD, permissions, session timeout, password change

**Frontend** (`client/`): Vanilla JS SPA built with Vite + TailwindCSS v4.

- Hash-based routing (`#/`, `#/accounts`, `#/settings`, `#/trash`, `#/users`, `#/login`)
- `client/main.js` — Entry point, auth flow (check setup → login → init app), route guards based on permissions
- `client/auth-state.js` — Shared auth state (currentUser, hasPermission, getCurrentUser)
- `client/pages/files.js` — File manager: grid/list view, multi-select, bulk actions, copy/cut/paste, upload queue, file info panel, preview modal, lazy thumbnails, sticky toolbar/thead
- `client/pages/accounts.js` — Account cards (colored, grid layout), set primary, refresh, rclone import/export, color picker
- `client/pages/settings.js` — Shared folder ID, theme selector, keep-alive config, logout
- `client/pages/trash.js` — Trashed files from all accounts, restore, permanent delete, empty trash
- `client/pages/users.js` — User management (master only): create slave, edit permissions, change password, session timeout
- `client/pages/login.js` — Login form
- `client/pages/setup.js` — First-run wizard to create master account
- `client/components/sidebar.js` — Navigation filtered by permissions, storage bar/donut, collapsed (icon-only) mode
- `client/components/upload-queue.js` — Floating upload progress panel with per-file XHR progress
- `client/components/logout-modal.js` — Confirmation modal before logout
- `client/theme.js` — Dark/Light/Auto theme with class-based toggle, top bar cycle button

**Key design decisions:**
- File metadata is NOT cached locally; Google Drive is the source of truth
- Primary account is used for listing/reading (it owns the shared folder)
- Non-primary accounts are used for uploads (quota charged to uploader)
- Delete uses the file's owner account (tracked in `file_owners` table, or auto-detected via Drive API)
- Vite dev server proxies `/api` and `/auth` to Express on port 3000
- TailwindCSS v4 dark mode uses `@custom-variant dark (&:where(.dark, .dark *))` for class-based toggling
- Auth uses httpOnly session cookies; Master sessions never expire, Slave sessions have configurable timeout

## Database

SQLite at `server/db/udrive.db` (gitignored). Tables:
- `accounts` — OAuth tokens, storage quota, is_primary flag, card_color
- `settings` — Key-value pairs (shared_folder_id, theme, keepalive_interval_days, last_keepalive)
- `file_owners` — Maps file_id to account_id (tracks who uploaded what)
- `users` — Username, password_hash, role (master/slave), session_timeout_hours
- `user_permissions` — Per-user permission grants (page:* and action:*)
- `sessions` — Session tokens with expiry

## Permission System

Pages: `page:drive`, `page:trash`, `page:accounts`, `page:settings`
Actions: `action:upload`, `action:download`, `action:delete`, `action:create_folder`, `action:rename`, `action:move`, `action:copy`, `action:restore`, `action:permanent_delete`, `action:manage_accounts`, `action:import_export`

Master has all permissions implicitly. Slave only has explicitly assigned ones.

## Docker

Multi-stage Dockerfile (build + production). `docker-compose.yaml` with volume for DB persistence. Reads `.env` if present, otherwise set env in compose directly.
