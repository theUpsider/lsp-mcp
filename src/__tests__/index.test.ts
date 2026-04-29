jest.mock('../lsp/lifecycle-manager', () => ({
  LifecycleManager: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined),
    shutdown: jest.fn().mockResolvedValue(undefined),
    getHealth: jest.fn().mockReturnValue([{ language: 'typescript', status: 'ready' }])
  }))
}));

jest.mock('../mcp/server', () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    start: jest.fn().mockResolvedValue(undefined)
  }))
}));

import { main } from '../index';

describe('index entrypoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exits with code 1 when LSP_MCP_ROOT is missing', async () => {
    const stderr = jest.fn();
    const exit = jest.fn();

    await main([], {}, { stderr, exit });

    expect(stderr).toHaveBeenCalledWith('LSP_MCP_ROOT is required\n');
    expect(exit).toHaveBeenCalledWith(1);
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
    const LifecycleManager = jest.requireMock('../lsp/lifecycle-manager').LifecycleManager as jest.Mock;
    const McpServer = jest.requireMock('../mcp/server').McpServer as jest.Mock;

    await main([], { LSP_MCP_ROOT: '/workspace', LSP_MCP_LOG_LEVEL: 'debug' }, { stderr, onSignal });

    expect(LifecycleManager).toHaveBeenCalledWith('/workspace', 'debug');
    expect(stderr).toHaveBeenCalledWith(`${JSON.stringify({ languages: ['typescript'], started: ['typescript'], errors: [] })}\n`);
    expect(McpServer).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledTimes(2);
  });
});
