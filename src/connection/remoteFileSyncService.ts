import * as fs from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { Logger } from '../utils/logger';

interface RemoteFileBinding {
  connectionId: string;
  remotePath: string;
}

export class RemoteFileSyncService implements vscode.Disposable {
  private readonly bindings = new Map<string, RemoteFileBinding>();
  private readonly cacheRootPath: string;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connectionManager: ConnectionManager,
    private readonly logger: Logger
  ) {
    this.cacheRootPath = path.join(this.context.globalStorageUri.fsPath, 'remote-edit-cache');
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.cacheRootPath, { recursive: true });
    await this.cleanupStaleCache();

    this.cleanupTimer = setInterval(() => {
      void this.cleanupStaleCache();
    }, 30 * 60 * 1000);
  }

  async openRemoteFile(connectionId: string, remotePath: string): Promise<void> {
    await fs.mkdir(this.cacheRootPath, { recursive: true });

    const localPath = this.getLocalPath(connectionId, remotePath);
    await fs.mkdir(path.dirname(localPath), { recursive: true });

    await this.connectionManager.downloadFile(connectionId, remotePath, localPath);
    this.bindings.set(path.resolve(localPath), { connectionId, remotePath });

    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(localPath));
    await vscode.window.showTextDocument(document, { preview: false, preserveFocus: false });
  }

  async handleDocumentSaved(document: vscode.TextDocument): Promise<void> {
    const binding = this.bindings.get(path.resolve(document.uri.fsPath));
    if (!binding) {
      return;
    }

    try {
      await this.connectionManager.uploadFile(binding.connectionId, document.uri.fsPath, binding.remotePath);
      void vscode.window.setStatusBarMessage(`Uploaded: ${path.posix.basename(binding.remotePath)}`, 2500);
    } catch (error: unknown) {
      this.logger.error('Failed to upload saved file', error);
      void vscode.window.showErrorMessage(`Remote upload failed: ${this.getErrorMessage(error)}`);
    }
  }

  async handleDocumentClosed(document: vscode.TextDocument): Promise<void> {
    const localPath = path.resolve(document.uri.fsPath);
    const binding = this.bindings.get(localPath);
    if (!binding) {
      return;
    }

    this.bindings.delete(localPath);

    try {
      await fs.rm(localPath, { force: true });
      await this.removeEmptyParents(path.dirname(localPath));
    } catch (error: unknown) {
      this.logger.warn(`Could not remove cache file: ${this.getErrorMessage(error)}`);
    }
  }

  async cleanupStaleCache(): Promise<void> {
    const activePaths = new Set<string>();
    for (const textDocument of vscode.workspace.textDocuments) {
      activePaths.add(path.resolve(textDocument.uri.fsPath));
    }

    const staleThresholdMs = 6 * 60 * 60 * 1000;
    const now = Date.now();

    await this.walkCache(this.cacheRootPath, async (filePath) => {
      if (activePaths.has(filePath) || this.bindings.has(filePath)) {
        return;
      }

      const stat = await fs.stat(filePath);
      if (now - stat.mtimeMs < staleThresholdMs) {
        return;
      }

      await fs.rm(filePath, { force: true });
      await this.removeEmptyParents(path.dirname(filePath));
    });
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    void this.cleanupStaleCache();
  }

  private async walkCache(rootPath: string, onFile: (filePath: string) => Promise<void>): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(rootPath, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.resolve(rootPath, entry.name);
      if (entry.isDirectory()) {
        await this.walkCache(fullPath, onFile);
      } else if (entry.isFile()) {
        await onFile(fullPath);
      }
    }
  }

  private async removeEmptyParents(startDir: string): Promise<void> {
    let currentDir = path.resolve(startDir);
    const rootDir = path.resolve(this.cacheRootPath);

    while (currentDir.startsWith(rootDir)) {
      const children = await fs.readdir(currentDir).catch(() => [] as string[]);
      if (children.length > 0) {
        return;
      }

      await fs.rmdir(currentDir).catch(() => undefined);
      if (currentDir === rootDir) {
        return;
      }

      currentDir = path.dirname(currentDir);
    }
  }

  private getLocalPath(connectionId: string, remotePath: string): string {
    const segments = remotePath
      .split('/')
      .filter((segment) => segment.length > 0)
      .map((segment) => this.sanitizeSegment(segment));

    const relativePath = segments.length > 0 ? path.join(...segments) : 'root.txt';
    return path.join(this.cacheRootPath, this.sanitizeSegment(connectionId), relativePath);
  }

  private sanitizeSegment(value: string): string {
    const sanitized = value.replace(/[^a-zA-Z0-9._-]/g, '_').trim();
    return sanitized.length > 0 ? sanitized : 'item';
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    return 'Unknown error';
  }
}
