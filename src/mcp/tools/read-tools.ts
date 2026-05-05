import { stat } from "node:fs/promises";
import path from "node:path";

import type {
  CompletionItem,
  CompletionList,
  Location,
  SymbolInformation,
} from "vscode-languageserver-protocol";
import { z } from "zod";

import {
  formatCompletion,
  formatDefinition,
  formatDiagnostics,
  formatHealth,
  formatHover,
  formatReferences,
  formatSymbols,
} from "../formatters";
import { pathToUri } from "../../utils/uri";

import {
  failure,
  mapToolError,
  noServerResult,
  normalizeLocations,
  normalizeSymbols,
  success,
  type McpToolResult,
  type MinimalLifecycleManager,
  type ToolRegistrar,
} from "./shared";

import type { LanguageServerHealth } from "../../lsp/lifecycle-manager";

interface ReadToolOptions {
  initializeManager(
    root: string,
    languages?: string[],
  ): Promise<{ root: string; health: LanguageServerHealth[] }>;
}

export function registerReadTools(
  registrar: ToolRegistrar,
  lifecycleManager: MinimalLifecycleManager,
  options: ReadToolOptions,
): void {
  registrar.registerTool(
    "lsp_init",
    {
      description:
        "Initialize LSP for a project root. Pass languages to pre-warm specific servers; omit to auto-detect from project files (lazy startup per file if none found).",
      inputSchema: z.object({
        root: z.string(),
        languages: z.array(z.string()).optional(),
      }),
    },
    async (args) => {
      return await handleInitTool(args, options);
    },
  );

  registrar.registerTool(
    "lsp_hover",
    { description: "Show hover information", inputSchema: positionSchema },
    async (args) => {
      return await runFileRequest({
        args,
        lifecycleManager,
        method: "textDocument/hover",
        timeoutMs: 5000,
        format: formatHover,
        raw: (result) => result,
      });
    },
  );

  registrar.registerTool(
    "lsp_definition",
    { description: "Find definitions", inputSchema: positionSchema },
    async (args) => {
      return await runFileRequest<Location[] | Location | null>({
        args,
        lifecycleManager,
        method: "textDocument/definition",
        timeoutMs: 5000,
        format: (result) => formatDefinition(asLocationArray(result)),
        raw: (result) => normalizeLocations(asLocationArray(result)),
      });
    },
  );

  registrar.registerTool(
    "lsp_references",
    {
      description: "Find references",
      inputSchema: positionSchema.extend({
        includeDeclaration: z.boolean().optional(),
      }),
    },
    async (args) => {
      const includeDeclaration = args.includeDeclaration === true;
      return await runFileRequest<Location[] | null>({
        args,
        lifecycleManager,
        method: "textDocument/references",
        timeoutMs: 15000,
        params: (uri, position) => ({
          textDocument: { uri },
          position,
          context: { includeDeclaration },
        }),
        format: formatReferences,
        raw: normalizeLocations,
      });
    },
  );

  registrar.registerTool(
    "lsp_document_symbols",
    {
      description: "List document symbols",
      inputSchema: z.object({ file: z.string() }),
    },
    async (args) => {
      return await runFileRequest({
        args,
        lifecycleManager,
        method: "textDocument/documentSymbol",
        timeoutMs: 15000,
        format: formatSymbols,
        raw: normalizeSymbols,
      });
    },
  );

  registrar.registerTool(
    "lsp_workspace_symbols",
    {
      description: "Search workspace symbols",
      inputSchema: z.object({ query: z.string().default("") }),
    },
    async (args) => {
      const query = typeof args.query === "string" ? args.query : "";
      await lifecycleManager.ensureSeedFilesOpen();
      const results = await Promise.all(
        lifecycleManager.getReadyClients().map(async (client) => {
          return (await client.request(
            "workspace/symbol",
            { query },
            30000,
          )) as SymbolInformation[];
        }),
      );
      const merged = results.flat().slice(0, query === "" ? 100 : 500);
      return success(formatSymbols(merged), normalizeSymbols(merged));
    },
  );

  registrar.registerTool(
    "lsp_completion",
    { description: "Get completions", inputSchema: positionSchema },
    async (args) => {
      return await runFileRequest<CompletionItem[] | CompletionList | null>({
        args,
        lifecycleManager,
        method: "textDocument/completion",
        timeoutMs: 5000,
        format: (result) => formatCompletion(asCompletionItems(result)),
        raw: (result) => asCompletionItems(result)?.slice(0, 50) ?? null,
      });
    },
  );

  registrar.registerTool(
    "lsp_diagnostics",
    {
      description:
        "Get errors and warnings. Pass a file path to trigger analysis of that file and its language server, then return diagnostics for that file (scope: file) or all files seen so far (scope: workspace). Omit file for workspace scope to query whatever has been opened previously.",
      inputSchema: z.object({
        file: z.string().optional(),
        scope: z.enum(["file", "workspace"]).default("file"),
        language: z.string().optional(),
      }),
    },
    async (args) => {
      const filePath = typeof args.file === "string" ? args.file : "";
      const scope = args.scope === "workspace" ? "workspace" : "file";

      if (filePath) {
        await lifecycleManager.ensureLanguageForFile(filePath);
        const client = lifecycleManager.getClientForFile(filePath);
        if (client) {
          const waitPromise = client.waitForDiagnosticsPublish(filePath, 10000);
          await client.ensureDidOpen(filePath);
          client.notify("textDocument/didSave", {
            textDocument: { uri: pathToUri(filePath) },
          });
          await waitPromise;
        }
      }

      if (scope === "workspace") {
        const language =
          typeof args.language === "string" ? args.language : undefined;
        await lifecycleManager.analyzeWorkspace(language);
        const diagnostics = lifecycleManager
          .getWorkspaceDiagnostics(language)
          .slice(0, 200);
        return success(
          formatDiagnostics(diagnostics, "workspace"),
          diagnostics,
        );
      }

      const diagnostics = lifecycleManager.getFileDiagnostics(filePath);
      return success(formatDiagnostics(diagnostics, "file"), diagnostics);
    },
  );

  registrar.registerTool(
    "lsp_signature_help",
    { description: "Show signature help", inputSchema: positionSchema },
    async (args) => {
      return await runFileRequest({
        args,
        lifecycleManager,
        method: "textDocument/signatureHelp",
        timeoutMs: 5000,
        format: stringifyResult,
        raw: (result) => result,
      });
    },
  );

  registrar.registerTool(
    "lsp_type_definition",
    { description: "Find type definitions", inputSchema: positionSchema },
    async (args) => {
      return await runFileRequest<Location[] | Location | null>({
        args,
        lifecycleManager,
        method: "textDocument/typeDefinition",
        timeoutMs: 5000,
        format: (result) => formatDefinition(asLocationArray(result)),
        raw: (result) => normalizeLocations(asLocationArray(result)),
      });
    },
  );

  registrar.registerTool(
    "lsp_implementation",
    { description: "Find implementations", inputSchema: positionSchema },
    async (args) => {
      return await runFileRequest<Location[] | Location | null>({
        args,
        lifecycleManager,
        method: "textDocument/implementation",
        timeoutMs: 5000,
        format: (result) => formatDefinition(asLocationArray(result)),
        raw: (result) => normalizeLocations(asLocationArray(result)),
      });
    },
  );

  registrar.registerTool(
    "lsp_health",
    { description: "Show LSP server health", inputSchema: z.object({}) },
    async () => {
      const health = lifecycleManager.getHealth();
      return success(formatHealth(health), health);
    },
  );
}

