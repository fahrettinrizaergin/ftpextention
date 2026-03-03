import { ConnectionRecord, RemoteEntry } from '../models/connectionModel';

export interface ProtocolService {
  testConnection(connection: ConnectionRecord): Promise<void>;
  listDirectory(connection: ConnectionRecord, remotePath: string): Promise<RemoteEntry[]>;
  downloadFile(connection: ConnectionRecord, remotePath: string, localPath: string): Promise<void>;
  uploadFile(connection: ConnectionRecord, localPath: string, remotePath: string): Promise<void>;
  deletePath(connection: ConnectionRecord, remotePath: string, isDirectory: boolean): Promise<void>;
  createFolder(connection: ConnectionRecord, remotePath: string): Promise<void>;
  createFile(connection: ConnectionRecord, remotePath: string): Promise<void>;
  movePath(connection: ConnectionRecord, sourcePath: string, destinationPath: string): Promise<void>;
  setPermissions(connection: ConnectionRecord, remotePath: string, permissions: string): Promise<void>;
  copyPath(connection: ConnectionRecord, sourcePath: string, destinationPath: string, isDirectory: boolean): Promise<void>;
  compressPath(connection: ConnectionRecord, sourcePath: string, archivePath: string): Promise<void>;
  extractArchive(connection: ConnectionRecord, archivePath: string, destinationPath: string): Promise<void>;
}
