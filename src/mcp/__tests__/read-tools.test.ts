import { readFile } from 'node:fs/promises';

import { registerReadTools } from '../tools/read-tools';

import { DiagnosticSeverity } from 'vscode-languageserver-protocol';

import type { LanguageServerHealth } from '../../lsp/lifecycle-manager';
import type { Diagnostic } from 'vscode-languageserver-protocol';

jest.mock('node:fs/promises', () => ({
  readFile: jest.fn()
}));

interface RegisteredTool {
  description?: string;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

class FakeRegistrar {
  public readonly tools = new Map<string, RegisteredTool>();

  public registerTool(name: string, config: { description?: string }, handler: (args: Record<string, unknown>) => Promise<unknown>): void {
    this.tools.set(name, { description: config.description, handler });
  }
}

describe('registerReadTools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (readFile as jest.MockedFunction<typeof readFile>).mockResolvedValue('const foo = 1;');
  });

  it('sends didOpen once and returns formatted hover results', async () => {
    const registrar = new FakeRegistrar();
    const client = createClient({ contents: 'hover docs' });
    const lifecycle = createLifecycle({ fileClient: client });

    registerReadTools(registrar, lifecycle);

    const hover = await getHandler(registrar, 'lsp_hover')({ file: '/workspace/src/index.ts', line: 2, character: 4 });
    await getHandler(registrar, 'lsp_hover')({ file: '/workspace/src/index.ts', line: 2, character: 4 });

    expect(readFile).toHaveBeenCalledTimes(1);
    expect(client.notify).toHaveBeenCalledWith('textDocument/didOpen', expect.objectContaining({
      textDocument: expect.objectContaining({ uri: 'file:///workspace/src/index.ts', text: 'const foo = 1;' })
    }));
    expect(client.request).toHaveBeenCalledWith('textDocument/hover', {
      textDocument: { uri: 'file:///workspace/src/index.ts' },
      position: { line: 2, character: 4 }
    }, 5000);
    expect(hover).toEqual({
      content: [{ type: 'text', text: 'hover docs' }],
      raw: { contents: 'hover docs' }
    });
  });

  it('formats definitions and converts URIs back to paths', async () => {
    const registrar = new FakeRegistrar();
    const lifecycle = createLifecycle({
      fileClient: createClient([
        {
          uri: 'file:///workspace/src/defs.ts',
          range: { start: { line: 3, character: 1 }, end: { line: 3, character: 2 } }
        }
      ])
    });

    registerReadTools(registrar, lifecycle);

    await expect(getHandler(registrar, 'lsp_definition')({ file: '/workspace/src/index.ts', line: 1, character: 1 })).resolves.toEqual({
      content: [{ type: 'text', text: 'Found 1 definition: `/workspace/src/defs.ts:4:2`' }],
      raw: [
        {
          path: '/workspace/src/defs.ts',
          range: { start: { line: 3, character: 1 }, end: { line: 3, character: 2 } }
        }
      ]
    });
  });

  it('uses the declaration flag when requesting references', async () => {
    const registrar = new FakeRegistrar();
    const client = createClient([]);
    registerReadTools(registrar, createLifecycle({ fileClient: client }));

    await getHandler(registrar, 'lsp_references')({ file: '/workspace/src/index.ts', line: 0, character: 0, includeDeclaration: true });

    expect(client.request).toHaveBeenCalledWith('textDocument/references', {
      textDocument: { uri: 'file:///workspace/src/index.ts' },
      position: { line: 0, character: 0 },
      context: { includeDeclaration: true }
    }, 15000);
  });

  it('merges workspace symbols across ready clients', async () => {
    const registrar = new FakeRegistrar();
    const firstClient = createClient([{ name: 'UserService', kind: 5, location: { uri: 'file:///workspace/src/user.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } } }]);
    const secondClient = createClient([{ name: 'login', kind: 12, location: { uri: 'file:///workspace/src/auth.ts', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } } }]);

    registerReadTools(registrar, createLifecycle({ workspaceClients: [firstClient, secondClient] }));

    const result = await getHandler(registrar, 'lsp_workspace_symbols')({ query: 'log' });

    expect(firstClient.request).toHaveBeenCalledWith('workspace/symbol', { query: 'log' }, 30000);
    expect(secondClient.request).toHaveBeenCalledWith('workspace/symbol', { query: 'log' }, 30000);
    expect(result).toEqual({
      content: [{ type: 'text', text: expect.stringContaining('UserService') }],
      raw: [
        { name: 'UserService', kind: 5, path: '/workspace/src/user.ts', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 4 } } },
        { name: 'login', kind: 12, path: '/workspace/src/auth.ts', range: { start: { line: 1, character: 0 }, end: { line: 1, character: 3 } } }
      ]
    });
  });

  it('returns cached file diagnostics and aggregates workspace diagnostics', async () => {
    const registrar = new FakeRegistrar();
    const diagnostics = [{ uri: 'file:///workspace/src/index.ts', message: 'Boom', severity: DiagnosticSeverity.Error, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }];
    registerReadTools(registrar, createLifecycle({ diagnostics, workspaceClients: [createClient([])] }));

    await expect(getHandler(registrar, 'lsp_diagnostics')({ file: '/workspace/src/index.ts' })).resolves.toEqual({
      content: [{ type: 'text', text: expect.stringContaining('File diagnostics: 1 issue(s)') }],
      raw: diagnostics
    });
    await expect(getHandler(registrar, 'lsp_diagnostics')({ scope: 'workspace' })).resolves.toEqual({
      content: [{ type: 'text', text: expect.stringContaining('Workspace diagnostics: 1 issue(s)') }],
      raw: diagnostics
    });
  });

  it('returns health instantly without LSP requests', async () => {
    const registrar = new FakeRegistrar();
    const lifecycle = createLifecycle({ health: [{ language: 'typescript', status: 'ready' }] });
    registerReadTools(registrar, lifecycle);

    await expect(getHandler(registrar, 'lsp_health')({})).resolves.toEqual({
      content: [{ type: 'text', text: '| Language | Status | Error |\n| --- | --- | --- |\n| typescript | ready |  |' }],
      raw: [{ language: 'typescript', status: 'ready' }]
    });
  });

  it('supports document symbols, completion lists, and signature help fallbacks', async () => {
    const registrar = new FakeRegistrar();
    const client = createClient({ items: [{ label: 'x', kind: 3 }] });
    registerReadTools(registrar, createLifecycle({ fileClient: client }));

    await expect(getHandler(registrar, 'lsp_completion')({ file: '/workspace/src/index.ts', line: 0, character: 0 })).resolves.toEqual({
      content: [{ type: 'text', text: 'Showing 1 of 1 completion item(s)\n\n### Functions\n- `x`' }],
      raw: [{ label: 'x', kind: 3 }]
    });

    client.request.mockResolvedValueOnce([{ name: 'DocSymbol', kind: 5, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }]);
    await expect(getHandler(registrar, 'lsp_document_symbols')({ file: '/workspace/src/index.ts' })).resolves.toEqual({
      content: [{ type: 'text', text: '- 📦 `DocSymbol`' }],
      raw: [{ name: 'DocSymbol', kind: 5, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, selectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }]
    });

    client.request.mockResolvedValueOnce(null);
    await expect(getHandler(registrar, 'lsp_signature_help')({ file: '/workspace/src/index.ts', line: 0, character: 0 })).resolves.toEqual({
      content: [{ type: 'text', text: 'No result' }],
      raw: null
    });
  });

  it('supports type and implementation lookups plus empty completion results', async () => {
    const registrar = new FakeRegistrar();
    const client = createClient({
      uri: 'file:///workspace/src/types.ts',
      range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } }
    });
    registerReadTools(registrar, createLifecycle({ fileClient: client }));

    await expect(getHandler(registrar, 'lsp_type_definition')({ file: '/workspace/src/index.ts', line: 0, character: 0 })).resolves.toEqual({
      content: [{ type: 'text', text: 'Found 1 definition: `/workspace/src/types.ts:2:3`' }],
      raw: [{ path: '/workspace/src/types.ts', range: { start: { line: 1, character: 2 }, end: { line: 1, character: 6 } } }]
    });

    client.request.mockResolvedValueOnce(null);
    await expect(getHandler(registrar, 'lsp_implementation')({ file: '/workspace/src/index.ts', line: 0, character: 0 })).resolves.toEqual({
      content: [{ type: 'text', text: 'No result' }],
      raw: null
    });

    client.request.mockResolvedValueOnce(null);
    await expect(getHandler(registrar, 'lsp_completion')({ file: '/workspace/src/index.ts', line: 0, character: 0 })).resolves.toEqual({
      content: [{ type: 'text', text: 'No result' }],
      raw: null
    });

    client.request.mockResolvedValueOnce({ signatures: [{ label: 'fn(x: string)' }] });
    await expect(getHandler(registrar, 'lsp_signature_help')({ file: '/workspace/src/index.ts', line: 0, character: 0 })).resolves.toEqual({
      content: [{ type: 'text', text: JSON.stringify({ signatures: [{ label: 'fn(x: string)' }] }, null, 2) }],
      raw: { signatures: [{ label: 'fn(x: string)' }] }
    });
  });

  it('turns LSP timeouts into retry guidance', async () => {
    const registrar = new FakeRegistrar();
    const client = createClient(new Error('LSP request timed out: textDocument/hover'));
    registerReadTools(registrar, createLifecycle({ fileClient: client }));

    await expect(getHandler(registrar, 'lsp_hover')({ file: '/workspace/src/index.ts', line: 0, character: 0 })).resolves.toEqual({
      content: [{ type: 'text', text: 'Operation timed out after 5s — try a more specific query or check the LSP server health' }],
      error: true,
      raw: null
    });
  });

  it('returns a no-server error when no language server matches the file', async () => {
    const registrar = new FakeRegistrar();
    registerReadTools(registrar, createLifecycle({ fileClient: null }));

    await expect(getHandler(registrar, 'lsp_hover')({ file: '/workspace/README.md', line: 0, character: 0 })).resolves.toEqual({
      content: [{ type: 'text', text: 'No language server available for .md files. Run lsp_health for details.' }],
      error: true,
      raw: null
    });
  });

  it('returns restart guidance when the LSP crashed', async () => {
    const registrar = new FakeRegistrar();
    const client = createClient(new Error('LSP server exited unexpectedly (code: 1, signal: null)'));
    registerReadTools(registrar, createLifecycle({ fileClient: client }));

    await expect(getHandler(registrar, 'lsp_hover')({ file: '/workspace/src/index.ts', line: 0, character: 0 })).resolves.toEqual({
      content: [{ type: 'text', text: 'Der Language Server ist neu gestartet, bitte versuche es erneut.' }],
      error: true,
      raw: null
    });
  });
});