async function handleInitTool(
  args: Record<string, unknown>,
  options: ReadToolOptions,
): Promise<McpToolResult> {
  const root = typeof args.root === "string" ? args.root : "";
  if (root.length === 0) {
    return failure(
      "Project root is required. Provide lsp_init({ root: '/absolute/path' }).",
    );
  }

  if (!path.isAbsolute(root)) {
    return failure(`Project root must be an absolute path: ${root}`);
  }

  try {
    const stats = await stat(root);
    if (!stats.isDirectory()) {
      return failure(`Project root is not a directory: ${root}`);
    }
  } catch {
    return failure(`Project root does not exist: ${root}`);
  }

  const languages = Array.isArray(args.languages)
    ? (args.languages as unknown[]).filter(
        (item): item is string => typeof item === "string",
      )
    : undefined;

  try {
    const initialized = await options.initializeManager(root, languages);
    const languageNames = initialized.health.map((entry) =>
      formatLanguageName(entry.language),
    );
    const started = initialized.health.filter(
      (entry) => entry.status === "ready",
    ).length;
    const errors = initialized.health.filter(
      (entry) => entry.status === "error",
    ).length;
    const lazyNote =
      languageNames.length === 0
        ? " Language servers will start on first file access."
        : "";
    const text = `Initialized LSP for ${initialized.root}. Detected languages: ${formatLanguageList(languageNames)}. LSP servers: ${started} started, ${errors} errors.${lazyNote}`;
    return {
      content: [{ type: "text", text }],
      text,
      raw: {
        root: initialized.root,
        languages: languageNames,
        health: initialized.health,
      },
    };
  } catch (error) {
    return mapToolError(error, 30);
  }
}

const positionSchema = z.object({
  file: z.string(),
  line: z.number().int(),
  character: z.number().int(),
});

async function runFileRequest<T>(options: {
  args: Record<string, unknown>;
  lifecycleManager: MinimalLifecycleManager;
  method: string;
  timeoutMs: number;
  format: (result: T | null) => string;
  raw: (result: T | null) => unknown;
  params?: (
    uri: string,
    position: { line: number; character: number },
  ) => unknown;
}): Promise<ReturnType<typeof success>> {
  const filePath =
    typeof options.args.file === "string" ? options.args.file : "";
  await options.lifecycleManager.ensureLanguageForFile(filePath);
  const client = options.lifecycleManager.getClientForFile(filePath);
  if (!client) {
    return noServerResult(filePath);
  }

  const position = {
    line: Number(options.args.line ?? 0),
    character: Number(options.args.character ?? 0),
  };
  const uri = pathToUri(filePath);

  try {
    await client.ensureDidOpen(filePath);
    const result = (await client.request(
      options.method,
      options.params?.(uri, position) ?? {
        textDocument: { uri },
        position,
      },
      options.timeoutMs,
    )) as T | null;
    return success(options.format(result), options.raw(result));
  } catch (error) {
    return mapToolError(error, options.timeoutMs / 1000);
  }
}

function asLocationArray(
  result: Location[] | Location | null,
): Location[] | null {
  if (!result) {
    return null;
  }

  return Array.isArray(result) ? result : [result];
}

function asCompletionItems(
  result: CompletionItem[] | CompletionList | null,
): CompletionItem[] | null {
  if (!result) {
    return null;
  }

  return Array.isArray(result) ? result : result.items;
}

function stringifyResult(result: unknown): string {
  if (!result) {
    return "No result";
  }

  return JSON.stringify(result, null, 2);
}

function formatLanguageList(languages: string[]): string {
  return languages.length === 0 ? "None" : languages.join(", ");
}

function formatLanguageName(language: string): string {
  if (language.length === 0) {
    return language;
  }

  return `${language[0]?.toUpperCase() ?? ""}${language.slice(1)}`;
}
