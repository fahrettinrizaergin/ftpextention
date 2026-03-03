import * as path from 'node:path';
import { Client, SFTPWrapper } from 'ssh2';
import { ConnectionRecord, RemoteEntry } from '../models/connectionModel';
import { Logger } from '../utils/logger';
import { normalizeRemotePath } from '../utils/validation';
import { ProtocolService } from './protocolService';

interface SftpListEntry {
  filename: string;
  attrs: {
    mode: number;
    size: number;
    mtime: number;
  };
}

export class SshService implements ProtocolService {
  constructor(private readonly logger: Logger) {}

  async testConnection(connection: ConnectionRecord): Promise<void> {
    await this.withClient(connection, async (client) => {
      if (connection.protocol === 'ssh') {
        await this.execProbeCommand(client);
      } else {
        const sftp = await this.getSftp(client);
        await this.readdir(sftp, normalizeRemotePath(connection.remotePath));
      }
    });
  }

  async listDirectory(connection: ConnectionRecord, remotePath: string): Promise<RemoteEntry[]> {
    const targetPath = normalizeRemotePath(remotePath);
    return this.withClient(connection, async (client) => {
      const sftp = await this.getSftp(client);
      const entries = await this.readdir(sftp, targetPath);
      return entries
        .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
        .map((entry) => {
          const normalizedPath = path.posix.join(targetPath, entry.filename);
          const item: RemoteEntry = {
            name: entry.filename,
            path: normalizedPath,
            type: this.isDirectory(entry.attrs.mode) ? 'directory' : 'file',
            size: Number(entry.attrs.size)
          };

          if (entry.attrs.mtime > 0) {
            item.modifiedAt = new Date(entry.attrs.mtime * 1000).toISOString();
          }

          return item;
        });
    });
  }

