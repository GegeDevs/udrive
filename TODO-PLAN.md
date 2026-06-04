# UDrive TODO Plan

## Current Feature Inventory

### File Manager
- Unified file browsing across pooled Google Drive accounts
- Upload, download, create folder, rename, delete, move, and copy
- Grid/list views
- Breadcrumb navigation
- Context menu actions
- Lazy thumbnails
- File info/detail view
- Image, video, and text preview
- Video range request support
- Multi-select with Ctrl/Shift click and mobile long-press

### Multi-Account Storage Pool
- Add Google Drive accounts via OAuth
- Import/export accounts via rclone config
- Primary account selection
- Shared folder model across accounts
- Automatic upload distribution to accounts with available space
- Per-account storage usage and file count
- Total storage display in sidebar/topbar
- Account colors and palette picker
- Refresh storage per account and all accounts
- Remove account from UDrive
- Clean All action to permanently delete all files from configured accounts

### Transfers and Downloads
- Browser download mode with temporary token links
- Background download mode with progress tracking
- Global transfer panel for uploads/downloads/transfers
- Sidebar transfer summary
- Pause/cancel support in transfer queues
- Download link expiry based on estimated transfer time

### Trash Management
- List trashed files from all accounts
- Restore files
- Permanently delete individual files
- Empty all trash
- Permission-gated trash actions

### Transfer Ownership
- Move file ownership between accounts
- Copy file to target account
- Permanently delete original file
- Update local `file_owners` mapping
- Permission-gated transfer action

### Public File Sharing
- Public upload page without login
- Unique share links
- Public downloads
- Optional password protection
- Configurable expiry
- Download count tracking
- Share cleanup
- Share settings page
- Allowed storage accounts for shares
- Cloudflare Turnstile support
- CSRF token validation
- IP-based upload rate limiting
- Real-time admin updates via SSE

### Authentication and Permissions
- First-run setup wizard
- Master and slave users
- PBKDF2 password hashing
- Session token auth via httpOnly cookie
- Configurable slave session timeout
- Granular permission groups for Drive, Trash, Accounts, Settings, Admin, and File Share
- User management UI
- Permission editor
- Password change for slave users

### Logs and Observability
- Activity log with filters
- System log with filters
- Activity/system logging toggles
- Clear activity logs
- Clear system logs

### Settings and Maintenance
- Shared folder ID configuration
- Theme: light, dark, auto
- Timezone and 12/24-hour time format
- Keep-alive trigger and interval setting
- Download speed setting
- Database export/import
- Logout confirmation

### API Access
- API key management UI
- Public REST API under `/api/v1`
- API key permissions
- API key expiration
- Per-key rate limiting
- CORS configuration
- API max upload size setting
- API documentation page
- File, account, upload, download, move, copy, delete, and transfer endpoints

### Deployment
- Local/Docker deployment with better-sqlite3
- Cloudflare Pages deployment with D1
- Shared Hono backend for Node.js and Cloudflare Workers
- Vite + TailwindCSS frontend build

## Suggested Roadmap

### 1. Account Health Check
Add a dedicated health dashboard for all configured Google Drive accounts.

Potential checks:
- Token validity and refresh status
- Shared folder accessibility
- Quota read success
- Upload/delete test status
- Last keep-alive result
- Last Drive API error
- Account inactive-risk indicator

Why:
- UDrive depends on many Google accounts. A health dashboard makes failures easier to diagnose before uploads/downloads break.

### 2. Global Search
Add search across the managed Drive space.

Potential filters:
- File/folder name
- File type
- Owner account
- Size range
- Modified date
- Folder scope

Potential actions from search results:
- Preview
- Download
- Move
- Copy
- Delete
- Transfer ownership

Why:
- As storage grows, folder browsing alone becomes inefficient.

### 3. Storage Analyzer
Add analytics for storage usage.

Possible views:
- Total used/free storage
- Usage per account
- Largest files
- Largest folders
- File type breakdown
- Old files
- Never/recently downloaded files
- Share files consuming most space

Why:
- The core value of UDrive is managing pooled storage. Analytics would make storage decisions easier.

### 4. Duplicate Finder
Detect and manage duplicate files.

Detection strategies:
- Same name + same size
- Same size + same MIME type
- Drive checksum metadata where available

Actions:
- Review duplicate groups
- Keep newest/oldest
- Delete selected duplicates
- Move duplicates to a review folder
- Export duplicate report

Why:
- Multi-account storage pools can accumulate duplicate files and waste quota.

### 5. Bulk Operation Queue
Create a reliable backend queue for long-running bulk actions.

Useful for:
- Bulk delete
- Bulk move
- Bulk copy
- Bulk transfer ownership
- Clean All
- Duplicate cleanup
- Rebalance storage

Queue features:
- Persistent progress in DB
- Retry failed items
- Pause/resume/cancel
- Survive browser close
- Result report after completion

Why:
- Google Drive operations can be slow or rate-limited. A persistent queue is safer than long frontend or request loops.

### 6. Rebalance Storage
Move files between accounts to balance usage.

Modes:
- Dry-run recommendation
- Manual selected transfer
- One-click rebalance
- Exclude specific folders/files
- Target usage threshold per account