function getHandler(registrar: FakeRegistrar, name: string): (args: Record<string, unknown>) => Promise<unknown> {
  const tool = registrar.tools.get(name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }

  return tool.handler;
}

function createLifecycle(options: {
  fileClient?: MockClient | null;
  workspaceClients?: MockClient[];
  diagnostics?: DiagnosticRecord[];
  health?: LanguageServerHealth[];
}): MockLifecycle {
  return {
    getClientForFile: jest.fn((_: string) => options.fileClient ?? null),
    getReadyClients: jest.fn((_: string | undefined) => options.workspaceClients ?? []),
    getFileDiagnostics: jest.fn((_: string) => (options.diagnostics ?? []).filter((diagnostic) => diagnostic.uri === 'file:///workspace/src/index.ts')),
    getWorkspaceDiagnostics: jest.fn((_: string | undefined) => options.diagnostics ?? []),
    getHealth: jest.fn(() => options.health ?? [])
  };
}

function createClient(result: unknown): MockClient {
  return {
    request: result instanceof Error
      ? jest.fn().mockRejectedValue(result)
      : jest.fn().mockResolvedValue(result),
    notify: jest.fn(),
    getCapabilities: jest.fn(() => ({ renameProvider: true }))
  };
}

interface MockClient {
  request: jest.Mock<Promise<unknown>, [string, unknown, number]>;
  notify: jest.Mock<void, [string, unknown]>;
  getCapabilities: jest.Mock<Record<string, unknown>, []>;
}

interface MockLifecycle {
  getClientForFile: jest.Mock<MockClient | null, [string]>;
  getReadyClients: jest.Mock<MockClient[], [string?]>;
  getFileDiagnostics: jest.Mock<DiagnosticRecord[], [string]>;
  getWorkspaceDiagnostics: jest.Mock<DiagnosticRecord[], [string?]>;
  getHealth: jest.Mock<LanguageServerHealth[], []>;
}

type DiagnosticRecord = Diagnostic & { uri?: string };
