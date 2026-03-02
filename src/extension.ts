import * as vscode from 'vscode';
import { ConnectionManager } from './connection/connectionManager';
import { FtpService } from './connection/ftpService';
import { RemoteFileSyncService } from './connection/remoteFileSyncService';
import { SshService } from './connection/sshService';
import { StorageService } from './storage/storageService';
import { Logger } from './utils/logger';
import { RemoteManagerWebviewProvider } from './webview/provider';

export function activate(context: vscode.ExtensionContext): void {
  const logger = new Logger('Remote Connection Manager');
  const storageService = new StorageService(context, logger);
  const sshService = new SshService(logger);
  const ftpService = new FtpService();
  const connectionManager = new ConnectionManager(storageService, sshService, ftpService, logger);
  const remoteFileSyncService = new RemoteFileSyncService(context, connectionManager, logger);
  void remoteFileSyncService.initialize();

  const webviewProvider = new RemoteManagerWebviewProvider(
    context,
    connectionManager,
    remoteFileSyncService,
    logger
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(RemoteManagerWebviewProvider.viewType, webviewProvider)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ftpext.refreshConnections', async () => {
      await webviewProvider.refresh();
      void vscode.window.showInformationMessage('Remote connections refreshed.');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('ftpext.openPanel', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.ftpext');
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((document) => {
      void remoteFileSyncService.handleDocumentSaved(document);
    })
  );
  context.subscriptions.push(
    vscode.workspace.onDidCloseTextDocument((document) => {
      void remoteFileSyncService.handleDocumentClosed(document);
    })
  );

  context.subscriptions.push(remoteFileSyncService);
  context.subscriptions.push(logger);
}

export function deactivate(): void {
  // Extension resources are disposed by VS Code subscriptions.
}
