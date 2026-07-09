import path from "node:path";

import type {
  Diagnostic,
  ServerCapabilities,
} from "vscode-languageserver-protocol";

import { detectLanguages } from "../detection/language-detector";
import {
  extensionToLanguage,
  extensionsForLanguage,
} from "../detection/language-registry";
import { getLinterCandidates } from "../detection/lsp-mapping";

import { DiagnosticStore } from "./diagnostic-store";
import { LspClient } from "./lsp-client";
import { ServerSupervisor } from "./server-supervisor";

export interface LanguageServerHealth {
  language: string;
  status: "ready" | "error" | "starting";
  error?: string;
  capabilities?: ServerCapabilities;
}

export interface WorkspaceAnalysisSummary {
  perLanguage: Array<{
    language: string;
    opened: number;
    failed: number;
    truncated: boolean;
    error?: string;
  }>;
}

export class LifecycleManager {
  private readonly projectRoot: string;
  private readonly logLevel: "error" | "info" | "debug";
  private readonly supervisors = new Map<string, ServerSupervisor>();
  // Secondary servers that run alongside the primary one for a language purely to
  // contribute diagnostics (e.g. ruff's lint rules alongside pyright's type checks).
  // They are never returned by getClient/getReadyClients, which stay scoped to the
  // primary server so navigation/formatting/rename requests keep going to one place.
  private readonly linterSupervisors = new Map<string, ServerSupervisor>();
  private readonly store = new DiagnosticStore();

  public constructor(projectRoot: string, logLevel: string) {
    this.projectRoot = projectRoot;
    this.logLevel = normalizeLogLevel(logLevel);
  }

  public async start(languages?: string[]): Promise<void> {
    const startPromise = this.startInternal(languages);
    await promiseWithTimeout(startPromise, 30000, "Lifecycle start timed out");
  }

  public async ensureLanguage(language: string): Promise<void> {
    if (!this.supervisors.has(language)) {
      const supervisor = this.createSupervisor(language);
      this.supervisors.set(language, supervisor);
      await supervisor.start();
    }

    await this.ensureLinter(language);
  }

  public async ensureLanguageForFile(filePath: string): Promise<void> {
    const language = extensionToLanguage(path.extname(filePath));
    if (language) {
      await this.ensureLanguage(language);
    }
  }

  public getClient(language: string): LspClient | null {
    return this.supervisors.get(language)?.getClient() ?? null;
  }

  public getClientForFile(filePath: string): LspClient | null {
    const language = extensionToLanguage(path.extname(filePath));
    if (language) {
      return this.getClient(language);
    }

    return null;
  }

  // All ready clients contributing diagnostics for a file's language: the primary
  // language server plus any linter servers (e.g. ruff for python). Used so a single
  // lsp_diagnostics(file) call opens/saves the file on every diagnostic source instead
  // of only the primary one.
  public getDiagnosticClientsForFile(filePath: string): LspClient[] {
    const language = extensionToLanguage(path.extname(filePath));
    if (!language) {
      return [];
    }

    return [this.supervisors.get(language), this.linterSupervisors.get(language)]
      .filter((supervisor): supervisor is ServerSupervisor => {
        return !!supervisor && supervisor.getHealth().status === "ready";
      })
      .flatMap((supervisor) => {
        const client = supervisor.getClient();
        return client ? [client] : [];
      });
  }

  public getHealth(): LanguageServerHealth[] {
    return this.allSupervisors().map((supervisor) => supervisor.getHealth());
  }

  public getReadyClients(language?: string): LspClient[] {
    return Array.from(this.supervisors.values())
      .filter((supervisor) => {
        const health = supervisor.getHealth();
        return (
          health.status === "ready" &&
          (!language || supervisor.language === language)
        );
      })
      .flatMap((supervisor) => {
        const client = supervisor.getClient();
        return client ? [client] : [];
      });
  }

  public getFileDiagnostics(
    filePath: string,
  ): Array<Diagnostic & { uri: string }> {
    return this.store.getForFile(filePath);
  }

