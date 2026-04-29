import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CodeAction, Range, TextEdit, WorkspaceEdit } from 'vscode-languageserver-protocol';
import { z } from 'zod';

import { pathToUri, uriToPath } from '../../utils/uri';
import { ensureDidOpen, failure, mapToolError, noServerResult, success, type MinimalLifecycleManager, type MinimalLspClient, type ToolRegistrar } from './shared';

export function registerWriteTools(registrar: ToolRegistrar, lifecycleManager: MinimalLifecycleManager): void {
  registrar.registerTool('lsp_rename', { description: 'Rename symbol', inputSchema: z.object({ file: z.string(), line: z.number().int(), character: z.number().int(), newName: z.string() }) }, async (args) => {
    const filePath = getFilePath(args);
    const client = lifecycleManager.getClientForFile(filePath);
    if (!client) {
      return noServerResult(filePath);
    }

    if (hasRenameProviderDisabled(client.getCapabilities())) {
      return failure('Rename is not supported by the active language server.');
    }

    try {
      await ensureDidOpen(client, filePath);
      const edit = await client.request('textDocument/rename', {
        textDocument: { uri: pathToUri(filePath) },
        position: getPosition(args),
        newName: String(args.newName ?? '')
      }, 15000) as WorkspaceEdit | null;
      return await applyWorkspaceEdit(edit, lifecycleManager, client, 'Applied workspace edit to');
    } catch (error) {
      return mapToolError(error, 15);
    }
  });

  registrar.registerTool('lsp_code_action', { description: 'List or apply code actions', inputSchema: z.object({ file: z.string(), line: z.number().int(), character: z.number().int(), apply: z.union([z.boolean(), z.object({ index: z.number().int() })]).optional(), range: rangeSchema.optional() }) }, async (args) => {
    const filePath = getFilePath(args);
    const client = lifecycleManager.getClientForFile(filePath);
    if (!client) {
      return noServerResult(filePath);
    }

    try {
      await ensureDidOpen(client, filePath);
      const range = isRange(args.range)
        ? args.range
        : { start: getPosition(args), end: getPosition(args) };
      const actions = await client.request('textDocument/codeAction', {
        textDocument: { uri: pathToUri(filePath) },
        range,
        context: { diagnostics: [] }
      }, 15000) as CodeAction[] | null;
      const selected = selectCodeAction(actions, args.apply);

      if (!selected) {
        return success(formatCodeActions(actions ?? []), actions ?? []);
      }

      const applied = selected.edit
        ? await applyWorkspaceEdit(selected.edit, lifecycleManager, client, 'Applied workspace edit to')
        : success('Applied workspace edit to 0 file(s)', { changedFiles: [] });
      if (selected.command) {
        await client.request('workspace/executeCommand', selected.command, 15000);
      }

      return success(`Applied code action: ${selected.title}`, {
        title: selected.title,
        changedFiles: extractChangedFiles(applied.raw)
      });
    } catch (error) {
      return mapToolError(error, 15);
    }
  });

  registrar.registerTool('lsp_formatting', { description: 'Format document', inputSchema: z.object({ file: z.string(), options: formattingOptionsSchema.optional() }) }, async (args) => {
    return await runFormattingRequest('textDocument/formatting', args, lifecycleManager, async (client, filePath, options) => {
      return await client.request('textDocument/formatting', { textDocument: { uri: pathToUri(filePath) }, options }, 15000) as TextEdit[] | null;
    });
  });

  registrar.registerTool('lsp_range_formatting', { description: 'Format selected range', inputSchema: z.object({ file: z.string(), range: rangeSchema, options: formattingOptionsSchema.optional() }) }, async (args) => {
    return await runFormattingRequest('textDocument/rangeFormatting', args, lifecycleManager, async (client, filePath, options) => {
      return await client.request('textDocument/rangeFormatting', {
        textDocument: { uri: pathToUri(filePath) },
        range: args.range,
        options
      }, 15000) as TextEdit[] | null;
    });
  });

  registrar.registerTool('lsp_apply_workspace_edit', { description: 'Apply raw workspace edit', inputSchema: z.object({ edit: z.record(z.string(), z.unknown()) }) }, async (args) => {
    const clients = lifecycleManager.getReadyClients();
    const client = clients[0] ?? null;
    if (!client) {
      return failure('No language servers are ready. Run lsp_health for details.');
    }

    try {
      return await applyWorkspaceEdit((args.edit ?? null) as WorkspaceEdit | null, lifecycleManager, client, 'Applied workspace edit to');
    } catch (error) {
      return mapToolError(error, 15);
    }
  });
}

const positionSchema = z.object({ line: z.number().int(), character: z.number().int() });
const rangeSchema = z.object({ start: positionSchema, end: positionSchema });
const formattingOptionsSchema = z.object({ tabSize: z.number().int(), insertSpaces: z.boolean() });

async function runFormattingRequest(
  _method: string,
  args: Record<string, unknown>,
  lifecycleManager: MinimalLifecycleManager,
  requestEdits: (client: MinimalLspClient, filePath: string, options: { tabSize: number; insertSpaces: boolean }) => Promise<TextEdit[] | null>
) {
  const filePath = getFilePath(args);
  const client = lifecycleManager.getClientForFile(filePath);
  if (!client) {
    return noServerResult(filePath);
  }

  try {
    await ensureDidOpen(client, filePath);
    const options = await resolveFormattingOptions(filePath, args.options);
    const edits = await requestEdits(client, filePath, options);
    return await applyTextEdits(edits, [filePath], lifecycleManager, client);
  } catch (error) {
    return mapToolError(error, 15);
  }
}

