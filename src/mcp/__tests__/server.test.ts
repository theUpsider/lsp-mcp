const mockSetRequestHandler = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);

jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    server: {
      setRequestHandler: mockSetRequestHandler
    }
  }))
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({ kind: 'stdio' }))
}));

jest.mock('@modelcontextprotocol/sdk/server/zod-compat.js', () => ({
  normalizeObjectSchema: jest.fn().mockReturnValue(null)
}));

jest.mock('@modelcontextprotocol/sdk/server/zod-json-schema-compat.js', () => ({
  toJsonSchemaCompat: jest.fn().mockReturnValue({})
}));

jest.mock('../tools/read-tools', () => ({ registerReadTools: jest.fn() }));
jest.mock('../tools/write-tools', () => ({ registerWriteTools: jest.fn() }));

import { McpServer } from '../server';
import type { LifecycleManager } from '../../lsp/lifecycle-manager';

function getHandler(schema: unknown): Function {
  const call = mockSetRequestHandler.mock.calls.find(([s]) => s === schema);
  if (!call) throw new Error(`No handler registered for schema`);
  return call[1];
}

describe('McpServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers request handlers and connects on start', async () => {
    const server = new McpServer('info');
    await server.start();

    expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
    expect(mockConnect).toHaveBeenCalledWith({ kind: 'stdio' });
  });

  it('lists all registered tools regardless of init state', async () => {
    const readTools = jest.requireMock('../tools/read-tools').registerReadTools as jest.Mock;
    const writeTools = jest.requireMock('../tools/write-tools').registerWriteTools as jest.Mock;

    readTools.mockImplementationOnce((registrar: { registerTool: Function }) => {
      registrar.registerTool('lsp_init', { description: 'init' }, async () => ({ content: [{ type: 'text', text: 'ok' }], raw: null }));
      registrar.registerTool('lsp_hover', { description: 'hover' }, async () => ({ content: [{ type: 'text', text: 'hover' }], raw: null }));
    });
    writeTools.mockImplementationOnce(() => undefined);

    const { ListToolsRequestSchema } = jest.requireActual('@modelcontextprotocol/sdk/types.js') as { ListToolsRequestSchema: unknown };

    const server = new McpServer('info');
    await server.start();

    const listHandler = getHandler(ListToolsRequestSchema);
    const result = await listHandler({});

    expect(result.tools.map((t: { name: string }) => t.name)).toContain('lsp_init');
    expect(result.tools.map((t: { name: string }) => t.name)).toContain('lsp_hover');
  });

  it('lists all tools after initialization too', async () => {
    const readTools = jest.requireMock('../tools/read-tools').registerReadTools as jest.Mock;
    const writeTools = jest.requireMock('../tools/write-tools').registerWriteTools as jest.Mock;

    readTools.mockImplementationOnce((registrar: { registerTool: Function }) => {
      registrar.registerTool('lsp_init', { description: 'init' }, async () => ({ content: [{ type: 'text', text: 'ok' }], raw: null }));
      registrar.registerTool('lsp_hover', { description: 'hover' }, async () => ({ content: [{ type: 'text', text: 'hover' }], raw: null }));
    });
    writeTools.mockImplementationOnce(() => undefined);

    const { ListToolsRequestSchema } = jest.requireActual('@modelcontextprotocol/sdk/types.js') as { ListToolsRequestSchema: unknown };

    const server = new McpServer('info');
    await server.start();
    server.setManager({} as LifecycleManager);

    const listHandler = getHandler(ListToolsRequestSchema);
    const result = await listHandler({});

    expect(result.tools.map((t: { name: string }) => t.name)).toContain('lsp_init');
    expect(result.tools.map((t: { name: string }) => t.name)).toContain('lsp_hover');
  });

  it('returns no-root error for non-init tools before lsp_init', async () => {
    const readTools = jest.requireMock('../tools/read-tools').registerReadTools as jest.Mock;
    const writeTools = jest.requireMock('../tools/write-tools').registerWriteTools as jest.Mock;

    readTools.mockImplementationOnce((registrar: { registerTool: Function }) => {
      registrar.registerTool('lsp_hover', { description: 'hover' }, async () => ({ content: [{ type: 'text', text: 'reachable' }], raw: null }));
    });
    writeTools.mockImplementationOnce(() => undefined);

    const { CallToolRequestSchema } = jest.requireActual('@modelcontextprotocol/sdk/types.js') as { CallToolRequestSchema: unknown };

    const server = new McpServer('info');
    await server.start();

    const callHandler = getHandler(CallToolRequestSchema);
    const result = await callHandler({ params: { name: 'lsp_hover', arguments: {} } });

    expect(result.content[0].text).toMatch(/No project root set/);
  });

  it('re-initializes with new root when lsp_init called again', async () => {
    const readTools = jest.requireMock('../tools/read-tools').registerReadTools as jest.Mock;
    const writeTools = jest.requireMock('../tools/write-tools').registerWriteTools as jest.Mock;

    readTools.mockImplementationOnce((registrar: { registerTool: Function }) => {
      registrar.registerTool('lsp_init', { description: 'init' }, async () => ({ content: [{ type: 'text', text: 'ok' }], raw: null }));
    });
    writeTools.mockImplementationOnce(() => undefined);

    const { CallToolRequestSchema } = jest.requireActual('@modelcontextprotocol/sdk/types.js') as { CallToolRequestSchema: unknown };

    const server = new McpServer('info');
    await server.start();
    server.setManager({} as LifecycleManager);

    const callHandler = getHandler(CallToolRequestSchema);
    const result = await callHandler({ params: { name: 'lsp_init', arguments: { root: '/x' } } });

    expect(result.content[0].text).toMatch(/Already initialized/);
  });

  it('shuts down the old manager before starting a new one', async () => {
    const order: string[] = [];
    const firstManager = {
      start: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockImplementation(async () => { order.push('shutdown-first'); }),
      getHealth: jest.fn().mockReturnValue([{ language: 'typescript', status: 'ready' }])
    };
    const secondManager = {
      start: jest.fn().mockImplementation(async () => { order.push('start-second'); }),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getHealth: jest.fn().mockReturnValue([{ language: 'python', status: 'ready' }])
    };

    const factory = jest.fn()
      .mockReturnValueOnce(firstManager)
      .mockReturnValueOnce(secondManager);

    const server = new McpServer('debug', factory as unknown as (root: string, logLevel: string) => LifecycleManager);

    await expect(server.initializeManager('/workspace-one')).resolves.toEqual({
      root: '/workspace-one',
      health: [{ language: 'typescript', status: 'ready' }]
    });
    await expect(server.initializeManager('/workspace-two')).resolves.toEqual({
      root: '/workspace-two',
      health: [{ language: 'python', status: 'ready' }]
    });

    expect(order).toEqual(['shutdown-first', 'start-second']);
  });

  it('tolerates shutdown with no active manager', async () => {
    const server = new McpServer('info');
    await expect(server.shutdown()).resolves.toBeUndefined();
  });

  it('shuts down active manager on server shutdown', async () => {
    const manager = { shutdown: jest.fn().mockResolvedValue(undefined) } as unknown as LifecycleManager;
    const server = new McpServer('info');
    server.setManager(manager);
    await server.shutdown();
    expect(manager.shutdown).toHaveBeenCalledTimes(1);
  });
});
