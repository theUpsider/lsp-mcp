import path from 'node:path';

import type { Diagnostic, DocumentSymbol, Location, SymbolInformation } from 'vscode-languageserver-protocol';
import type { ZodType } from 'zod';

import type { LanguageServerHealth } from '../../lsp/lifecycle-manager';

import { uriToPath } from '../../utils/uri';

export interface ToolRegistrar {
  registerTool(
    name: string,
    config: { description?: string; inputSchema?: ZodType },
    handler: (args: Record<string, unknown>) => Promise<McpToolResult>
  ): void;
}

export interface MinimalLspClient {
  request(method: string, params: unknown, timeout: number): Promise<unknown>;
  notify(method: string, params: unknown): void;
  getCapabilities(): unknown;
  ensureDidOpen(filePath: string): Promise<void>;
  waitForDiagnosticsPublish(filePath: string, timeoutMs: number): Promise<void>;
  ensureSeedFileOpen(extensions: string[]): Promise<void>;
}

export interface MinimalLifecycleManager {
  getClientForFile(filePath: string): MinimalLspClient | null;
  getReadyClients(language?: string): MinimalLspClient[];
  getFileDiagnostics(filePath: string): DiagnosticWithUri[];
  getWorkspaceDiagnostics(language?: string): DiagnosticWithUri[];
  getHealth(): LanguageServerHealth[];
  ensureLanguageForFile(filePath: string): Promise<void>;
  ensureSeedFilesOpen(): Promise<void>;
}

export interface McpToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  raw: unknown;
  text?: string;
  error?: true;
}

export type DiagnosticWithUri = Diagnostic & { uri?: string };

export function success(text: string, raw: unknown): McpToolResult {
  return { content: [{ type: 'text', text }], raw };
}

export function failure(text: string, raw: unknown = null): McpToolResult {
  return { content: [{ type: 'text', text }], error: true, raw };
}

export function noServerResult(filePath: string): McpToolResult {
  return failure(`No language server available for ${path.extname(filePath) || 'unknown'} files. Run lsp_health for details.`);
}

export function noProjectRootResult(): McpToolResult {
  const text = "No project root set. Call lsp_init({ root: '/path/to/project' }) first.";
  return { content: [{ type: 'text', text }], text, error: true, raw: null };
}

export function mapToolError(error: unknown, timeoutSeconds: number): McpToolResult {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('timed out')) {
    return failure(`Operation timed out after ${timeoutSeconds}s — try a more specific query or check the LSP server health`);
  }

  if (message.includes('LSP server exited')) {
    return failure('Der Language Server ist neu gestartet, bitte versuche es erneut.');
  }

  return failure(message, error);
}

export function normalizeLocations(locations: Location[] | null): Array<{ path: string; range: Location['range'] }> | null {
  if (!locations || locations.length === 0) {
    return null;
  }

  return locations.map((location) => ({ path: uriToPath(location.uri), range: location.range }));
}

export function normalizeSymbols(symbols: Array<DocumentSymbol | SymbolInformation> | null): Array<Record<string, unknown>> | null {
  if (!symbols || symbols.length === 0) {
    return null;
  }

  const normalized: Array<Record<string, unknown>> = [];
  for (const symbol of symbols) {
    if ('location' in symbol) {
      normalized.push({
        name: symbol.name,
        kind: symbol.kind,
        path: uriToPath(symbol.location.uri),
        range: symbol.location.range
      });
      continue;
    }

    normalized.push({ name: symbol.name, kind: symbol.kind, range: symbol.range, selectionRange: symbol.selectionRange });
  }

  return normalized;
}

