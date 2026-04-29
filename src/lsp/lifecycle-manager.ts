import path from 'node:path';

import type { Diagnostic, ServerCapabilities } from 'vscode-languageserver-protocol';

import { detectLanguages } from '../detection/language-detector';
import { findAvailableLsp, getLspCandidates, type LspCandidate } from '../detection/lsp-mapping';
import { pathToUri, uriToPath } from '../utils/uri';

import { installLsp } from './installer';
import { LspClient } from './lsp-client';

export interface LanguageServerHealth {
  language: string;
  status: 'ready' | 'error' | 'starting';
  error?: string;
  capabilities?: ServerCapabilities;
}

interface LanguageState {
  language: string;
  client: LspClient | null;
  status: 'ready' | 'error' | 'starting';
  error?: string;
  capabilities?: ServerCapabilities;
  serverDef: LspCandidate | null;
  restartCount: number;
  healthInterval: NodeJS.Timeout | null;
}

type DiagnosticEntry = Diagnostic;

interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: DiagnosticEntry[];
}

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.cs': 'csharp',
  '.java': 'java',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.hpp': 'cpp',
  '.cc': 'cpp',
  '.rb': 'ruby',
  '.php': 'php',
  '.kt': 'kotlin',
  '.swift': 'swift'
};

export class LifecycleManager {
  private readonly projectRoot: string;
  private readonly logLevel: 'error' | 'info' | 'debug';
  private readonly states = new Map<string, LanguageState>();
  private readonly diagnostics = new Map<string, DiagnosticEntry[]>();

  public constructor(projectRoot: string, logLevel: string) {
    this.projectRoot = projectRoot;
    this.logLevel = normalizeLogLevel(logLevel);
  }

  public async start(languages?: string[]): Promise<void> {
    const startPromise = this.startInternal(languages);
    await promiseWithTimeout(startPromise, 30000, 'Lifecycle start timed out');
  }

  public async ensureLanguage(language: string): Promise<void> {
    if (this.states.has(language)) {
      return;
    }

    const state: LanguageState = {
      language,
      client: null,
      status: 'starting',
      serverDef: null,
      restartCount: 0,
      healthInterval: null
    };

    this.states.set(language, state);
    await this.startLanguage(state);
  }

  public async ensureLanguageForFile(filePath: string): Promise<void> {
    const language = EXTENSION_LANGUAGE_MAP[path.extname(filePath).toLowerCase()];
    if (language) {
      await this.ensureLanguage(language);
    }
  }

  public getClient(language: string): LspClient | null {
    return this.states.get(language)?.client ?? null;
  }

  public getClientForFile(filePath: string): LspClient | null {
    const language = EXTENSION_LANGUAGE_MAP[path.extname(filePath).toLowerCase()];
    if (language) {
      return this.getClient(language);
    }

    return null;
  }

  public getHealth(): LanguageServerHealth[] {
    return Array.from(this.states.values()).map((state) => ({
      language: state.language,
      status: state.status,
      error: state.error,
      capabilities: state.capabilities
    }));
  }

  public getReadyClients(language?: string): LspClient[] {
    return Array.from(this.states.values())
      .filter((state) => state.status === 'ready' && state.client && (!language || state.language === language))
      .flatMap((state) => state.client ? [state.client] : []);
  }

  public getFileDiagnostics(filePath: string): Array<DiagnosticEntry & { uri: string }> {
    const uri = pathToUri(filePath);
    return (this.diagnostics.get(uri) ?? []).map((diagnostic) => ({ ...diagnostic, uri }));
  }

  public getWorkspaceDiagnostics(language?: string): Array<DiagnosticEntry & { uri: string }> {
    const allowedExtensions = language
      ? Object.entries(EXTENSION_LANGUAGE_MAP)
        .filter(([, mappedLanguage]) => mappedLanguage === language)
        .map(([extension]) => extension)
      : null;

    return Array.from(this.diagnostics.entries())
      .filter(([uri]) => {
        if (!allowedExtensions) {
          return true;
        }

        return allowedExtensions.includes(path.extname(uriToPath(uri)).toLowerCase());
      })
      .flatMap(([uri, diagnostics]) => diagnostics.map((diagnostic) => ({ ...diagnostic, uri })))
      .sort((left, right) => (left.severity ?? 4) - (right.severity ?? 4));
  }

