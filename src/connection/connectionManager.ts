import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ConnectionInput,
  ConnectionMetadata,
  ConnectionProtocol,
  ConnectionRecord,
  RemoteEntry
} from '../models/connectionModel';
import { StorageService } from '../storage/storageService';
import { Logger } from '../utils/logger';
import {
  defaultPortForProtocol,
  normalizeRemotePath,
  sanitizeConnectionInput,
  sanitizeRemoteSegment,
  validateConnectionInput
} from '../utils/validation';
import { FtpService } from './ftpService';
import { ProtocolService } from './protocolService';
import { SshService } from './sshService';

export class ConnectionManager {
  constructor(
    private readonly storageService: StorageService,
    private readonly sshService: SshService,
    private readonly ftpService: FtpService,
    private readonly logger: Logger
  ) {}

  async getConnections(): Promise<ConnectionMetadata[]> {
    return this.storageService.listConnections();
  }

  async getConnectionById(connectionId: string): Promise<ConnectionMetadata> {
    const connection = await this.storageService.getConnectionById(connectionId);
    if (!connection) {
      throw new Error('Connection not found.');
    }

    return connection;
  }

  async getConnectionRecordForAuth(connectionId: string): Promise<ConnectionRecord> {
    return this.getConnectionRecord(connectionId);
  }

