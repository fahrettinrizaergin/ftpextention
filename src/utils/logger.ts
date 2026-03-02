import * as vscode from 'vscode';

export class Logger {
  private readonly outputChannel: vscode.OutputChannel;

  constructor(channelName = 'FTP Extension') {
    this.outputChannel = vscode.window.createOutputChannel(channelName);
  }

  info(message: string): void {
    this.log('INFO', message);
  }

  warn(message: string): void {
    this.log('WARN', message);
  }

  error(message: string, error?: unknown): void {
    const details = this.formatError(error);
    this.log('ERROR', details ? `${message}: ${details}` : message);
  }

  dispose(): void {
    this.outputChannel.dispose();
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR', message: string): void {
    const timestamp = new Date().toISOString();
    this.outputChannel.appendLine(`[${timestamp}] [${level}] ${message}`);
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'string') {
      return error;
    }

    if (error === undefined || error === null) {
      return '';
    }

    return JSON.stringify(error);
  }
}
