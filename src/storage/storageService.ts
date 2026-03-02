import * as vscode from 'vscode';
import { ConnectionMetadata, ConnectionRecord } from '../models/connectionModel';
import { Logger } from '../utils/logger';

export class StorageService {
  private readonly metadataKey = 'ftpext.connection.metadata.v1';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly logger: Logger
  ) {}

  async listConnections(): Promise<ConnectionMetadata[]> {
    const connections = this.context.globalState.get<ConnectionMetadata[]>(this.metadataKey, []);
    return [...connections].sort((a, b) => a.name.localeCompare(b.name));
  }

  async getConnectionById(id: string): Promise<ConnectionMetadata | undefined> {
    const connections = await this.listConnections();
    return connections.find((connection) => connection.id === id);
  }

  async saveConnection(connection: ConnectionMetadata, password: string): Promise<void> {
    const current = await this.listConnections();
    const index = current.findIndex((entry) => entry.id === connection.id);

    if (index === -1) {
      current.push(connection);
    } else {
      current[index] = connection;
    }

    await this.context.globalState.update(this.metadataKey, current);
    await this.context.secrets.store(this.getSecretKey(connection.id), password);

    this.logger.info(`Connection saved: ${connection.name} (${connection.protocol})`);
  }

  async removeConnection(id: string): Promise<void> {
    const current = await this.listConnections();
    const filtered = current.filter((entry) => entry.id !== id);
    await this.context.globalState.update(this.metadataKey, filtered);
    await this.context.secrets.delete(this.getSecretKey(id));
    this.logger.info(`Connection removed: ${id}`);
  }

  async getConnectionRecord(id: string): Promise<ConnectionRecord | undefined> {
    const metadata = await this.getConnectionById(id);
    if (!metadata) {
      return undefined;
    }

    const password = await this.context.secrets.get(this.getSecretKey(id));
    if (!password) {
      return undefined;
    }

    return {
      ...metadata,
      password
    };
  }

  async getPassword(id: string): Promise<string | undefined> {
    return this.context.secrets.get(this.getSecretKey(id));
  }

  private getSecretKey(connectionId: string): string {
    return `ftpext.connection.secret.${connectionId}`;
  }
}
