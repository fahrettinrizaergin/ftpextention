import type { ConnectionInput, ConnectionMetadata, RemoteEntry } from '../models/connectionModel';

export interface DirectoryRequest {
  connectionId: string;
  path: string;
}

export type WebviewRequestMessage =
  | { type: 'ready' }
  | { type: 'getConnections' }
  | { type: 'addConnection'; payload: ConnectionInput }
  | { type: 'updateConnection'; payload: ConnectionInput & { id: string } }
  | { type: 'removeConnection'; payload: { id: string } }
  | { type: 'disconnectConnection'; payload: { id: string } }
  | { type: 'openTerminal'; payload: { id: string } }
  | { type: 'testConnection'; payload: ConnectionInput }
  | { type: 'testSavedConnection'; payload: { id: string } }
  | { type: 'listDirectory'; payload: DirectoryRequest }
  | { type: 'openRemoteFile'; payload: { connectionId: string; remotePath: string } }
  | { type: 'downloadFile'; payload: { connectionId: string; remotePath: string } }
  | { type: 'uploadFile'; payload: { connectionId: string; remoteDirectory: string } }
  | { type: 'pickLocalPath' }
  | { type: 'deletePath'; payload: { connectionId: string; remotePath: string; isDirectory: boolean } }
  | { type: 'createFolder'; payload: { connectionId: string; parentPath: string; folderName: string } }
  | { type: 'createFile'; payload: { connectionId: string; parentPath: string; fileName: string } }
  | { type: 'copyPath'; payload: { connectionId: string; sourcePath: string; destinationPath: string; isDirectory: boolean } }
  | { type: 'movePath'; payload: { connectionId: string; sourcePath: string; destinationPath: string } }
  | { type: 'compressPath'; payload: { connectionId: string; sourcePath: string; archivePath: string } }
  | { type: 'extractArchive'; payload: { connectionId: string; archivePath: string; destinationPath: string } };

export type WebviewResponseMessage =
  | { type: 'connectionsLoaded'; payload: ConnectionMetadata[] }
  | { type: 'connectionSaved'; payload: ConnectionMetadata }
  | { type: 'connectionRemoved'; payload: { id: string } }
  | { type: 'connectionTestResult'; payload: { ok: boolean; message: string; connectionId?: string } }
  | { type: 'directoryLoaded'; payload: { connectionId: string; path: string; entries: RemoteEntry[] } }
  | { type: 'localPathPicked'; payload: { localPath: string } }
  | { type: 'operationSuccess'; payload: { message: string } }
  | { type: 'operationError'; payload: { message: string } }
  | { type: 'connectionStatus'; payload: { connectionId: string; status: 'connected' | 'disconnected' | 'error' } };
