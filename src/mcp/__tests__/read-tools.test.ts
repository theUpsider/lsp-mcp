import { stat } from 'node:fs/promises';

import { registerReadTools } from '../tools/read-tools';

import { DiagnosticSeverity } from 'vscode-languageserver-protocol';

import type { LanguageServerHealth } from '../../lsp/lifecycle-manager';
import type { Diagnostic } from 'vscode-languageserver-protocol';

jest.mock('node:fs/promises', () => ({
  stat: jest.fn()
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
    (stat as jest.MockedFunction<typeof stat>).mockResolvedValue({ isDirectory: () => true } as Awaited<ReturnType<typeof stat>>);
  });

  it('initializes LSP with a valid root and reports health', async () => {
    const registrar = new FakeRegistrar();
    const initializeManager = jest.fn().mockResolvedValue({
      root: '/workspace',
      health: [
        { language: 'typescript', status: 'ready' },
        { language: 'python', status: 'error', error: 'missing pylsp' }
      ]
    });

    registerReadTools(registrar, createLifecycle({ fileClient: null }), { initializeManager });

    await expect(getHandler(registrar, 'lsp_init')({ root: '/workspace' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Initialized LSP for /workspace. Detected languages: Typescript, Python. LSP servers: 1 started, 1 errors.' }],
      text: 'Initialized LSP for /workspace. Detected languages: Typescript, Python. LSP servers: 1 started, 1 errors.',
      raw: {
        root: '/workspace',
        languages: ['Typescript', 'Python'],
        health: [
          { language: 'typescript', status: 'ready' },
          { language: 'python', status: 'error', error: 'missing pylsp' }
        ]
      }
    });
    expect(initializeManager).toHaveBeenCalledWith('/workspace', undefined);
  });

  it('rejects invalid lsp_init roots clearly', async () => {
    const registrar = new FakeRegistrar();
    const initializeManager = jest.fn();
    (stat as jest.MockedFunction<typeof stat>).mockRejectedValueOnce(new Error('ENOENT'));

    registerReadTools(registrar, createLifecycle({ fileClient: null }), { initializeManager });

    await expect(getHandler(registrar, 'lsp_init')({ root: '/missing/project' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Project root does not exist: /missing/project' }],
      error: true,
      raw: null
    });
    expect(initializeManager).not.toHaveBeenCalled();
  });

  it('rejects missing, relative, and non-directory lsp_init roots', async () => {
    const registrar = new FakeRegistrar();
    const initializeManager = jest.fn();

    registerReadTools(registrar, createLifecycle({ fileClient: null }), { initializeManager });

    await expect(getHandler(registrar, 'lsp_init')({})).resolves.toEqual({
      content: [{ type: 'text', text: 'Project root is required. Provide lsp_init({ root: \'/absolute/path\' }).' }],
      error: true,
      raw: null
    });
    await expect(getHandler(registrar, 'lsp_init')({ root: 'relative/path' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Project root must be an absolute path: relative/path' }],
      error: true,
      raw: null
    });

    (stat as jest.MockedFunction<typeof stat>).mockResolvedValueOnce({ isDirectory: () => false } as Awaited<ReturnType<typeof stat>>);
    await expect(getHandler(registrar, 'lsp_init')({ root: '/workspace/file.ts' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Project root is not a directory: /workspace/file.ts' }],
      error: true,
      raw: null
    });
    expect(initializeManager).not.toHaveBeenCalled();
  });

  it('maps lsp_init startup failures into tool errors', async () => {
    const registrar = new FakeRegistrar();
    const initializeManager = jest.fn().mockRejectedValue(new Error('Lifecycle start timed out'));

    registerReadTools(registrar, createLifecycle({ fileClient: null }), { initializeManager });

    await expect(getHandler(registrar, 'lsp_init')({ root: '/workspace' })).resolves.toEqual({
      content: [{ type: 'text', text: 'Operation timed out after 30s — try a more specific query or check the LSP server health' }],
      error: true,
      raw: null
    });
  });

  it('sends didOpen once and returns formatted hover results', async () => {
    const registrar = new FakeRegistrar();
    const client = createClient({ contents: 'hover docs' });
    const lifecycle = createLifecycle({ fileClient: client });

    registerReadTools(registrar, lifecycle, { initializeManager: jest.fn() });

    const hover = await getHandler(registrar, 'lsp_hover')({ file: '/workspace/src/index.ts', line: 2, character: 4 });
    await getHandler(registrar, 'lsp_hover')({ file: '/workspace/src/index.ts', line: 2, character: 4 });

    expect(client.ensureDidOpen).toHaveBeenCalledTimes(2);
    expect(client.ensureDidOpen).toHaveBeenCalledWith('/workspace/src/index.ts');
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

    registerReadTools(registrar, lifecycle, { initializeManager: jest.fn() });

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
    registerReadTools(registrar, createLifecycle({ fileClient: client }), { initializeManager: jest.fn() });

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
    const lifecycle = createLifecycle({ workspaceClients: [firstClient, secondClient] });

    registerReadTools(registrar, lifecycle, { initializeManager: jest.fn() });

    const result = await getHandler(registrar, 'lsp_workspace_symbols')({ query: 'log' });

    expect(lifecycle.ensureSeedFilesOpen).toHaveBeenCalledTimes(1);
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
    registerReadTools(registrar, createLifecycle({ diagnostics, workspaceClients: [createClient([])] }), { initializeManager: jest.fn() });

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
    registerReadTools(registrar, lifecycle, { initializeManager: jest.fn() });

    await expect(getHandler(registrar, 'lsp_health')({})).resolves.toEqual({
      content: [{ type: 'text', text: '| Language | Status | Error |\n| --- | --- | --- |\n| typescript | ready |  |' }],
      raw: [{ language: 'typescript', status: 'ready' }]
    });
  });

  it('supports document symbols, completion lists, and signature help fallbacks', async () => {
    const registrar = new FakeRegistrar();
    const client = createClient({ items: [{ label: 'x', kind: 3 }] });
    registerReadTools(registrar, createLifecycle({ fileClient: client }), { initializeManager: jest.fn() });

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
    registerReadTools(registrar, createLifecycle({ fileClient: client }), { initializeManager: jest.fn() });

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
    registerReadTools(registrar, createLifecycle({ fileClient: client }), { initializeManager: jest.fn() });

    await expect(getHandler(registrar, 'lsp_hover')({ file: '/workspace/src/index.ts', line: 0, character: 0 })).resolves.toEqual({
      content: [{ type: 'text', text: 'Operation timed out after 5s — try a more specific query or check the LSP server health' }],
      error: true,
      raw: null
    });
  });

  it('returns a no-server error when no language server matches the file', async () => {
    const registrar = new FakeRegistrar();
    registerReadTools(registrar, createLifecycle({ fileClient: null }), { initializeManager: jest.fn() });

    await expect(getHandler(registrar, 'lsp_hover')({ file: '/workspace/README.md', line: 0, character: 0 })).resolves.toEqual({
      content: [{ type: 'text', text: 'No language server available for .md files. Run lsp_health for details.' }],
      error: true,
      raw: null
    });
  });

  it('returns restart guidance when the LSP crashed', async () => {
    const registrar = new FakeRegistrar();
    const client = createClient(new Error('LSP server exited unexpectedly (code: 1, signal: null)'));
    registerReadTools(registrar, createLifecycle({ fileClient: client }), { initializeManager: jest.fn() });

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
    getHealth: jest.fn(() => options.health ?? []),
    ensureLanguageForFile: jest.fn().mockResolvedValue(undefined),
    ensureSeedFilesOpen: jest.fn().mockResolvedValue(undefined)
  };
}

function createClient(result: unknown): MockClient {
  return {
    request: result instanceof Error
      ? jest.fn().mockRejectedValue(result)
      : jest.fn().mockResolvedValue(result),
    notify: jest.fn(),
    getCapabilities: jest.fn(() => ({ renameProvider: true })),
    ensureDidOpen: jest.fn().mockResolvedValue(undefined),
    waitForDiagnosticsPublish: jest.fn().mockResolvedValue(undefined),
    ensureSeedFileOpen: jest.fn().mockResolvedValue(undefined)
  };
}

interface MockClient {
  request: jest.Mock<Promise<unknown>, [string, unknown, number]>;
  notify: jest.Mock<void, [string, unknown]>;
  getCapabilities: jest.Mock<Record<string, unknown>, []>;
  ensureDidOpen: jest.Mock<Promise<void>, [string]>;
  waitForDiagnosticsPublish: jest.Mock<Promise<void>, [string, number]>;
  ensureSeedFileOpen: jest.Mock<Promise<void>, [string[]]>;
}

interface MockLifecycle {
  getClientForFile: jest.Mock<MockClient | null, [string]>;
  getReadyClients: jest.Mock<MockClient[], [string?]>;
  getFileDiagnostics: jest.Mock<DiagnosticRecord[], [string]>;
  getWorkspaceDiagnostics: jest.Mock<DiagnosticRecord[], [string?]>;
  getHealth: jest.Mock<LanguageServerHealth[], []>;
  ensureLanguageForFile: jest.Mock<Promise<void>, [string]>;
  ensureSeedFilesOpen: jest.Mock<Promise<void>, []>;
}

type DiagnosticRecord = Diagnostic & { uri?: string };