  public async shutdown(): Promise<void> {
    const clients = Array.from(this.states.values()).flatMap((state) => {
      if (state.healthInterval) {
        clearInterval(state.healthInterval);
        state.healthInterval = null;
      }

      return state.client ? [state.client] : [];
    });
    const results = await Promise.allSettled(clients.map(async (client) => await promiseWithTimeout(client.shutdown(), 5000, 'LSP shutdown timed out')));
    const errors = results.filter((result) => result.status === 'rejected').length;

    process.stderr.write(`{"timestamp":"${new Date().toISOString()}","level":"info","event":"Shutdown: ${clients.length - errors} LSP-Server beendet, ${errors} Fehler"}\n`);
  }

  private async startInternal(languages?: string[]): Promise<void> {
    const detected = languages
      ? languages.map((language) => ({ language }))
      : await detectLanguages(this.projectRoot);

    for (const entry of detected) {
      const state: LanguageState = {
        language: entry.language,
        client: null,
        status: 'starting',
        serverDef: null,
        restartCount: 0,
        healthInterval: null
      };

      this.states.set(entry.language, state);
      await this.startLanguage(state);
    }
  }

  private async startLanguage(state: LanguageState): Promise<void> {
    const serverDef = await this.resolveServer(state.language);
    if (!serverDef) {
      state.status = 'error';
      state.error = `No LSP server available for ${state.language}`;
      return;
    }

    state.serverDef = serverDef;
    const client = new LspClient(serverDef, this.projectRoot, this.logLevel);
    state.client = client;
    client.on('crash', async () => {
      await this.restartLanguage(state, `LSP server crashed for ${state.language}`);
    });
    client.on('error', (error) => {
      state.status = 'error';
      state.error = error instanceof Error ? error.message : 'Unknown LSP error';
    });
    client.on('notification', (method: string, params: unknown) => {
      if (method === 'textDocument/publishDiagnostics') {
        this.storeDiagnostics(params);
      }
    });

    try {
      await client.start();
      state.status = 'ready';
      state.error = undefined;
      state.capabilities = client.getCapabilities() ?? undefined;
      this.startHealthChecks(state);
    } catch (error) {
      state.status = 'error';
      state.error = error instanceof Error ? error.message : 'Unknown LSP startup error';
    }
  }

  private startHealthChecks(state: LanguageState): void {
    if (state.healthInterval) {
      clearInterval(state.healthInterval);
    }

    state.healthInterval = setInterval(() => {
      void this.runHealthCheck(state);
    }, 30000);
  }

  private async runHealthCheck(state: LanguageState): Promise<void> {
    if (!state.client || state.status !== 'ready') {
      return;
    }

    try {
      await state.client.request('workspace/symbol', { query: '__lsp_mcp_healthcheck__' }, 5000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LSP health check failed';
      await this.restartLanguage(state, message);
    }
  }

  private async restartLanguage(state: LanguageState, reason: string): Promise<void> {
    if (state.healthInterval) {
      clearInterval(state.healthInterval);
      state.healthInterval = null;
    }

    if (state.restartCount >= 3) {
      state.status = 'error';
      state.error = reason;
      state.client = null;
      return;
    }

    state.restartCount += 1;
    state.status = 'starting';
    state.error = reason;

    if (state.client) {
      try {
        await promiseWithTimeout(state.client.shutdown(), 5000, 'LSP shutdown timed out');
      } catch {
        // Ignore shutdown failures during restart.
      }
    }

    state.client = null;
    await this.startLanguage(state);
  }

  private async resolveServer(language: string): Promise<LspCandidate | null> {
    const available = await findAvailableLsp(language);
    if (available) {
      return available;
    }

    const candidate = getLspCandidates(language)[0] ?? null;
    if (!candidate) {
      return null;
    }

    const installation = await installLsp(candidate);
    if (!installation.success) {
      return null;
    }

    return candidate;
  }

  private storeDiagnostics(params: unknown): void {
    if (!isPublishDiagnosticsParams(params)) {
      return;
    }

    this.diagnostics.set(params.uri, cloneDiagnostics(params.diagnostics));
  }
}

function normalizeLogLevel(level: string): 'error' | 'info' | 'debug' {
  if (level === 'error' || level === 'debug') {
    return level;
  }

  return 'info';
}

function isPublishDiagnosticsParams(value: unknown): value is PublishDiagnosticsParams {
  return typeof value === 'object' && value !== null
    && 'uri' in value && typeof value.uri === 'string'
    && 'diagnostics' in value && Array.isArray(value.diagnostics);
}

function cloneDiagnostics(diagnostics: DiagnosticEntry[]): DiagnosticEntry[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    range: {
      start: { ...diagnostic.range.start },
      end: { ...diagnostic.range.end }
    }
  }));
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