  async downloadFile(connection: ConnectionRecord, remotePath: string, localPath: string): Promise<void> {
    await this.withClient(connection, async (client) => {
      const sftp = await this.getSftp(client);
      await new Promise<void>((resolve, reject) => {
        sftp.fastGet(normalizeRemotePath(remotePath), localPath, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    });
  }

  async uploadFile(connection: ConnectionRecord, localPath: string, remotePath: string): Promise<void> {
    await this.withClient(connection, async (client) => {
      const sftp = await this.getSftp(client);
      await new Promise<void>((resolve, reject) => {
        sftp.fastPut(localPath, normalizeRemotePath(remotePath), (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    });
  }

  async deletePath(connection: ConnectionRecord, remotePath: string, isDirectory: boolean): Promise<void> {
    const sanitizedPath = normalizeRemotePath(remotePath);
    await this.withClient(connection, async (client) => {
      const sftp = await this.getSftp(client);

      await new Promise<void>((resolve, reject) => {
        const callback = (error?: Error | null): void => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        };

        if (isDirectory) {
          sftp.rmdir(sanitizedPath, callback);
          return;
        }

        sftp.unlink(sanitizedPath, callback);
      });
    });
  }

  async createFolder(connection: ConnectionRecord, remotePath: string): Promise<void> {
    const sanitizedPath = normalizeRemotePath(remotePath);
    await this.withClient(connection, async (client) => {
      const sftp = await this.getSftp(client);
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(sanitizedPath, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    });
  }

  async createFile(connection: ConnectionRecord, remotePath: string): Promise<void> {
    const sanitizedPath = normalizeRemotePath(remotePath);
    await this.withClient(connection, async (client) => {
      const sftp = await this.getSftp(client);
      const handle = await new Promise<Buffer>((resolve, reject) => {
        sftp.open(sanitizedPath, 'w', (error, openedHandle) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(openedHandle);
        });
      });

      await new Promise<void>((resolve, reject) => {
        sftp.close(handle, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    });
  }

  async movePath(connection: ConnectionRecord, sourcePath: string, destinationPath: string): Promise<void> {
    const source = normalizeRemotePath(sourcePath);
    const destination = normalizeRemotePath(destinationPath);
    await this.withClient(connection, async (client) => {
      const sftp = await this.getSftp(client);
      await new Promise<void>((resolve, reject) => {
        sftp.rename(source, destination, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    });
  }

  async setPermissions(connection: ConnectionRecord, remotePath: string, permissions: string): Promise<void> {
    const sanitizedPath = normalizeRemotePath(remotePath);
    const parsedPermissions = Number.parseInt(permissions, 8);
    if (!Number.isInteger(parsedPermissions)) {
      throw new Error('Permissions must be a valid octal value (e.g. 755).');
    }

    await this.withClient(connection, async (client) => {
      const sftp = await this.getSftp(client);
      await new Promise<void>((resolve, reject) => {
        sftp.chmod(sanitizedPath, parsedPermissions, (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    });
  }

  async copyPath(
    connection: ConnectionRecord,
    sourcePath: string,
    destinationPath: string,
    isDirectory: boolean
  ): Promise<void> {
    const source = normalizeRemotePath(sourcePath);
    const destination = normalizeRemotePath(destinationPath);
    const recursive = isDirectory ? '-R ' : '';
    const command = `cp ${recursive}-- ${this.shellQuote(source)} ${this.shellQuote(destination)}`;
    await this.withClient(connection, async (client) => {
      await this.execCommand(client, command);
    });
  }

  async compressPath(connection: ConnectionRecord, sourcePath: string, archivePath: string): Promise<void> {
    const source = normalizeRemotePath(sourcePath);
    const archive = normalizeRemotePath(archivePath);
    const command = `zip -r ${this.shellQuote(archive)} ${this.shellQuote(source)}`;
    await this.withClient(connection, async (client) => {
      await this.execCommand(client, command);
    });
  }

  async extractArchive(connection: ConnectionRecord, archivePath: string, destinationPath: string): Promise<void> {
    const archive = normalizeRemotePath(archivePath);
    const destination = normalizeRemotePath(destinationPath);
    const command = `unzip -o ${this.shellQuote(archive)} -d ${this.shellQuote(destination)}`;
    await this.withClient(connection, async (client) => {
      await this.execCommand(client, command);
    });
  }

  private async withClient<T>(connection: ConnectionRecord, operation: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.createClient(connection);
    try {
      return await operation(client);
    } finally {
      client.end();
    }
  }

  private async createClient(connection: ConnectionRecord): Promise<Client> {
    return new Promise<Client>((resolve, reject) => {
      const client = new Client();
      const onReady = (): void => {
        cleanup();
        resolve(client);
      };

      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };

      const cleanup = (): void => {
        client.removeListener('ready', onReady);
        client.removeListener('error', onError);
      };

      client.on('ready', onReady).on('error', onError);
      client.connect({
        host: connection.serverAddress,
        port: connection.port,
        username: connection.username,
        password: connection.password,
        readyTimeout: 20_000,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 2
      });
    });
  }

  private async getSftp(client: Client): Promise<SFTPWrapper> {
    return new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((error, sftp) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(sftp);
      });
    });
  }

  private async execProbeCommand(client: Client): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      client.exec('echo connection_ok', (error, channel) => {
        if (error) {
          reject(error);
          return;
        }

        channel.on('close', (code: number | null) => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error(`SSH probe command failed with exit code ${String(code)}`));
        });

        channel.stderr.on('data', (chunk: Buffer) => {
          this.logger.warn(`SSH stderr: ${chunk.toString('utf8').trim()}`);
        });
      });
    });
  }

  private async execCommand(client: Client, command: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      client.exec(command, (error, channel) => {
        if (error) {
          reject(error);
          return;
        }

        const stderrChunks: string[] = [];
        channel.stderr.on('data', (chunk: Buffer) => {
          stderrChunks.push(chunk.toString('utf8'));
        });

        channel.on('close', (code: number | null) => {
          if (code === 0) {
            resolve();
            return;
          }

          const stderr = stderrChunks.join('').trim();
          reject(new Error(stderr || `Command failed with exit code ${String(code)}`));
        });
      });
    });
  }

  private async readdir(sftp: SFTPWrapper, remotePath: string): Promise<SftpListEntry[]> {
    return new Promise<SftpListEntry[]>((resolve, reject) => {
      sftp.readdir(remotePath, (error, list) => {
        if (error) {
          reject(error);
          return;
        }

        const parsed = list.map((entry) => ({
          filename: entry.filename,
          attrs: {
            mode: entry.attrs.mode,
            size: entry.attrs.size,
            mtime: entry.attrs.mtime
          }
        }));

        resolve(parsed);
      });
    });
  }

  private isDirectory(mode: number): boolean {
    return (mode & 0o040000) === 0o040000;
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
  }
}