async function applyWorkspaceEdit(
  edit: WorkspaceEdit | null,
  lifecycleManager: MinimalLifecycleManager,
  fallbackClient: MinimalLspClient,
  verb: string
) {
  if (!edit) {
    return success('No result', null);
  }

  const changeEntries = Object.entries(edit.changes ?? {});
  const changedFiles: string[] = [];

  for (const [uri, edits] of changeEntries) {
    const filePath = uriToPath(uri);
    const client = lifecycleManager.getClientForFile(filePath) ?? fallbackClient;
    await ensureDidOpen(client, filePath);
    await applyEditsToFile(filePath, edits ?? []);
    client.notify('textDocument/didSave', { textDocument: { uri } });
    changedFiles.push(filePath);
  }

  for (const change of edit.documentChanges ?? []) {
    if ('textDocument' in change && 'edits' in change) {
      const filePath = uriToPath(change.textDocument.uri);
      const client = lifecycleManager.getClientForFile(filePath) ?? fallbackClient;
      await ensureDidOpen(client, filePath);
      await applyEditsToFile(filePath, change.edits);
      client.notify('textDocument/didSave', { textDocument: { uri: change.textDocument.uri } });
      changedFiles.push(filePath);
    }
  }

  return success(`${verb} ${changedFiles.length} file(s)`, { changedFiles: [...new Set(changedFiles)] });
}

async function applyTextEdits(
  edits: TextEdit[] | null,
  files: string[],
  lifecycleManager: MinimalLifecycleManager,
  fallbackClient: MinimalLspClient
) {
  const changedFiles: string[] = [];
  for (const filePath of files) {
    if (!edits || edits.length === 0) {
      continue;
    }

    const client = lifecycleManager.getClientForFile(filePath) ?? fallbackClient;
    await applyEditsToFile(filePath, edits);
    client.notify('textDocument/didSave', { textDocument: { uri: pathToUri(filePath) } });
    changedFiles.push(filePath);
  }

  return success(`Applied workspace edit to ${changedFiles.length} file(s)`, { changedFiles });
}

async function applyEditsToFile(filePath: string, edits: readonly TextEdit[]): Promise<void> {
  const original = await readFile(filePath, 'utf8');
  const updated = applyEdits(original, edits);
  await writeFile(filePath, updated, 'utf8');
}

function applyEdits(text: string, edits: readonly TextEdit[]): string {
  const ordered = [...edits].sort((left, right) => comparePosition(right.range.start, left.range.start));
  let current = text;
  for (const edit of ordered) {
    const start = positionToOffset(current, edit.range.start);
    const end = positionToOffset(current, edit.range.end);
    current = `${current.slice(0, start)}${edit.newText}${current.slice(end)}`;
  }

  return current;
}

async function resolveFormattingOptions(filePath: string, provided: unknown): Promise<{ tabSize: number; insertSpaces: boolean }> {
  if (isFormattingOptions(provided)) {
    return provided;
  }

  const editorConfig = await readNearestConfig(filePath, '.editorconfig');
  if (editorConfig) {
    const tabSizeMatch = editorConfig.match(/indent_size\s*=\s*(\d+)/);
    const indentStyleMatch = editorConfig.match(/indent_style\s*=\s*(space|tab)/);
    return {
      tabSize: Number(tabSizeMatch?.[1] ?? 2),
      insertSpaces: indentStyleMatch?.[1] !== 'tab'
    };
  }

  return { tabSize: 2, insertSpaces: true };
}

async function readNearestConfig(filePath: string, fileName: string): Promise<string | null> {
  let currentDir = path.dirname(filePath);
  while (true) {
    const candidate = path.join(currentDir, fileName);
    try {
      await access(candidate);
      return await readFile(candidate, 'utf8');
    } catch {
      if (currentDir === path.dirname(currentDir)) {
        return null;
      }

      currentDir = path.dirname(currentDir);
    }
  }
}

function selectCodeAction(actions: CodeAction[] | null, apply: unknown): CodeAction | null {
  if (apply === true) {
    return actions?.[0] ?? null;
  }

  if (typeof apply === 'object' && apply && 'index' in apply && typeof apply.index === 'number') {
    return actions?.[apply.index] ?? null;
  }

  return null;
}

function formatCodeActions(actions: CodeAction[]): string {
  if (actions.length === 0) {
    return 'No result';
  }

  return ['Available code actions:', ...actions.map((action, index) => `- [${index}] ${action.title}`)].join('\n');
}

function extractChangedFiles(raw: unknown): string[] {
  if (typeof raw === 'object' && raw && 'changedFiles' in raw && Array.isArray(raw.changedFiles)) {
    return raw.changedFiles.filter((value): value is string => typeof value === 'string');
  }

  return [];
}

function getFilePath(args: Record<string, unknown>): string {
  return typeof args.file === 'string' ? args.file : '';
}

function getPosition(args: Record<string, unknown>): { line: number; character: number } {
  return { line: Number(args.line ?? 0), character: Number(args.character ?? 0) };
}

function comparePosition(left: { line: number; character: number }, right: { line: number; character: number }): number {
  return left.line === right.line ? left.character - right.character : left.line - right.line;
}

function positionToOffset(text: string, position: { line: number; character: number }): number {
  const lines = text.split('\n');
  let offset = 0;
  for (let index = 0; index < position.line; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1;
  }

  return offset + position.character;
}

function isRange(value: unknown): value is Range {
  return typeof value === 'object' && value !== null && 'start' in value && 'end' in value;
}

function isFormattingOptions(value: unknown): value is { tabSize: number; insertSpaces: boolean } {
  return typeof value === 'object' && value !== null && 'tabSize' in value && 'insertSpaces' in value
    && typeof value.tabSize === 'number' && typeof value.insertSpaces === 'boolean';
}

function hasRenameProviderDisabled(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'renameProvider' in value && value.renameProvider === false;
}
