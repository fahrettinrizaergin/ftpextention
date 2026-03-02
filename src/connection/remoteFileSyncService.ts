import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { Logger } from '../utils/logger';

interface RemoteFileBinding {
  connectionId: string;
  remotePath: string;
}

export class RemoteFileSyncService {
  private readonly bindings = new Map<string, RemoteFileBinding>();
  private readonly cacheRootPath: string;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connectionManager: ConnectionManager,
    private readonly logger: Logger
  ) {
    this.cacheRootPath = path.join(this.context.globalStorageUri.fsPath, 'remote-edit-cache');
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
