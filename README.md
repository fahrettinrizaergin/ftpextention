# Remote Connection Manager (VS Code / Cursor Compatible)

Remote Connection Manager is a production-ready TypeScript extension for VS Code-compatible editors (including Cursor) that provides SSH, SFTP, and FTP connection management and a webview-based remote file manager.

## Features

- Activity Bar container with custom icon
- Custom WebviewView panel
- Saved connection management (add, edit, delete, test)
- Secure credential storage with `SecretStorage`
- Connection metadata storage with `globalState`
- File operations for SSH/SFTP/FTP:
  - list directories
  - navigate directories
  - upload file
  - download file
  - delete file/folder
  - create folder
- Connection status indicator
- Tree-based folder expand/collapse UI
- Toast notifications and modal feedback

## Architecture

```text
src/
  extension.ts
  connection/
    connectionManager.ts
    protocolService.ts
    sshService.ts
    ftpService.ts
  storage/
    storageService.ts
  webview/
    messages.ts
    provider.ts
    ui/
      index.html
      main.ts
      styles.css
  models/
    connectionModel.ts
  utils/
    logger.ts
    validation.ts
resources/
  activity-icon.svg
scripts/
  build.mjs
```

## Security

- Passwords are stored only in `vscode.SecretStorage`.
- Passwords are never written into metadata or webview-local persistence.
- Inputs are sanitized and validated before use.
- No shell command execution with user-provided values.
- FTP/SSH/SFTP clients are disposed after each operation.

## Requirements

- Node.js 18+
- VS Code 1.90+ (or compatible editor API level)

## Setup

```bash
npm install
npm run compile
```

## Development

```bash
npm run watch
```

Open the project in VS Code and run the extension host:

1. Press `F5`.
2. In the Extension Development Host, click the **Remote** Activity Bar icon.
3. Add a connection and test it.
4. Browse and manage remote files.

## Testing Build and Types

```bash
npm run typecheck
npm run compile
```

## Notes

- `SSH` and `SFTP` both use `ssh2` backend.
- `FTP` uses `basic-ftp` backend.
- SFTP profile defaults to port `22`, FTP defaults to `21`.

## Extension Commands

- `Remote Connections: Open Panel` (`ftpext.openPanel`)
- `Remote Connections: Refresh` (`ftpext.refreshConnections`)

## Packaging

For Marketplace packaging, add a valid `publisher` and use your preferred packaging tool (`vsce` or equivalent).
