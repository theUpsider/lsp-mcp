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

describe('McpServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('registers all read and write tools and connects stdio transport', async () => {
    const lifecycle = {} as never;
    const readTools = jest.requireMock('../tools/read-tools').registerReadTools as jest.Mock;
    const writeTools = jest.requireMock('../tools/write-tools').registerWriteTools as jest.Mock;
    const SdkMcpServer = jest.requireMock('@modelcontextprotocol/sdk/server/mcp.js').McpServer as jest.Mock;
    const transportCtor = jest.requireMock('@modelcontextprotocol/sdk/server/stdio.js').StdioServerTransport as jest.Mock;

    const server = new McpServer(lifecycle);
    await server.start();

    const sdkInstance = SdkMcpServer.mock.results[0]?.value;
    expect(readTools).toHaveBeenCalledWith(expect.objectContaining({ registerTool: expect.any(Function), fromJsonSchema: expect.any(Function) }), lifecycle);
    expect(writeTools).toHaveBeenCalledWith(expect.objectContaining({ registerTool: expect.any(Function), fromJsonSchema: expect.any(Function) }), lifecycle);
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

    const server = new McpServer({} as never);
    await server.start();

    const sdkInstance = SdkMcpServer.mock.results[0]?.value;
    const handler = sdkInstance.registerTool.mock.calls[0][2] as (args: unknown) => Promise<unknown>;

    await expect(handler({ value: 'ok' })).resolves.toEqual({ content: [{ type: 'text', text: 'ok' }], raw: { value: 'ok' } });
    await expect(handler(null)).resolves.toEqual({ content: [{ type: 'text', text: 'empty' }], raw: {} });
  });
});