Why:
- UDrive already supports transfer ownership and account selection. Rebalancing is a natural next step.

### 7. Orphan Detector
Detect mismatches between UDrive DB and Google Drive state.

Potential issues:
- `file_owners` rows for deleted Drive files
- Drive files without local owner mapping
- Shared files whose Drive file no longer exists
- Accounts missing shared folder access
- Invalid/stale account tokens

Actions:
- Remove stale DB rows
- Rebuild owner mapping
- Re-share folder access
- Cleanup broken shares

Why:
- Manual changes in Google Drive or failed operations can make DB state stale.

### 8. Advanced Share Management
Improve public file sharing controls.

Ideas:
- Share folders, not only individual uploaded files
- Batch share multiple files
- Custom share aliases
- Download limits
- One-time download links
- Expiry by download count
- Disable share without deleting file
- Regenerate password/link
- Share analytics

Why:
- The existing share system is already strong and can become a full public distribution feature.

### 9. Public Upload Inbox
Add an approval workflow for public uploads.

Ideas:
- Public upload inbox
- Optional uploader name/email
- Admin approval before moving into main storage
- Categories/forms for upload requests
- Auto-tag uploaded files
- Reject/delete workflow

Why:
- Useful if UDrive is used to receive files from other people while keeping main storage clean.

### 10. Tags, Labels, Notes, and Favorites
Add local metadata on top of Drive files.

Features:
- Favorite/star files
- Tags
- Notes
- Custom categories
- Filter by tag
- Smart collections

Why:
- Local metadata makes organization better without depending only on Google Drive folders.

### 11. Smart Rules and Automation
Add simple automation rules.

Example rules:
- Upload `.mp4` files to Videos folder
- Send large files to specific accounts
- Tag files by filename pattern
- Move old files to Archive
- Avoid upload to accounts over 90% usage

Why:
- UDrive already has enough metadata and routing logic to support useful automation.

### 12. Upload Policies
Add upload control by user or context.

Possible policies:
- Max upload size per user
- Allowed/blocked MIME types
- Per-user upload quota
- Per-day upload limit
- Force upload to specific account/folder
- Conflict handling: rename, overwrite, skip

Why:
- Useful when multiple slave users or public upload workflows are active.

### 13. Security and Audit Enhancements
Strengthen auth and auditability.

Ideas:
- Login attempt logs
- Failed login rate limiting
- API key last IP/user-agent
- Session list per user
- Revoke all sessions
- TOTP/2FA for master user
- Permission change audit trail
- API key usage analytics

Why:
- UDrive exposes public upload and API access, so stronger security visibility is valuable.

### 14. API Expansion
Expose more functionality through `/api/v1`.

Potential additions:
- Trash API
- Share API
- Activity/logs API
- Storage analyzer API
- Account health API
- Bulk operation API
- Webhook callbacks for events

Why:
- The existing API already covers core file operations. Expanding it would enable automation and external integrations.

### 15. File Versioning and Snapshots
Track periodic snapshots of file tree metadata.

Features:
- Snapshot file tree
- Compare snapshots
- Detect deleted/renamed/moved files
- Export snapshot report
- Restore metadata view

Why:
- Helpful for audit, recovery, and detecting accidental changes.

### 16. Media Gallery Mode
Add a specialized view for images/videos.

Features:
- Gallery layout
- Timeline by date
- Albums
- Slideshow
- Video grid
- EXIF metadata display

Why:
- Useful if the pooled storage contains many photos/videos.

### 17. WebDAV or Mount-Compatible Endpoint
Expose UDrive as a mountable storage endpoint.

Options:
- WebDAV endpoint
- rclone-compatible remote behavior where feasible

Why:
- Would let users access UDrive from OS file explorers and external tools.

### 18. Folder Sync / CLI Companion
Create a local sync companion.

Features:
- Watch local folder
- Upload changed files
- Optional remote delete sync
- Conflict detection
- CLI commands for upload/download/list

Why:
- Extends UDrive from web app into a practical backup/sync tool.

### 19. Client-Side Encryption Layer
Encrypt files before upload and decrypt on download.

Features:
- Per-folder encryption key
- Password-protected vault
- Encrypted file metadata handling

Tradeoff:
- Search, preview, and sharing become harder.

Why:
- Useful for sensitive storage, but should be considered a later advanced feature.

## Recommended Priority Order

1. Account Health Check
2. Global Search
3. Storage Analyzer
4. Duplicate Finder
5. Bulk Operation Queue
6. Rebalance Storage
7. Orphan Detector
8. Advanced Share Management
9. Smart Rules and Automation
10. Security and Audit Enhancements
11. API Expansion
12. Public Upload Inbox
13. Tags, Labels, Notes, and Favorites
14. Upload Policies
15. File Versioning and Snapshots
16. Media Gallery Mode
17. WebDAV or Mount-Compatible Endpoint
18. Folder Sync / CLI Companion
19. Client-Side Encryption Layer

## Notes

The strongest direction is to evolve UDrive into a storage management platform for many Google Drive accounts, not just a pooled file explorer. The most valuable near-term features are the ones that improve reliability, searchability, storage insight, and safe automation.
