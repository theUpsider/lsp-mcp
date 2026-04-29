import { EventEmitter } from 'node:events';

import { LifecycleManager } from '../lifecycle-manager';

import type { DetectedLanguage } from '../../detection/language-detector';
import type { LspCandidate } from '../../detection/lsp-mapping';
import type { ServerCapabilities } from 'vscode-languageserver-protocol';

jest.mock('../../detection/language-detector', () => ({
  detectLanguages: jest.fn()
}));

jest.mock('../../detection/lsp-mapping', () => ({
  findAvailableLsp: jest.fn(),
  getLspCandidates: jest.fn()
}));

jest.mock('../installer', () => ({
  installLsp: jest.fn()
}));

jest.mock('../lsp-client', () => ({
  LspClient: jest.fn()
}));

class MockLspClient extends EventEmitter {
  public readonly start = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  public readonly shutdown = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
  public readonly request = jest.fn<Promise<unknown>, [string, unknown, number]>().mockResolvedValue({ items: [] });
  public readonly isReady = jest.fn<boolean, []>().mockReturnValue(true);
  public readonly getCapabilities = jest.fn<ServerCapabilities | null, []>().mockReturnValue({ hoverProvider: true });
}

describe('LifecycleManager', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('starts detected language servers and reports their health', async () => {
    const detectLanguages = jest.requireMock('../../detection/language-detector').detectLanguages as jest.MockedFunction<(projectRoot: string) => Promise<DetectedLanguage[]>>;
    const findAvailableLsp = jest.requireMock('../../detection/lsp-mapping').findAvailableLsp as jest.MockedFunction<(language: string) => Promise<LspCandidate | null>>;
    const getLspCandidates = jest.requireMock('../../detection/lsp-mapping').getLspCandidates as jest.MockedFunction<(language: string) => LspCandidate[]>;
    const LspClient = jest.requireMock('../lsp-client').LspClient as jest.MockedClass<typeof import('../lsp-client').LspClient>;

    detectLanguages.mockResolvedValue([{ language: 'typescript', confidence: 'marker', markers: ['tsconfig.json'] }]);
    findAvailableLsp.mockResolvedValue({ cmd: 'typescript-language-server', args: ['--stdio'], pkg: 'typescript-language-server', mgr: 'npm' });
    getLspCandidates.mockReturnValue([]);
    LspClient.mockImplementation(() => new MockLspClient() as unknown as import('../lsp-client').LspClient);

    const manager = new LifecycleManager('/workspace/project', 'debug');
    await manager.start();

    expect(detectLanguages).toHaveBeenCalledWith('/workspace/project');
    expect(findAvailableLsp).toHaveBeenCalledWith('typescript');
    expect(manager.getClient('typescript')).not.toBeNull();
    expect(manager.getHealth()).toEqual([
      {
        language: 'typescript',
        status: 'ready',
        capabilities: { hoverProvider: true }
      }
    ]);

    await manager.shutdown();
  });

  it('records per-language startup errors without failing the whole boot', async () => {
    const detectLanguages = jest.requireMock('../../detection/language-detector').detectLanguages as jest.MockedFunction<(projectRoot: string) => Promise<DetectedLanguage[]>>;
    const findAvailableLsp = jest.requireMock('../../detection/lsp-mapping').findAvailableLsp as jest.MockedFunction<(language: string) => Promise<LspCandidate | null>>;
    const getLspCandidates = jest.requireMock('../../detection/lsp-mapping').getLspCandidates as jest.MockedFunction<(language: string) => LspCandidate[]>;
    const installLsp = jest.requireMock('../installer').installLsp as jest.MockedFunction<(candidate: LspCandidate) => Promise<{ success: boolean; error?: string; instructions?: string }>>;
    const LspClient = jest.requireMock('../lsp-client').LspClient as jest.MockedClass<typeof import('../lsp-client').LspClient>;

    detectLanguages.mockResolvedValue([
      { language: 'typescript', confidence: 'marker', markers: ['tsconfig.json'] },
      { language: 'python', confidence: 'marker', markers: ['pyproject.toml'] }
    ]);
    findAvailableLsp.mockImplementation(async (language) => language === 'typescript'
      ? { cmd: 'typescript-language-server', args: ['--stdio'], pkg: 'typescript-language-server', mgr: 'npm' }
      : null);
    getLspCandidates.mockImplementation((language) => language === 'python'
      ? [{ cmd: 'pylsp', args: [], pkg: 'python-lsp-server', mgr: 'pip' }]
      : []);
    installLsp.mockResolvedValue({ success: false, error: 'install failed', instructions: 'pip install python-lsp-server' });
    LspClient.mockImplementation(() => new MockLspClient() as unknown as import('../lsp-client').LspClient);

    const manager = new LifecycleManager('/workspace/project', 'debug');
    await manager.start();

    expect(manager.getHealth()).toEqual([
      {
        language: 'typescript',
        status: 'ready',
        capabilities: { hoverProvider: true }
      },
      {
        language: 'python',
        status: 'error',
        error: 'No LSP server available for python',
        capabilities: undefined
      }
    ]);

    await manager.shutdown();
  });

  it('routes files to clients by file extension', async () => {
    const detectLanguages = jest.requireMock('../../detection/language-detector').detectLanguages as jest.MockedFunction<(projectRoot: string) => Promise<DetectedLanguage[]>>;
    const findAvailableLsp = jest.requireMock('../../detection/lsp-mapping').findAvailableLsp as jest.MockedFunction<(language: string) => Promise<LspCandidate | null>>;
    const getLspCandidates = jest.requireMock('../../detection/lsp-mapping').getLspCandidates as jest.MockedFunction<(language: string) => LspCandidate[]>;
    const LspClient = jest.requireMock('../lsp-client').LspClient as jest.MockedClass<typeof import('../lsp-client').LspClient>;

    detectLanguages.mockResolvedValue([
      { language: 'typescript', confidence: 'marker', markers: ['tsconfig.json'] },
      { language: 'python', confidence: 'marker', markers: ['pyproject.toml'] }
    ]);
    findAvailableLsp.mockImplementation(async (language) => ({
      cmd: language === 'typescript' ? 'typescript-language-server' : 'pylsp',
      args: language === 'typescript' ? ['--stdio'] : [],
      pkg: language === 'typescript' ? 'typescript-language-server' : 'python-lsp-server',
      mgr: language === 'typescript' ? 'npm' : 'pip'
    }));
    getLspCandidates.mockReturnValue([]);
    LspClient.mockImplementation(() => new MockLspClient() as unknown as import('../lsp-client').LspClient);

    const manager = new LifecycleManager('/workspace/project', 'debug');
    await manager.start();

    expect(manager.getClientForFile('/workspace/project/src/index.ts')).toBe(manager.getClient('typescript'));
    expect(manager.getClientForFile('/workspace/project/app/main.py')).toBe(manager.getClient('python'));
    expect(manager.getClientForFile('/workspace/project/README.md')).toBeNull();

    await manager.shutdown();
  });

  it('restarts a client after a failed health ping', async () => {
    jest.useFakeTimers();
    const detectLanguages = jest.requireMock('../../detection/language-detector').detectLanguages as jest.MockedFunction<(projectRoot: string) => Promise<DetectedLanguage[]>>;
    const findAvailableLsp = jest.requireMock('../../detection/lsp-mapping').findAvailableLsp as jest.MockedFunction<(language: string) => Promise<LspCandidate | null>>;
    const getLspCandidates = jest.requireMock('../../detection/lsp-mapping').getLspCandidates as jest.MockedFunction<(language: string) => LspCandidate[]>;
    const LspClient = jest.requireMock('../lsp-client').LspClient as jest.MockedClass<typeof import('../lsp-client').LspClient>;

    const firstClient = new MockLspClient();
    firstClient.request.mockRejectedValueOnce(new Error('ping timeout'));
    const secondClient = new MockLspClient();

    detectLanguages.mockResolvedValue([{ language: 'typescript', confidence: 'marker', markers: ['tsconfig.json'] }]);
    findAvailableLsp.mockResolvedValue({ cmd: 'typescript-language-server', args: ['--stdio'], pkg: 'typescript-language-server', mgr: 'npm' });
    getLspCandidates.mockReturnValue([]);
    LspClient.mockImplementationOnce(() => firstClient as unknown as import('../lsp-client').LspClient);
    LspClient.mockImplementationOnce(() => secondClient as unknown as import('../lsp-client').LspClient);

    const manager = new LifecycleManager('/workspace/project', 'debug');
    await manager.start();

    await jest.advanceTimersByTimeAsync(30000);

    expect(firstClient.request).toHaveBeenCalledWith('workspace/symbol', { query: '__lsp_mcp_healthcheck__' }, 5000);
    expect(secondClient.start).toHaveBeenCalled();
    expect(manager.getClient('typescript')).toBe(secondClient);

    await manager.shutdown();
  });

  it('attempts installation when no server is available and starts the installed candidate', async () => {
    const detectLanguages = jest.requireMock('../../detection/language-detector').detectLanguages as jest.MockedFunction<(projectRoot: string) => Promise<DetectedLanguage[]>>;
    const findAvailableLsp = jest.requireMock('../../detection/lsp-mapping').findAvailableLsp as jest.MockedFunction<(language: string) => Promise<LspCandidate | null>>;
    const getLspCandidates = jest.requireMock('../../detection/lsp-mapping').getLspCandidates as jest.MockedFunction<(language: string) => LspCandidate[]>;
    const installLsp = jest.requireMock('../installer').installLsp as jest.MockedFunction<(candidate: LspCandidate) => Promise<{ success: boolean; error?: string; instructions?: string }>>;
    const LspClient = jest.requireMock('../lsp-client').LspClient as jest.MockedClass<typeof import('../lsp-client').LspClient>;

    const candidate = { cmd: 'pylsp', args: [], pkg: 'python-lsp-server', mgr: 'pip' } satisfies LspCandidate;
    detectLanguages.mockResolvedValue([{ language: 'python', confidence: 'marker', markers: ['pyproject.toml'] }]);
    findAvailableLsp.mockResolvedValue(null);
    getLspCandidates.mockReturnValue([candidate]);
    installLsp.mockResolvedValue({ success: true });
    LspClient.mockImplementation(() => new MockLspClient() as unknown as import('../lsp-client').LspClient);

    const manager = new LifecycleManager('/workspace/project', 'verbose');
    await manager.start();

    expect(installLsp).toHaveBeenCalledWith(candidate);
    expect(LspClient).toHaveBeenCalledWith(candidate, '/workspace/project', 'info');

    await manager.shutdown();
  });

  it('surfaces client start failures in health status', async () => {
    const detectLanguages = jest.requireMock('../../detection/language-detector').detectLanguages as jest.MockedFunction<(projectRoot: string) => Promise<DetectedLanguage[]>>;
    const findAvailableLsp = jest.requireMock('../../detection/lsp-mapping').findAvailableLsp as jest.MockedFunction<(language: string) => Promise<LspCandidate | null>>;
    const getLspCandidates = jest.requireMock('../../detection/lsp-mapping').getLspCandidates as jest.MockedFunction<(language: string) => LspCandidate[]>;
    const LspClient = jest.requireMock('../lsp-client').LspClient as jest.MockedClass<typeof import('../lsp-client').LspClient>;

    const failingClient = new MockLspClient();
    failingClient.start.mockRejectedValue(new Error('startup failed'));

    detectLanguages.mockResolvedValue([{ language: 'typescript', confidence: 'marker', markers: ['tsconfig.json'] }]);
    findAvailableLsp.mockResolvedValue({ cmd: 'typescript-language-server', args: ['--stdio'], pkg: 'typescript-language-server', mgr: 'npm' });
    getLspCandidates.mockReturnValue([]);
    LspClient.mockImplementation(() => failingClient as unknown as import('../lsp-client').LspClient);

    const manager = new LifecycleManager('/workspace/project', 'debug');
    await manager.start();

    expect(manager.getHealth()).toEqual([
      {
        language: 'typescript',
        status: 'error',
        error: 'startup failed',
        capabilities: undefined
      }
    ]);

    await manager.shutdown();
  });

  it('reports shutdown failures in the log', async () => {
    const detectLanguages = jest.requireMock('../../detection/language-detector').detectLanguages as jest.MockedFunction<(projectRoot: string) => Promise<DetectedLanguage[]>>;
    const findAvailableLsp = jest.requireMock('../../detection/lsp-mapping').findAvailableLsp as jest.MockedFunction<(language: string) => Promise<LspCandidate | null>>;
    const getLspCandidates = jest.requireMock('../../detection/lsp-mapping').getLspCandidates as jest.MockedFunction<(language: string) => LspCandidate[]>;
    const LspClient = jest.requireMock('../lsp-client').LspClient as jest.MockedClass<typeof import('../lsp-client').LspClient>;

    const failingShutdownClient = new MockLspClient();
    failingShutdownClient.shutdown.mockRejectedValue(new Error('shutdown failed'));

    detectLanguages.mockResolvedValue([{ language: 'typescript', confidence: 'marker', markers: ['tsconfig.json'] }]);
    findAvailableLsp.mockResolvedValue({ cmd: 'typescript-language-server', args: ['--stdio'], pkg: 'typescript-language-server', mgr: 'npm' });
    getLspCandidates.mockReturnValue([]);
    LspClient.mockImplementation(() => failingShutdownClient as unknown as import('../lsp-client').LspClient);

    const stderrWrite = jest.spyOn(process.stderr, 'write').mockReturnValue(true);
    const manager = new LifecycleManager('/workspace/project', 'debug');
    await manager.start();

    await manager.shutdown();

    expect(stderrWrite).toHaveBeenLastCalledWith(expect.stringContaining('Shutdown: 0 LSP-Server beendet, 1 Fehler'));
    stderrWrite.mockRestore();
  });

  it('marks a language as error when no candidate exists to install', async () => {
    const detectLanguages = jest.requireMock('../../detection/language-detector').detectLanguages as jest.MockedFunction<(projectRoot: string) => Promise<DetectedLanguage[]>>;
    const findAvailableLsp = jest.requireMock('../../detection/lsp-mapping').findAvailableLsp as jest.MockedFunction<(language: string) => Promise<LspCandidate | null>>;
    const getLspCandidates = jest.requireMock('../../detection/lsp-mapping').getLspCandidates as jest.MockedFunction<(language: string) => LspCandidate[]>;

    detectLanguages.mockResolvedValue([{ language: 'unknown-language', confidence: 'extension', markers: ['main.unknown'] }]);
    findAvailableLsp.mockResolvedValue(null);
    getLspCandidates.mockReturnValue([]);

    const manager = new LifecycleManager('/workspace/project', 'debug');
    await manager.start();

    expect(manager.getHealth()).toEqual([
      {
        language: 'unknown-language',
        status: 'error',
        error: 'No LSP server available for unknown-language',
        capabilities: undefined
      }
    ]);

    await manager.shutdown();
  });

  it('stops restarting once the max restart count is reached', async () => {
    const detectLanguages = jest.requireMock('../../detection/language-detector').detectLanguages as jest.MockedFunction<(projectRoot: string) => Promise<DetectedLanguage[]>>;
    const findAvailableLsp = jest.requireMock('../../detection/lsp-mapping').findAvailableLsp as jest.MockedFunction<(language: string) => Promise<LspCandidate | null>>;
    const getLspCandidates = jest.requireMock('../../detection/lsp-mapping').getLspCandidates as jest.MockedFunction<(language: string) => LspCandidate[]>;
    const LspClient = jest.requireMock('../lsp-client').LspClient as jest.MockedClass<typeof import('../lsp-client').LspClient>;

    const client = new MockLspClient();

    detectLanguages.mockResolvedValue([{ language: 'typescript', confidence: 'marker', markers: ['tsconfig.json'] }]);
    findAvailableLsp.mockResolvedValue({ cmd: 'typescript-language-server', args: ['--stdio'], pkg: 'typescript-language-server', mgr: 'npm' });
    getLspCandidates.mockReturnValue([]);
    LspClient.mockImplementation(() => client as unknown as import('../lsp-client').LspClient);

    const manager = new LifecycleManager('/workspace/project', 'debug');
    await manager.start();

    const managerAccess = manager as unknown as {
      states: Map<string, {
        restartCount: number;
        client: MockLspClient | null;
        status: 'ready' | 'error' | 'starting';
        error?: string;
      }>;
      restartLanguage: (state: {
        restartCount: number;
        client: MockLspClient | null;
        status: 'ready' | 'error' | 'starting';
        error?: string;
      }, reason: string) => Promise<void>;
    };
    const state = managerAccess.states.get('typescript');

    expect(state).toBeDefined();
    if (!state) {
      throw new Error('Expected typescript state');
    }

    state.restartCount = 3;
    await managerAccess.restartLanguage(state, 'too many restarts');

    expect(manager.getClient('typescript')).toBeNull();
    expect(manager.getHealth()).toEqual([
      {
        language: 'typescript',
        status: 'error',
        error: 'too many restarts',
        capabilities: { hoverProvider: true }
      }
    ]);

    await manager.shutdown();
  });

  it('stores published diagnostics and exposes ready clients', async () => {
    const detectLanguages = jest.requireMock('../../detection/language-detector').detectLanguages as jest.MockedFunction<(projectRoot: string) => Promise<DetectedLanguage[]>>;
    const findAvailableLsp = jest.requireMock('../../detection/lsp-mapping').findAvailableLsp as jest.MockedFunction<(language: string) => Promise<LspCandidate | null>>;
    const getLspCandidates = jest.requireMock('../../detection/lsp-mapping').getLspCandidates as jest.MockedFunction<(language: string) => LspCandidate[]>;
    const LspClient = jest.requireMock('../lsp-client').LspClient as jest.MockedClass<typeof import('../lsp-client').LspClient>;

    const client = new MockLspClient();
    detectLanguages.mockResolvedValue([{ language: 'typescript', confidence: 'marker', markers: ['tsconfig.json'] }]);
    findAvailableLsp.mockResolvedValue({ cmd: 'typescript-language-server', args: ['--stdio'], pkg: 'typescript-language-server', mgr: 'npm' });
    getLspCandidates.mockReturnValue([]);
    LspClient.mockImplementation(() => client as unknown as import('../lsp-client').LspClient);

    const manager = new LifecycleManager('/workspace/project', 'debug');
    await manager.start();
    client.emit('notification', 'textDocument/publishDiagnostics', {
      uri: 'file:///workspace/project/src/index.ts',
      diagnostics: [{ message: 'Boom', severity: 1, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }]
    });

    expect(manager.getReadyClients()).toEqual([client]);
    expect(manager.getFileDiagnostics('/workspace/project/src/index.ts')).toEqual([
      {
        uri: 'file:///workspace/project/src/index.ts',
        message: 'Boom',
        severity: 1,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
      }
    ]);
    expect(manager.getWorkspaceDiagnostics('typescript')).toEqual([
      {
        uri: 'file:///workspace/project/src/index.ts',
        message: 'Boom',
        severity: 1,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
      }
    ]);

    await manager.shutdown();
  });

  it('handles empty detections and aggregates workspace diagnostics without filters', async () => {
    const detectLanguages = jest.requireMock('../../detection/language-detector').detectLanguages as jest.MockedFunction<(projectRoot: string) => Promise<DetectedLanguage[]>>;

    detectLanguages.mockResolvedValue([]);

    const manager = new LifecycleManager('/workspace/project', 'debug');
    await manager.start();

    expect(manager.getHealth()).toEqual([]);
    expect(manager.getReadyClients()).toEqual([]);
    expect(manager.getWorkspaceDiagnostics()).toEqual([]);

    await manager.shutdown();
  });
});