  public getWorkspaceDiagnostics(
    language?: string,
  ): Array<Diagnostic & { uri: string }> {
    return this.store.getForWorkspace(language);
  }

  public async analyzeWorkspace(
    language?: string,
  ): Promise<WorkspaceAnalysisSummary> {
    const results = await Promise.allSettled(
      this.allSupervisorEntries()
        .filter(([lang, supervisor]) => {
          const health = supervisor.getHealth();
          return health.status === "ready" && (!language || lang === language);
        })
        .map(async ([lang, supervisor]) => {
          const client = supervisor.getClient();
          if (!client) {
            return { language: lang, opened: 0, failed: 0, truncated: false };
          }

          const extensions = extensionsForLanguage(lang);
          try {
            const scan = await client.openAllFilesForDiagnostics(extensions);
            return { language: lang, ...scan };
          } catch (error) {
            return {
              language: lang,
              opened: 0,
              failed: 0,
              truncated: false,
              error: error instanceof Error ? error.message : String(error),
            };
          }
        }),
    );

    return {
      perLanguage: results.map((result) =>
        result.status === "fulfilled"
          ? result.value
          : {
              language: "unknown",
              opened: 0,
              failed: 0,
              truncated: false,
              error:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            },
      ),
    };
  }

  public async ensureSeedFilesOpen(): Promise<void> {
    await Promise.all(
      this.allSupervisorEntries().map(async ([language, supervisor]) => {
        const client = supervisor.getClient();
        if (!client) return;
        const extensions = extensionsForLanguage(language);
        await client.ensureSeedFileOpen(extensions);
      }),
    );
  }

  public async shutdown(): Promise<void> {
    const supervisors = this.allSupervisors();
    const results = await Promise.allSettled(
      supervisors.map(
        async (supervisor) =>
          await promiseWithTimeout(
            supervisor.shutdown(),
            5000,
            "LSP shutdown timed out",
          ),
      ),
    );
    const errors = results.filter(
      (result) => result.status === "rejected",
    ).length;

    process.stderr.write(
      `{"timestamp":"${new Date().toISOString()}","level":"info","event":"Shutdown: ${supervisors.length - errors} LSP-Server beendet, ${errors} Fehler"}\n`,
    );
  }

  private async startInternal(languages?: string[]): Promise<void> {
    const detected = languages
      ? languages.map((language) => ({ language }))
      : await detectLanguages(this.projectRoot);

    for (const entry of detected) {
      const supervisor = this.createSupervisor(entry.language);
      this.supervisors.set(entry.language, supervisor);
      await supervisor.start();
      await this.ensureLinter(entry.language);
    }
  }

  private async ensureLinter(language: string): Promise<void> {
    if (this.linterSupervisors.has(language)) {
      return;
    }

    if (getLinterCandidates(language).length === 0) {
      return;
    }

    const supervisor = this.createSupervisor(language, true);
    this.linterSupervisors.set(language, supervisor);
    await supervisor.start();
  }

  private allSupervisors(): ServerSupervisor[] {
    return this.allSupervisorEntries().map(([, supervisor]) => supervisor);
  }

  private allSupervisorEntries(): Array<[string, ServerSupervisor]> {
    return [
      ...Array.from(this.supervisors.entries()),
      ...Array.from(this.linterSupervisors.entries()),
    ];
  }

  private createSupervisor(language: string, linter = false): ServerSupervisor {
    const sourceId = linter ? `${language}:lint` : language;
    return new ServerSupervisor(
      language,
      this.projectRoot,
      this.logLevel,
      (method, params) => {
        if (method === "textDocument/publishDiagnostics") {
          this.store.store(sourceId, params);
        }
      },
      linter,
    );
  }
}

function normalizeLogLevel(level: string): "error" | "info" | "debug" {
  if (level === "error" || level === "debug") {
    return level;
  }

  return "info";
}

export async function promiseWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
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
      },
    );
  });
}
