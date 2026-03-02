import * as path from 'node:path';
import * as vscode from 'vscode';
import { ConnectionInput } from '../models/connectionModel';
import { ConnectionManager } from '../connection/connectionManager';
import { RemoteFileSyncService } from '../connection/remoteFileSyncService';
import { Logger } from '../utils/logger';
import { WebviewRequestMessage, WebviewResponseMessage } from './messages';

export class RemoteManagerWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'ftpext.remoteManagerView';

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connectionManager: ConnectionManager,
    private readonly remoteFileSyncService: RemoteFileSyncService,
    private readonly logger: Logger
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    this.view = webviewView;

    const webviewRoot = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'ui');

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [webviewRoot]
    };

    webviewView.webview.html = await this.buildHtml(webviewView.webview, webviewRoot);

    webviewView.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
      const message = this.parseMessage(rawMessage);
      if (!message) {
        await this.postMessage({
          type: 'operationError',
          payload: { message: 'Unsupported request payload.' }
        });
        return;
      }

      await this.handleMessage(message);
    });

    await this.sendConnections();
  }

  async refresh(): Promise<void> {
    await this.sendConnections();
  }

  private async handleMessage(message: WebviewRequestMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'ready':
        case 'getConnections': {
          await this.sendConnections();
          return;
        }

        case 'addConnection': {
          const connection = await this.connectionManager.addConnection(message.payload);
          await this.postMessage({ type: 'connectionSaved', payload: connection });
          await this.sendConnections();
          return;
        }

        case 'updateConnection': {
          const { id, ...input } = message.payload;
          const connection = await this.connectionManager.updateConnection(id, input as ConnectionInput);
          await this.postMessage({ type: 'connectionSaved', payload: connection });
          await this.sendConnections();
          return;
        }

        case 'removeConnection': {
          await this.connectionManager.removeConnection(message.payload.id);
          await this.postMessage({ type: 'connectionRemoved', payload: { id: message.payload.id } });
          await this.sendConnections();
          return;
        }

        case 'testConnection': {
          await this.connectionManager.testConnection(message.payload);
          await this.postMessage({
            type: 'connectionTestResult',
            payload: {
              ok: true,
              message: 'Connection successful.'
            }
          });
          return;
        }

        case 'testSavedConnection': {
          await this.connectionManager.testSavedConnection(message.payload.id);
          await this.postMessage({
            type: 'connectionStatus',
            payload: { connectionId: message.payload.id, status: 'connected' }
          });
          await this.postMessage({
            type: 'connectionTestResult',
            payload: {
              ok: true,
              message: 'Connection successful.',
              connectionId: message.payload.id
            }
          });
          return;
        }

        case 'listDirectory': {
          const entries = await this.connectionManager.listDirectory(message.payload.connectionId, message.payload.path);
          await this.postMessage({
            type: 'connectionStatus',
            payload: { connectionId: message.payload.connectionId, status: 'connected' }
          });
          await this.postMessage({
            type: 'directoryLoaded',
            payload: {
              connectionId: message.payload.connectionId,
              path: message.payload.path,
              entries
            }
          });
          return;
        }

        case 'openRemoteFile': {
          await this.remoteFileSyncService.openRemoteFile(
            message.payload.connectionId,
            message.payload.remotePath
          );
          await this.postMessage({
            type: 'operationSuccess',
            payload: { message: `Opened ${path.posix.basename(message.payload.remotePath)}` }
          });
          return;
        }

        case 'downloadFile': {
          const connection = await this.connectionManager.getConnectionById(message.payload.connectionId);
          const defaultFileName = path.posix.basename(message.payload.remotePath);
          const defaultUri = vscode.Uri.file(path.join(connection.localPath, defaultFileName));
          const destination = await vscode.window.showSaveDialog({
            defaultUri,
            saveLabel: 'Download'
          });

          if (!destination) {
            return;
          }

          await this.connectionManager.downloadFile(
            message.payload.connectionId,
            message.payload.remotePath,
            destination.fsPath
          );

          await this.postMessage({
            type: 'operationSuccess',
            payload: { message: `Downloaded ${defaultFileName}` }
          });
          return;
        }

        case 'uploadFile': {
          const sourceFiles = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFolders: false,
            canSelectFiles: true,
            openLabel: 'Upload'
          });

          if (!sourceFiles || sourceFiles.length === 0) {
            return;
          }

          const selectedFile = sourceFiles.at(0);
          if (!selectedFile) {
            return;
          }

          const localFilePath = selectedFile.fsPath;
          const remoteTarget = path.posix.join(
            message.payload.remoteDirectory,
            path.basename(localFilePath)
          );

          await this.connectionManager.uploadFile(message.payload.connectionId, localFilePath, remoteTarget);
          await this.postMessage({
            type: 'operationSuccess',
            payload: { message: `Uploaded ${path.basename(localFilePath)}` }
          });
          return;
        }

        case 'pickLocalPath': {
          const folder = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Local Folder'
          });

          const selectedFolder = folder?.at(0);
          if (!selectedFolder) {
            return;
          }

          await this.postMessage({
            type: 'localPathPicked',
            payload: { localPath: selectedFolder.fsPath }
          });
          return;
        }

        case 'deletePath': {
          await this.connectionManager.deletePath(
            message.payload.connectionId,
            message.payload.remotePath,
            message.payload.isDirectory
          );

          await this.postMessage({
            type: 'operationSuccess',
            payload: { message: `Deleted ${path.posix.basename(message.payload.remotePath)}` }
          });
          return;
        }

        case 'createFolder': {
          const folderPath = await this.connectionManager.createFolder(
            message.payload.connectionId,
            message.payload.parentPath,
            message.payload.folderName
          );

          await this.postMessage({
            type: 'operationSuccess',
            payload: { message: `Created folder ${path.posix.basename(folderPath)}` }
          });
          return;
        }

        case 'createFile': {
          const filePath = await this.connectionManager.createFile(
            message.payload.connectionId,
            message.payload.parentPath,
            message.payload.fileName
          );

          await this.postMessage({
            type: 'operationSuccess',
            payload: { message: `Created file ${path.posix.basename(filePath)}` }
          });
          return;
        }

        case 'copyPath': {
          await this.connectionManager.copyPath(
            message.payload.connectionId,
            message.payload.sourcePath,
            message.payload.destinationPath,
            message.payload.isDirectory
          );
          await this.postMessage({
            type: 'operationSuccess',
            payload: { message: 'Copied successfully.' }
          });
          return;
        }

        case 'movePath': {
          await this.connectionManager.movePath(
            message.payload.connectionId,
            message.payload.sourcePath,
            message.payload.destinationPath
          );
          await this.postMessage({
            type: 'operationSuccess',
            payload: { message: 'Moved successfully.' }
          });
          return;
        }

        case 'compressPath': {
          await this.connectionManager.compressPath(
            message.payload.connectionId,
            message.payload.sourcePath,
            message.payload.archivePath
          );
          await this.postMessage({
            type: 'operationSuccess',
            payload: { message: `Archive created: ${path.posix.basename(message.payload.archivePath)}` }
          });
          return;
        }

        case 'extractArchive': {
          await this.connectionManager.extractArchive(
            message.payload.connectionId,
            message.payload.archivePath,
            message.payload.destinationPath
          );
          await this.postMessage({
            type: 'operationSuccess',
            payload: { message: `Archive extracted: ${path.posix.basename(message.payload.archivePath)}` }
          });
          return;
        }
      }
    } catch (error: unknown) {
      this.logger.error('Webview command failed', error);

      if (message.type === 'testSavedConnection') {
        await this.postMessage({
          type: 'connectionStatus',
          payload: {
            connectionId: message.payload.id,
            status: 'error'
          }
        });
      }
      if (message.type === 'listDirectory') {
        await this.postMessage({
          type: 'connectionStatus',
          payload: {
            connectionId: message.payload.connectionId,
            status: 'error'
          }
        });
      }

      const testPayload: WebviewResponseMessage = message.type === 'testSavedConnection'
        ? {
            type: 'connectionTestResult',
            payload: {
              ok: false,
              message: this.getErrorMessage(error),
              connectionId: message.payload.id
            }
          }
        : {
            type: 'connectionTestResult',
            payload: {
              ok: false,
              message: this.getErrorMessage(error)
            }
          };

      await this.postMessage(testPayload);

      await this.postMessage({
        type: 'operationError',
        payload: { message: this.getErrorMessage(error) }
      });
    }
  }

  private async sendConnections(): Promise<void> {
    const connections = await this.connectionManager.getConnections();
    await this.postMessage({
      type: 'connectionsLoaded',
      payload: connections
    });
  }

  private async postMessage(message: WebviewResponseMessage): Promise<void> {
    if (!this.view) {
      return;
    }

    await this.view.webview.postMessage(message);
  }

  private async buildHtml(webview: vscode.Webview, webviewRoot: vscode.Uri): Promise<string> {
    const templateUri = vscode.Uri.joinPath(webviewRoot, 'index.html');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewRoot, 'styles.css'));
    const nonce = this.createNonce();

    try {
      const bytes = await vscode.workspace.fs.readFile(templateUri);
      const template = Buffer.from(bytes).toString('utf8');
      return template
        .replace(/\{\{scriptUri\}\}/g, scriptUri.toString())
        .replace(/\{\{styleUri\}\}/g, styleUri.toString())
        .replace(/\{\{nonce\}\}/g, nonce)
        .replace(/\{\{cspSource\}\}/g, webview.cspSource);
    } catch (error: unknown) {
      this.logger.error('Failed to load webview HTML template', error);
      return '<html><body>Failed to load webview assets.</body></html>';
    }
  }

  private parseMessage(rawMessage: unknown): WebviewRequestMessage | undefined {
    if (!rawMessage || typeof rawMessage !== 'object') {
      return undefined;
    }

    const candidate = rawMessage as { type?: unknown };
    if (typeof candidate.type !== 'string') {
      return undefined;
    }

    const supportedTypes = new Set<WebviewRequestMessage['type']>([
      'ready',
      'getConnections',
      'addConnection',
      'updateConnection',
      'removeConnection',
      'testConnection',
      'testSavedConnection',
      'listDirectory',
      'openRemoteFile',
      'downloadFile',
      'uploadFile',
      'pickLocalPath',
      'deletePath',
      'createFolder',
      'createFile',
      'copyPath',
      'movePath',
      'compressPath',
      'extractArchive'
    ]);

    if (!supportedTypes.has(candidate.type as WebviewRequestMessage['type'])) {
      return undefined;
    }

    return rawMessage as WebviewRequestMessage;
  }

  private createNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let nonce = '';
    for (let index = 0; index < 32; index += 1) {
      nonce += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return nonce;
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