  async addConnection(input: ConnectionInput): Promise<ConnectionMetadata> {
    const sanitizedInput = sanitizeConnectionInput({
      ...input,
      port: input.port || defaultPortForProtocol(input.protocol)
    });

    const validation = validateConnectionInput(sanitizedInput, { requirePassword: true });
    if (!validation.valid) {
      throw new Error(validation.errors.join(' '));
    }

    const timestamp = new Date().toISOString();
    const metadata: ConnectionMetadata = {
      id: randomUUID(),
      name: sanitizedInput.name || `${sanitizedInput.protocol.toUpperCase()} - ${sanitizedInput.serverAddress}`,
      protocol: sanitizedInput.protocol,
      serverAddress: sanitizedInput.serverAddress,
      port: sanitizedInput.port,
      username: sanitizedInput.username,
      remotePath: normalizeRemotePath(sanitizedInput.remotePath),
      localPath: sanitizedInput.localPath,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.storageService.saveConnection(metadata, sanitizedInput.password);
    return metadata;
  }

  async updateConnection(connectionId: string, input: ConnectionInput): Promise<ConnectionMetadata> {
    const existingConnection = await this.storageService.getConnectionById(connectionId);
    if (!existingConnection) {
      throw new Error('Connection not found.');
    }

    const sanitizedInput = sanitizeConnectionInput({
      ...input,
      port: input.port || defaultPortForProtocol(input.protocol)
    });

    const keepExistingPassword = sanitizedInput.password.length === 0;
    const validation = validateConnectionInput(sanitizedInput, { requirePassword: !keepExistingPassword });
    if (!validation.valid) {
      throw new Error(validation.errors.join(' '));
    }

    const password = keepExistingPassword
      ? await this.storageService.getPassword(connectionId)
      : sanitizedInput.password;

    if (!password) {
      throw new Error('Password is required for this connection.');
    }

    const updatedConnection: ConnectionMetadata = {
      ...existingConnection,
      name: sanitizedInput.name || `${sanitizedInput.protocol.toUpperCase()} - ${sanitizedInput.serverAddress}`,
      protocol: sanitizedInput.protocol,
      serverAddress: sanitizedInput.serverAddress,
      port: sanitizedInput.port,
      username: sanitizedInput.username,
      remotePath: normalizeRemotePath(sanitizedInput.remotePath),
      localPath: sanitizedInput.localPath,
      updatedAt: new Date().toISOString()
    };

    await this.storageService.saveConnection(updatedConnection, password);
    return updatedConnection;
  }

  async removeConnection(connectionId: string): Promise<void> {
    await this.storageService.removeConnection(connectionId);
  }

  async testConnection(input: ConnectionInput): Promise<void> {
    const sanitizedInput = sanitizeConnectionInput({
      ...input,
      port: input.port || defaultPortForProtocol(input.protocol)
    });

    const validation = validateConnectionInput(sanitizedInput, { requirePassword: true });
    if (!validation.valid) {
      throw new Error(validation.errors.join(' '));
    }

    const transientConnection: ConnectionRecord = {
      id: randomUUID(),
      name: sanitizedInput.name || 'Transient connection',
      protocol: sanitizedInput.protocol,
      serverAddress: sanitizedInput.serverAddress,
      port: sanitizedInput.port,
      username: sanitizedInput.username,
      password: sanitizedInput.password,
      remotePath: normalizeRemotePath(sanitizedInput.remotePath),
      localPath: sanitizedInput.localPath,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    await this.getService(transientConnection.protocol).testConnection(transientConnection);
  }

  async testSavedConnection(connectionId: string): Promise<void> {
    const connection = await this.getConnectionRecord(connectionId);
    await this.getService(connection.protocol).testConnection(connection);
  }

  async listDirectory(connectionId: string, remotePath?: string): Promise<RemoteEntry[]> {
    const connection = await this.getConnectionRecord(connectionId);
    const pathToRead = remotePath ? normalizeRemotePath(remotePath) : normalizeRemotePath(connection.remotePath);
    return this.getService(connection.protocol).listDirectory(connection, pathToRead);
  }

  async downloadFile(connectionId: string, remotePath: string, localPath: string): Promise<void> {
    const connection = await this.getConnectionRecord(connectionId);
    const resolvedPath = path.resolve(localPath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await this.getService(connection.protocol).downloadFile(connection, normalizeRemotePath(remotePath), resolvedPath);
  }

  async uploadFile(connectionId: string, localPath: string, remotePath: string): Promise<void> {
    const connection = await this.getConnectionRecord(connectionId);
    const normalizedLocalPath = path.resolve(localPath);

    await fs.access(normalizedLocalPath);
    await this.getService(connection.protocol).uploadFile(connection, normalizedLocalPath, normalizeRemotePath(remotePath));
  }

  async deletePath(connectionId: string, remotePath: string, isDirectory: boolean): Promise<void> {
    const connection = await this.getConnectionRecord(connectionId);
    await this.getService(connection.protocol).deletePath(connection, normalizeRemotePath(remotePath), isDirectory);
  }

  async createFolder(connectionId: string, parentPath: string, folderName: string): Promise<string> {
    const safeFolderName = sanitizeRemoteSegment(folderName);
    if (!safeFolderName) {
      throw new Error('Folder name is invalid.');
    }

    const connection = await this.getConnectionRecord(connectionId);
    const targetPath = path.posix.join(normalizeRemotePath(parentPath), safeFolderName);

    await this.getService(connection.protocol).createFolder(connection, targetPath);
    return targetPath;
  }

  async createFile(connectionId: string, parentPath: string, fileName: string): Promise<string> {
    const safeFileName = sanitizeRemoteSegment(fileName);
    if (!safeFileName) {
      throw new Error('File name is invalid.');
    }

    const connection = await this.getConnectionRecord(connectionId);
    const targetPath = path.posix.join(normalizeRemotePath(parentPath), safeFileName);
    await this.getService(connection.protocol).createFile(connection, targetPath);
    return targetPath;
  }

  async movePath(connectionId: string, sourcePath: string, destinationPath: string): Promise<void> {
    const connection = await this.getConnectionRecord(connectionId);
    await this.getService(connection.protocol).movePath(
      connection,
      normalizeRemotePath(sourcePath),
      normalizeRemotePath(destinationPath)
    );
  }

  async copyPath(connectionId: string, sourcePath: string, destinationPath: string, isDirectory: boolean): Promise<void> {
    const connection = await this.getConnectionRecord(connectionId);
    await this.getService(connection.protocol).copyPath(
      connection,
      normalizeRemotePath(sourcePath),
      normalizeRemotePath(destinationPath),
      isDirectory
    );
  }

  async compressPath(connectionId: string, sourcePath: string, archivePath: string): Promise<void> {
    const connection = await this.getConnectionRecord(connectionId);
    await this.getService(connection.protocol).compressPath(
      connection,
      normalizeRemotePath(sourcePath),
      normalizeRemotePath(archivePath)
    );
  }

  async extractArchive(connectionId: string, archivePath: string, destinationPath: string): Promise<void> {
    const connection = await this.getConnectionRecord(connectionId);
    await this.getService(connection.protocol).extractArchive(
      connection,
      normalizeRemotePath(archivePath),
      normalizeRemotePath(destinationPath)
    );
  }

  private getService(protocol: ConnectionProtocol): ProtocolService {
    if (protocol === 'ftp') {
      return this.ftpService;
    }

    return this.sshService;
  }

  private async getConnectionRecord(connectionId: string): Promise<ConnectionRecord> {
    const connection = await this.storageService.getConnectionRecord(connectionId);
    if (!connection) {
      this.logger.warn(`Connection record not found for id: ${connectionId}`);
      throw new Error('Connection credentials are missing.');
    }

    return connection;
  }
}
