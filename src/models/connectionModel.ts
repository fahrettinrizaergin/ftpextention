export type ConnectionProtocol = 'ssh' | 'sftp' | 'ftp';

export interface ConnectionInput {
  protocol: ConnectionProtocol;
  serverAddress: string;
  port: number;
  username: string;
  password: string;
  remotePath: string;
  localPath: string;
  name?: string;
}

export interface ConnectionMetadata {
  id: string;
  name: string;
  protocol: ConnectionProtocol;
  serverAddress: string;
  port: number;
  username: string;
  remotePath: string;
  localPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectionRecord extends ConnectionMetadata {
  password: string;
}

export type RemoteEntryType = 'file' | 'directory';

export interface RemoteEntry {
  name: string;
  path: string;
  type: RemoteEntryType;
  size: number;
  modifiedAt?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface FileDeleteRequest {
  connectionId: string;
  remotePath: string;
  isDirectory: boolean;
}
