import * as path from 'node:path';
import { ConnectionInput, ConnectionProtocol, ValidationResult } from '../models/connectionModel';

const CONTROL_CHARS = /[\u0000-\u001F\u007F]/g;
const HOST_PATTERN = /^[a-zA-Z0-9._:-]+$/;

export function defaultPortForProtocol(protocol: ConnectionProtocol): number {
  switch (protocol) {
    case 'ssh':
    case 'sftp':
      return 22;
    case 'ftp':
      return 21;
  }
}

export function sanitizeText(value: string): string {
  return value.replace(CONTROL_CHARS, '').trim();
}

export function sanitizeConnectionInput(input: ConnectionInput): ConnectionInput {
  const protocol = input.protocol;
  const sanitized: ConnectionInput = {
    ...input,
    protocol,
    serverAddress: sanitizeText(input.serverAddress),
    username: sanitizeText(input.username),
    password: input.password,
    remotePath: normalizeRemotePath(sanitizeText(input.remotePath)),
    localPath: sanitizeLocalPath(input.localPath),
    port: Number(input.port)
  };

  const sanitizedName = input.name ? sanitizeText(input.name) : '';
  if (sanitizedName) {
    sanitized.name = sanitizedName;
  }

  return sanitized;
}

export function validateConnectionInput(input: ConnectionInput, options?: { requirePassword?: boolean }): ValidationResult {
  const errors: string[] = [];
  const requirePassword = options?.requirePassword ?? true;

  if (!input.serverAddress) {
    errors.push('Server address is required.');
  } else if (!HOST_PATTERN.test(input.serverAddress)) {
    errors.push('Server address contains unsupported characters.');
  }

  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    errors.push('Port must be between 1 and 65535.');
  }

  if (!input.username) {
    errors.push('Username is required.');
  }

  if (requirePassword && !input.password) {
    errors.push('Password is required.');
  }

  if (!input.remotePath) {
    errors.push('Remote path is required.');
  }

  if (!input.localPath) {
    errors.push('Local path is required.');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

export function normalizeRemotePath(remotePath: string): string {
  if (!remotePath) {
    return '/';
  }

  const normalized = path.posix.normalize(remotePath.replace(/\\\\/g, '/'));
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function sanitizeLocalPath(localPath: string): string {
  const cleaned = sanitizeText(localPath);
  if (!cleaned) {
    return '';
  }

  return path.normalize(cleaned);
}

export function sanitizeRemoteSegment(segment: string): string {
  const sanitized = sanitizeText(segment).replace(/[\\/]/g, '');
  return sanitized;
}
