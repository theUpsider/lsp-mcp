import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

import type { LspCandidate } from '../detection/lsp-mapping';
import type { InitializeResult } from 'vscode-languageserver-protocol';

import { extensionToLanguageId } from '../detection/language-registry';
import { pathToUri } from '../utils/uri';

type LogLevel = 'error' | 'info' | 'debug';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

interface JsonRpcSuccessResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: '2.0';
  id: number | null;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcSuccessResponse | JsonRpcErrorResponse;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutHandle: NodeJS.Timeout;
}

export class LspClient extends EventEmitter {
  private readonly serverDef: LspCandidate;
  private readonly projectRoot: string;
  private readonly logLevel: LogLevel;
  private process: ChildProcessWithoutNullStreams | null = null;
  private nextRequestId = 1;
  private ready = false;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private buffer = Buffer.alloc(0);
  private contentLength: number | null = null;
  private exitExpected = false;
  private initializeResult: InitializeResult | null = null;
  private forcedKillTimer: NodeJS.Timeout | null = null;
  private readonly openedFiles = new Set<string>();

  public constructor(serverDef: LspCandidate, projectRoot: string, logLevel: LogLevel) {
    super();
    this.serverDef = serverDef;
    this.projectRoot = projectRoot;
    this.logLevel = logLevel;
  }

  public async start(): Promise<void> {
    if (this.process) {
      return;
    }

    this.process = spawn(this.serverDef.cmd, this.serverDef.args, {
      cwd: this.projectRoot,
      env: { ...process.env },
      stdio: 'pipe'
    });

    this.process.stdout.on('data', (chunk: Buffer | string) => {
      this.handleData(chunk);
    });
    this.process.on('error', (error) => {
      this.log('error', 'lsp_process_error', { error: error.message });
      this.emit('error', error);
    });
    this.process.on('exit', (code, signal) => {
      this.handleExit(code, signal);
    });

    this.log('info', 'lsp_starting', { language: this.serverDef.cmd });

    const initializeResult = await this.request<InitializeResult>('initialize', {
      processId: process.pid,
      clientInfo: { name: 'lsp-mcp', version: '0.1.0' },
      rootUri: pathToUri(this.projectRoot),
      workspaceFolders: [
        {
          uri: pathToUri(this.projectRoot),
          name: path.basename(this.projectRoot)
        }
      ],
      capabilities: {}
    }, 30000);

    this.initializeResult = initializeResult;
    this.notify('initialized', {});
    this.ready = true;
    this.log('info', 'lsp_ready', { language: this.serverDef.cmd });
  }

  public isReady(): boolean {
    return this.ready;
  }

  public async request<T>(method: string, params: unknown, timeout: number): Promise<T> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const message: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    };

    return await new Promise<T>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`LSP request timed out: ${method}`));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeoutHandle
      });

      this.sendMessage(message);
    });
  }

  public notify(method: string, params: unknown): void {
    const message: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params
    };

    this.sendMessage(message);
  }

  public async shutdown(): Promise<void> {
    this.exitExpected = true;
    if (!this.process) {
      this.ready = false;
      return;
    }

    await this.request('shutdown', {}, 5000);
    this.notify('exit', {});
    this.ready = false;
    const currentProcess = this.process;
    this.forcedKillTimer = setTimeout(() => {
      currentProcess.kill('SIGKILL');
    }, 5000);
  }

  public getCapabilities(): InitializeResult['capabilities'] | null {
    return this.initializeResult?.capabilities ?? null;
  }

  public async ensureDidOpen(filePath: string): Promise<void> {
    if (this.openedFiles.has(filePath)) {
      return;
    }

    const text = await readFile(filePath, 'utf8');
    this.notify('textDocument/didOpen', {
      textDocument: {
        uri: pathToUri(filePath),
        languageId: extensionToLanguageId(path.extname(filePath)),
        version: 1,
        text
      }
    });
    this.openedFiles.add(filePath);
  }

  private sendMessage(message: JsonRpcMessage): void {
    if (!this.process) {
      throw new Error('LSP process is not running');
    }

    const body = JSON.stringify(message);
    const content = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
    this.process.stdin.write(content);
  }

  private handleData(chunk: Buffer | string): void {
    const incoming = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
    this.buffer = Buffer.concat([this.buffer, incoming]);

    while (true) {
      if (this.contentLength === null) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          return;
        }

        const header = this.buffer.subarray(0, headerEnd).toString('utf8');
        this.buffer = this.buffer.subarray(headerEnd + 4);
        const contentLengthLine = header
          .split('\r\n')
          .find((line) => line.toLowerCase().startsWith('content-length:'));

        if (!contentLengthLine) {
          const error = new Error('Missing Content-Length header');
          this.emit('error', error);
          return;
        }

        const value = Number.parseInt(contentLengthLine.slice('Content-Length:'.length).trim(), 10);
        this.contentLength = value;
      }

      if (this.buffer.byteLength < this.contentLength) {
        return;
      }

      const messageBody = this.buffer.subarray(0, this.contentLength).toString('utf8');
      this.buffer = this.buffer.subarray(this.contentLength);
      this.contentLength = null;
      this.handleMessage(JSON.parse(messageBody) as JsonRpcMessage);
    }
  }

  private handleMessage(message: JsonRpcMessage): void {
    if (!message || typeof message !== 'object') {
      return;
    }

    if ('method' in message) {
      this.emit('notification', message.method, message.params);
      return;
    }

    if ('id' in message && 'error' in message && message.id !== null) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutHandle);
      this.pendingRequests.delete(message.id);
      pending.reject(new Error(message.error.message));
      return;
    }

    if ('id' in message && 'result' in message) {
      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }

      clearTimeout(pending.timeoutHandle);
      this.pendingRequests.delete(message.id);
      pending.resolve(message.result);
    }
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.forcedKillTimer) {
      clearTimeout(this.forcedKillTimer);
      this.forcedKillTimer = null;
    }

    this.rejectAllPending(new Error(`LSP server exited (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`));
    this.ready = false;
    this.process = null;

    if (!this.exitExpected) {
      const error = new Error(`LSP server exited unexpectedly (code: ${code ?? 'null'}, signal: ${signal ?? 'null'})`);
      this.log('error', 'lsp_crash', { error: error.message, language: this.serverDef.cmd });
      this.emit('crash', error);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pendingRequests.entries()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
  }

  private log(level: LogLevel, event: string, extra: Partial<LogPayload>): void {
    if (!shouldLog(this.logLevel, level)) {
      return;
    }

    const payload: LogPayload = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...extra
    };

    process.stderr.write(`${JSON.stringify(payload)}\n`);
  }
}

interface LogPayload {
  timestamp: string;
  level: LogLevel;
  event: string;
  language?: string;
  error?: string;
  durationMs?: number;
}

function shouldLog(configuredLevel: LogLevel, messageLevel: LogLevel): boolean {
  const order: Record<LogLevel, number> = {
    error: 0,
    info: 1,
    debug: 2
  };

  return order[messageLevel] <= order[configuredLevel];
}
