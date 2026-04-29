import type { ServerCapabilities } from 'vscode-languageserver-protocol';

import { findAvailableLsp, getLspCandidates, type LspCandidate } from '../detection/lsp-mapping';

import { installLsp } from './installer';
import { LspClient } from './lsp-client';

export type SupervisorStatus = 'ready' | 'error' | 'starting';

export interface ServerSupervisorHealth {
  language: string;
  status: SupervisorStatus;
  error?: string;
  capabilities?: ServerCapabilities;
}

type LogLevel = 'error' | 'info' | 'debug';

export class ServerSupervisor {
  public readonly language: string;
  public restartCount = 0;

  private client: LspClient | null = null;
  private status: SupervisorStatus = 'starting';
  private error: string | undefined = undefined;
  private capabilities: ServerCapabilities | undefined = undefined;
  private serverDef: LspCandidate | null = null;
  private healthInterval: NodeJS.Timeout | null = null;

  private readonly projectRoot: string;
  private readonly logLevel: LogLevel;
  private readonly onDiagnostics: (method: string, params: unknown) => void;
  private shuttingDown = false;

  public constructor(
    language: string,
    projectRoot: string,
    logLevel: LogLevel,
    onDiagnostics: (method: string, params: unknown) => void
  ) {
    this.language = language;
    this.projectRoot = projectRoot;
    this.logLevel = logLevel;
    this.onDiagnostics = onDiagnostics;
  }

  public async start(): Promise<void> {
    const serverDef = await this.resolveServer();
    if (!serverDef) {
      this.status = 'error';
      this.error = `No LSP server available for ${this.language}`;
      return;
    }

    this.serverDef = serverDef;
    const client = new LspClient(serverDef, this.projectRoot, this.logLevel);
    this.client = client;

    client.on('crash', async () => {
      if (this.shuttingDown) {
        return;
      }

      await this.restart(`LSP server crashed for ${this.language}`);
    });
    client.on('error', (error: unknown) => {
      this.status = 'error';
      this.error = error instanceof Error ? error.message : 'Unknown LSP error';
    });
    client.on('notification', (method: string, params: unknown) => {
      this.onDiagnostics(method, params);
    });

    try {
      await client.start();
      this.status = 'ready';
      this.error = undefined;
      this.capabilities = client.getCapabilities() ?? undefined;
      this.startHealthChecks();
    } catch (error) {
      this.status = 'error';
      this.error = error instanceof Error ? error.message : 'Unknown LSP startup error';
    }
  }

  public async restart(reason: string): Promise<void> {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }

    if (this.restartCount >= 3) {
      this.status = 'error';
      this.error = reason;
      this.client = null;
      return;
    }

    this.restartCount += 1;
    this.status = 'starting';
    this.error = reason;

    if (this.client) {
      try {
        await promiseWithTimeout(this.client.shutdown(), 5000, 'LSP shutdown timed out');
      } catch {
        // Ignore shutdown failures during restart.
      }
    }

    this.client = null;
    await this.start();
  }

  public async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }

    if (this.client) {
      await this.client.shutdown();
      this.client = null;
    }
  }

  public getClient(): LspClient | null {
    return this.client;
  }

  public getHealth(): ServerSupervisorHealth {
    return {
      language: this.language,
      status: this.status,
      error: this.error,
      capabilities: this.capabilities
    };
  }

  private startHealthChecks(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
    }

    this.healthInterval = setInterval(() => {
      void this.runHealthCheck();
    }, 30000);
  }

  private async runHealthCheck(): Promise<void> {
    if (!this.client || this.status !== 'ready') {
      return;
    }

    if (!this.client.isReady()) {
      await this.restart('LSP client lost ready state');
    }
  }

  private async resolveServer(): Promise<LspCandidate | null> {
    const available = await findAvailableLsp(this.language);
    if (available) {
      return available;
    }

    const candidate = getLspCandidates(this.language)[0] ?? null;
    if (!candidate) {
      return null;
    }

    const installation = await installLsp(candidate);
    if (!installation.success) {
      return null;
    }

    return candidate;
  }
}

async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
