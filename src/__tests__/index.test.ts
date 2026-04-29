jest.mock('../mcp/server', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    initializeManager: jest.fn().mockResolvedValue({ root: '/workspace', health: [{ language: 'typescript', status: 'ready' }] }),
    shutdown: jest.fn().mockResolvedValue(undefined)
  }))
}));

import { main } from '../index';

describe('index entrypoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts and waits for lsp_init when LSP_MCP_ROOT is missing', async () => {
    const stderr = jest.fn();
    const exit = jest.fn();
    const McpServer = jest.requireMock('../mcp/server').McpServer as jest.Mock;

    await main([], {}, { stderr, exit });

    const serverInstance = McpServer.mock.results[0]?.value;
    expect(stderr).toHaveBeenCalledWith(`${JSON.stringify({ event: 'startup', status: 'waiting-for-init' })}\n`);
    expect(serverInstance.initializeManager).not.toHaveBeenCalled();
    expect(serverInstance.start).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();
  });

  it('prints version and exits for --version', async () => {
    const stdout = jest.fn();
    const exit = jest.fn();

    await main(['--version'], {}, { stdout, exit });

    expect(stdout).toHaveBeenCalledWith('0.1.0\n');
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('boots lifecycle, logs startup report, and starts the MCP server', async () => {
    const stderr = jest.fn();
    const onSignal = jest.fn();
    const McpServer = jest.requireMock('../mcp/server').McpServer as jest.Mock;

    await main([], { LSP_MCP_ROOT: '/workspace', LSP_MCP_LOG_LEVEL: 'debug' }, { stderr, onSignal });

    const serverInstance = McpServer.mock.results[0]?.value;
    expect(McpServer).toHaveBeenCalledWith('debug');
    expect(serverInstance.initializeManager).toHaveBeenCalledWith('/workspace');
    expect(stderr).toHaveBeenCalledWith(`${JSON.stringify({ languages: ['typescript'], started: ['typescript'], errors: [] })}\n`);
    expect(McpServer).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledTimes(2);
  });
});
