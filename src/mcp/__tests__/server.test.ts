jest.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    registerTool: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({ kind: 'stdio' }))
}));

jest.mock('../tools/read-tools', () => ({ registerReadTools: jest.fn() }));
jest.mock('../tools/write-tools', () => ({ registerWriteTools: jest.fn() }));

import { McpServer } from '../server';

import type { LifecycleManager } from '../../lsp/lifecycle-manager';

describe('McpServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers all read and write tools and connects stdio transport', async () => {
    const readTools = jest.requireMock('../tools/read-tools').registerReadTools as jest.Mock;
    const writeTools = jest.requireMock('../tools/write-tools').registerWriteTools as jest.Mock;
    const SdkMcpServer = jest.requireMock('@modelcontextprotocol/sdk/server/mcp.js').McpServer as jest.Mock;
    const transportCtor = jest.requireMock('@modelcontextprotocol/sdk/server/stdio.js').StdioServerTransport as jest.Mock;

    const server = new McpServer('info');
    await server.start();

    const sdkInstance = SdkMcpServer.mock.results[0]?.value;
    expect(readTools).toHaveBeenCalledWith(
      expect.objectContaining({ registerTool: expect.any(Function), fromJsonSchema: expect.any(Function) }),
      expect.objectContaining({ getClientForFile: expect.any(Function), getReadyClients: expect.any(Function), getFileDiagnostics: expect.any(Function), getWorkspaceDiagnostics: expect.any(Function), getHealth: expect.any(Function) }),
      expect.objectContaining({ initializeManager: expect.any(Function) })
    );
    expect(writeTools).toHaveBeenCalledWith(
      expect.objectContaining({ registerTool: expect.any(Function), fromJsonSchema: expect.any(Function) }),
      expect.objectContaining({ getClientForFile: expect.any(Function), getReadyClients: expect.any(Function), getFileDiagnostics: expect.any(Function), getWorkspaceDiagnostics: expect.any(Function), getHealth: expect.any(Function) })
    );
    expect(transportCtor).toHaveBeenCalledTimes(1);
    expect(sdkInstance.connect).toHaveBeenCalledWith({ kind: 'stdio' });
  });

  it('adapts tool handlers and preserves input schemas', async () => {
    const readTools = jest.requireMock('../tools/read-tools').registerReadTools as jest.Mock;
    const writeTools = jest.requireMock('../tools/write-tools').registerWriteTools as jest.Mock;
    const SdkMcpServer = jest.requireMock('@modelcontextprotocol/sdk/server/mcp.js').McpServer as jest.Mock;

    readTools.mockImplementationOnce((registrar: { registerTool: Function }) => {
      registrar.registerTool('typed_tool', { description: 'desc', inputSchema: { parse: jest.fn() } }, async (args: Record<string, unknown>) => ({
        content: [{ type: 'text', text: String(args.value ?? 'empty') }],
        raw: args
      }));
    });
    writeTools.mockImplementationOnce(() => undefined);

    const server = new McpServer('info');
    await server.start();
    server.setManager({} as LifecycleManager);

    const sdkInstance = SdkMcpServer.mock.results[0]?.value;
    const handler = sdkInstance.registerTool.mock.calls[0][2] as (args: unknown) => Promise<unknown>;

    await expect(handler({ value: 'ok' })).resolves.toEqual({ content: [{ type: 'text', text: 'ok' }], raw: { value: 'ok' } });
    await expect(handler(null)).resolves.toEqual({ content: [{ type: 'text', text: 'empty' }], raw: {} });
  });

  it('returns a no-root error for non-init tools before lsp_init', async () => {
    const readTools = jest.requireMock('../tools/read-tools').registerReadTools as jest.Mock;
    const writeTools = jest.requireMock('../tools/write-tools').registerWriteTools as jest.Mock;
    const SdkMcpServer = jest.requireMock('@modelcontextprotocol/sdk/server/mcp.js').McpServer as jest.Mock;

    readTools.mockImplementationOnce((registrar: { registerTool: Function }) => {
      registrar.registerTool('lsp_init', { description: 'init' }, async () => ({ content: [{ type: 'text', text: 'ok' }], raw: null }));
      registrar.registerTool('lsp_hover', { description: 'hover' }, async () => ({ content: [{ type: 'text', text: 'reachable' }], raw: null }));
    });
    writeTools.mockImplementationOnce(() => undefined);

    const server = new McpServer('info');
    await server.start();

    const sdkInstance = SdkMcpServer.mock.results[0]?.value;
    const hoverHandler = sdkInstance.registerTool.mock.calls[1][2] as (args: unknown) => Promise<unknown>;

    await expect(hoverHandler({})).resolves.toEqual({
      content: [{ type: 'text', text: "No project root set. Call lsp_init({ root: '/path/to/project' }) first." }],
      text: "No project root set. Call lsp_init({ root: '/path/to/project' }) first.",
      error: true,
      raw: null
    });
  });

  it('allows lsp_init handlers to run before a manager exists', async () => {
    const readTools = jest.requireMock('../tools/read-tools').registerReadTools as jest.Mock;
    const writeTools = jest.requireMock('../tools/write-tools').registerWriteTools as jest.Mock;
    const SdkMcpServer = jest.requireMock('@modelcontextprotocol/sdk/server/mcp.js').McpServer as jest.Mock;

    readTools.mockImplementationOnce((registrar: { registerTool: Function }) => {
      registrar.registerTool('lsp_init', { description: 'init' }, async () => ({ content: [{ type: 'text', text: 'initialized' }], raw: { ok: true } }));
    });
    writeTools.mockImplementationOnce(() => undefined);

    const server = new McpServer('info');
    await server.start();

    const sdkInstance = SdkMcpServer.mock.results[0]?.value;
    const initHandler = sdkInstance.registerTool.mock.calls[0][2] as (args: unknown) => Promise<unknown>;

    await expect(initHandler({ root: '/workspace' })).resolves.toEqual({
      content: [{ type: 'text', text: 'initialized' }],
      raw: { ok: true }
    });
  });

  it('shuts down the old manager before starting a new one', async () => {
    const firstManager = {
      start: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockImplementation(async () => {
        order.push('shutdown-first');
      }),
      getHealth: jest.fn().mockReturnValue([{ language: 'typescript', status: 'ready' }])
    };
    const secondManager = {
      start: jest.fn().mockImplementation(async () => {
        order.push('start-second');
      }),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getHealth: jest.fn().mockReturnValue([{ language: 'python', status: 'ready' }])
    };
    const order: string[] = [];
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

    expect(factory).toHaveBeenNthCalledWith(1, '/workspace-one', 'debug');
    expect(factory).toHaveBeenNthCalledWith(2, '/workspace-two', 'debug');
    expect(order).toEqual(['shutdown-first', 'start-second']);
  });

  it('shuts down the active manager and tolerates missing managers on shutdown', async () => {
    const manager = {
      shutdown: jest.fn().mockResolvedValue(undefined)
    } as unknown as LifecycleManager;
    const server = new McpServer('info');

    await expect(server.shutdown()).resolves.toBeUndefined();

    server.setManager(manager);
    await expect(server.shutdown()).resolves.toBeUndefined();

    expect(manager.shutdown).toHaveBeenCalledTimes(1);
  });
});
