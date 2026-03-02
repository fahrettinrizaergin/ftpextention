import * as ftp from 'basic-ftp';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { ConnectionRecord, RemoteEntry } from '../models/connectionModel';
import { normalizeRemotePath } from '../utils/validation';
import { ProtocolService } from './protocolService';

export class FtpService implements ProtocolService {
  async testConnection(connection: ConnectionRecord): Promise<void> {
    await this.withClient(connection, async () => undefined);
  }

  async listDirectory(connection: ConnectionRecord, remotePath: string): Promise<RemoteEntry[]> {
    const targetPath = normalizeRemotePath(remotePath);
    return this.withClient(connection, async (client) => {
      const entries = await client.list(targetPath);
      return entries
        .filter((entry) => entry.name !== '.' && entry.name !== '..')
        .map((entry) => {
          const normalizedPath = path.posix.join(targetPath, entry.name);
          const item: RemoteEntry = {
            name: entry.name,
            path: normalizedPath,
            type: entry.isDirectory ? 'directory' : 'file',
            size: entry.size
          };

          if (entry.modifiedAt) {
            item.modifiedAt = entry.modifiedAt.toISOString();
          }

          return item;
        });
    });
  }

  async downloadFile(connection: ConnectionRecord, remotePath: string, localPath: string): Promise<void> {
    await this.withClient(connection, async (client) => {
      await client.downloadTo(localPath, normalizeRemotePath(remotePath));
    });
  }

  async uploadFile(connection: ConnectionRecord, localPath: string, remotePath: string): Promise<void> {
    await this.withClient(connection, async (client) => {
      await client.uploadFrom(localPath, normalizeRemotePath(remotePath));
    });
  }

  async deletePath(connection: ConnectionRecord, remotePath: string, isDirectory: boolean): Promise<void> {
    await this.withClient(connection, async (client) => {
      const targetPath = normalizeRemotePath(remotePath);
      if (isDirectory) {
        await client.removeDir(targetPath);
        return;
      }

      await client.remove(targetPath);
    });
  }

  async createFolder(connection: ConnectionRecord, remotePath: string): Promise<void> {
    await this.withClient(connection, async (client) => {
      await client.ensureDir(normalizeRemotePath(remotePath));
    });
  }

  async createFile(connection: ConnectionRecord, remotePath: string): Promise<void> {
    await this.withClient(connection, async (client) => {
      await client.uploadFrom(Readable.from(['']), normalizeRemotePath(remotePath));
    });
  }

  async movePath(connection: ConnectionRecord, sourcePath: string, destinationPath: string): Promise<void> {
    await this.withClient(connection, async (client) => {
      await client.rename(normalizeRemotePath(sourcePath), normalizeRemotePath(destinationPath));
    });
  }

  async copyPath(
    connection: ConnectionRecord,
    sourcePath: string,
    destinationPath: string,
    isDirectory: boolean
  ): Promise<void> {
    if (isDirectory) {
      throw new Error('FTP copy for directories is not supported by this extension.');
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ftpext-copy-'));
    const tempFile = path.join(tempDir, `${randomUUID()}-${path.basename(sourcePath)}`);

    try {
      await this.withClient(connection, async (client) => {
        await client.downloadTo(tempFile, normalizeRemotePath(sourcePath));
        await client.uploadFrom(tempFile, normalizeRemotePath(destinationPath));
      });
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  async compressPath(
    connection: ConnectionRecord,
    sourcePath: string,
    archivePath: string
  ): Promise<void> {
    void connection;
    void sourcePath;
    void archivePath;
    throw new Error('ZIP compression is supported only for SSH/SFTP connections.');
  }

  async extractArchive(
    connection: ConnectionRecord,
    archivePath: string,
    destinationPath: string
  ): Promise<void> {
    void connection;
    void archivePath;
    void destinationPath;
    throw new Error('ZIP extraction is supported only for SSH/SFTP connections.');
  }

  private async withClient<T>(connection: ConnectionRecord, operation: (client: ftp.Client) => Promise<T>): Promise<T> {
    const client = new ftp.Client(20_000);

    try {
      await client.access({
        host: connection.serverAddress,
        port: connection.port,
        user: connection.username,
        password: connection.password,
        secure: false
      });

      return await operation(client);
    } finally {
      client.close();
    }
  }
}
