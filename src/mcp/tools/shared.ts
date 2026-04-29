import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { Diagnostic, DocumentSymbol, Location, SymbolInformation } from 'vscode-languageserver-protocol';
import type { ZodTypeAny } from 'zod';

import type { LanguageServerHealth } from '../../lsp/lifecycle-manager';

import { pathToUri, uriToPath } from '../../utils/uri';

export interface ToolRegistrar {
  registerTool(
    name: string,
    config: { description?: string; inputSchema?: ZodTypeAny },
    handler: (args: Record<string, unknown>) => Promise<McpToolResult>
  ): void;
}

export interface MinimalLspClient {
  request(method: string, params: unknown, timeout: number): Promise<unknown>;
  notify(method: string, params: unknown): void;
  getCapabilities(): unknown;
}

export interface MinimalLifecycleManager {
  getClientForFile(filePath: string): MinimalLspClient | null;
  getReadyClients(language?: string): MinimalLspClient[];
  getFileDiagnostics(filePath: string): DiagnosticWithUri[];
  getWorkspaceDiagnostics(language?: string): DiagnosticWithUri[];
  getHealth(): LanguageServerHealth[];
}

export interface McpToolResult {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  raw: unknown;
  error?: true;
}

export type DiagnosticWithUri = Diagnostic & { uri?: string };

const openedFiles = new Set<string>();

export function success(text: string, raw: unknown): McpToolResult {
  return { content: [{ type: 'text', text }], raw };
}

export function failure(text: string, raw: unknown = null): McpToolResult {
  return { content: [{ type: 'text', text }], error: true, raw };
}

export async function ensureDidOpen(client: MinimalLspClient, filePath: string): Promise<void> {
  if (openedFiles.has(filePath)) {
    return;
  }

  const text = await readFile(filePath, 'utf8');
  client.notify('textDocument/didOpen', {
    textDocument: {
      uri: pathToUri(filePath),
      languageId: languageIdForFile(filePath),
      version: 1,
      text
    }
  });
  openedFiles.add(filePath);
}

export function clearOpenedFiles(): void {
  openedFiles.clear();
}

export function noServerResult(filePath: string): McpToolResult {
  return failure(`No language server available for ${path.extname(filePath) || 'unknown'} files. Run lsp_health for details.`);
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

function languageIdForFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const languageMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.py': 'python',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.cs': 'csharp',
    '.php': 'php',
    '.rb': 'ruby',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c'
  };

  return languageMap[ext] ?? 'plaintext';
}
