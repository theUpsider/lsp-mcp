import type { CompletionItem, CompletionList, Hover, Location, SymbolInformation } from 'vscode-languageserver-protocol';
import { z } from 'zod';

import {
  formatCompletion,
  formatDefinition,
  formatDiagnostics,
  formatHealth,
  formatHover,
  formatReferences,
  formatSymbols
} from '../formatters';
import { pathToUri } from '../../utils/uri';

import {
  ensureDidOpen,
  mapToolError,
  noServerResult,
  normalizeLocations,
  normalizeSymbols,
  success,
  type MinimalLifecycleManager,
  type ToolRegistrar
} from './shared';

export function registerReadTools(registrar: ToolRegistrar, lifecycleManager: MinimalLifecycleManager): void {
  registrar.registerTool('lsp_hover', { description: 'Show hover information', inputSchema: positionSchema }, async (args) => {
    return await runFileRequest({ args, lifecycleManager, method: 'textDocument/hover', timeoutMs: 5000, format: formatHover, raw: (result) => result });
  });

  registrar.registerTool('lsp_definition', { description: 'Find definitions', inputSchema: positionSchema }, async (args) => {
    return await runFileRequest<Location[] | Location | null>({
      args,
      lifecycleManager,
      method: 'textDocument/definition',
      timeoutMs: 5000,
      format: (result) => formatDefinition(asLocationArray(result)),
      raw: (result) => normalizeLocations(asLocationArray(result))
    });
  });

  registrar.registerTool('lsp_references', { description: 'Find references', inputSchema: positionSchema.extend({ includeDeclaration: z.boolean().optional() }) }, async (args) => {
    const includeDeclaration = args.includeDeclaration === true;
    return await runFileRequest<Location[] | null>({
      args,
      lifecycleManager,
      method: 'textDocument/references',
      timeoutMs: 15000,
      params: (uri, position) => ({ textDocument: { uri }, position, context: { includeDeclaration } }),
      format: formatReferences,
      raw: normalizeLocations
    });
  });

  registrar.registerTool('lsp_document_symbols', { description: 'List document symbols', inputSchema: z.object({ file: z.string() }) }, async (args) => {
    return await runFileRequest({
      args,
      lifecycleManager,
      method: 'textDocument/documentSymbol',
      timeoutMs: 15000,
      format: formatSymbols,
      raw: normalizeSymbols
    });
  });

  registrar.registerTool('lsp_workspace_symbols', { description: 'Search workspace symbols', inputSchema: z.object({ query: z.string().default('') }) }, async (args) => {
    const query = typeof args.query === 'string' ? args.query : '';
    const results = await Promise.all(lifecycleManager.getReadyClients().map(async (client) => {
      return await client.request('workspace/symbol', { query }, 30000) as SymbolInformation[];
    }));
    const merged = results.flat().slice(0, query === '' ? 100 : 500);
    return success(formatSymbols(merged), normalizeSymbols(merged));
  });

  registrar.registerTool('lsp_completion', { description: 'Get completions', inputSchema: positionSchema }, async (args) => {
    return await runFileRequest<CompletionItem[] | CompletionList | null>({
      args,
      lifecycleManager,
      method: 'textDocument/completion',
      timeoutMs: 5000,
      format: (result) => formatCompletion(asCompletionItems(result)),
      raw: (result) => asCompletionItems(result)?.slice(0, 50) ?? null
    });
  });

  registrar.registerTool('lsp_diagnostics', { description: 'Show diagnostics', inputSchema: z.object({ file: z.string().optional(), scope: z.enum(['file', 'workspace']).default('file'), language: z.string().optional() }) }, async (args) => {
    const scope = args.scope === 'workspace' ? 'workspace' : 'file';
    if (scope === 'workspace') {
      const language = typeof args.language === 'string' ? args.language : undefined;
      const diagnostics = lifecycleManager.getWorkspaceDiagnostics(language).slice(0, 200);
      return success(formatDiagnostics(diagnostics, 'workspace'), diagnostics);
    }

    const filePath = typeof args.file === 'string' ? args.file : '';
    const diagnostics = lifecycleManager.getFileDiagnostics(filePath);
    return success(formatDiagnostics(diagnostics, 'file'), diagnostics);
  });

  registrar.registerTool('lsp_signature_help', { description: 'Show signature help', inputSchema: positionSchema }, async (args) => {
    return await runFileRequest({ args, lifecycleManager, method: 'textDocument/signatureHelp', timeoutMs: 5000, format: stringifyResult, raw: (result) => result });
  });

  registrar.registerTool('lsp_type_definition', { description: 'Find type definitions', inputSchema: positionSchema }, async (args) => {
    return await runFileRequest<Location[] | Location | null>({
      args,
      lifecycleManager,
      method: 'textDocument/typeDefinition',
      timeoutMs: 5000,
      format: (result) => formatDefinition(asLocationArray(result)),
      raw: (result) => normalizeLocations(asLocationArray(result))
    });
  });

  registrar.registerTool('lsp_implementation', { description: 'Find implementations', inputSchema: positionSchema }, async (args) => {
    return await runFileRequest<Location[] | Location | null>({
      args,
      lifecycleManager,
      method: 'textDocument/implementation',
      timeoutMs: 5000,
      format: (result) => formatDefinition(asLocationArray(result)),
      raw: (result) => normalizeLocations(asLocationArray(result))
    });
  });

  registrar.registerTool('lsp_health', { description: 'Show LSP server health', inputSchema: z.object({}) }, async () => {
    const health = lifecycleManager.getHealth();
    return success(formatHealth(health), health);
  });
}

const positionSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  character: z.number().int()
});

async function runFileRequest<T>(options: {
  args: Record<string, unknown>;
  lifecycleManager: MinimalLifecycleManager;
  method: string;
  timeoutMs: number;
  format: (result: T | null) => string;
  raw: (result: T | null) => unknown;
  params?: (uri: string, position: { line: number; character: number }) => unknown;
}): Promise<ReturnType<typeof success>> {
  const filePath = typeof options.args.file === 'string' ? options.args.file : '';
  const client = options.lifecycleManager.getClientForFile(filePath);
  if (!client) {
    return noServerResult(filePath);
  }

  const position = {
    line: Number(options.args.line ?? 0),
    character: Number(options.args.character ?? 0)
  };
  const uri = pathToUri(filePath);

  try {
    await ensureDidOpen(client, filePath);
    const result = await client.request(options.method, options.params?.(uri, position) ?? {
      textDocument: { uri },
      position
    }, options.timeoutMs) as T | null;
    return success(options.format(result), options.raw(result));
  } catch (error) {
    return mapToolError(error, options.timeoutMs / 1000);
  }
}

function asLocationArray(result: Location[] | Location | null): Location[] | null {
  if (!result) {
    return null;
  }

  return Array.isArray(result) ? result : [result];
}

function asCompletionItems(result: CompletionItem[] | CompletionList | null): CompletionItem[] | null {
  if (!result) {
    return null;
  }

  return Array.isArray(result) ? result : result.items;
}

function stringifyResult(result: unknown): string {
  if (!result) {
    return 'No result';
  }

  return JSON.stringify(result, null, 2);
}
