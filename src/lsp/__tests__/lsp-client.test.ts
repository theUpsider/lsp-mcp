import { EventEmitter } from 'node:events';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';

import { LspClient } from '../lsp-client';

import type { LspCandidate } from '../../detection/lsp-mapping';

jest.mock('node:child_process', () => ({
  spawn: jest.fn()
}));

type SpawnMock = typeof import('node:child_process').spawn;

class MockChildProcess extends EventEmitter {
  public readonly stdinWrites: string[] = [];
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public readonly stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.stdinWrites.push(chunk.toString());
      callback();
    }
  });

  public kill = jest.fn();
}

const SERVER: LspCandidate = {
  cmd: 'typescript-language-server',
  args: ['--stdio'],
  pkg: 'typescript-language-server',
  mgr: 'npm'
};

describe('LspClient', () => {
  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('starts the server, sends initialize, and becomes ready after initialize response', async () => {
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    const startPromise = client.start();

    const initializeMessage = extractMessage(child.stdinWrites[0]);
    expect(initializeMessage.method).toBe('initialize');
    expect(getObject(initializeMessage.params).workspaceFolders).toEqual([
      { uri: 'file:///workspace/project', name: 'project' }
    ]);

    child.stdout.write(encodeMessage({
      jsonrpc: '2.0',
      id: initializeMessage.id,
      result: { capabilities: { hoverProvider: true } }
    }));

    await startPromise;

    expect(client.isReady()).toBe(true);
    const initializedMessage = extractMessage(child.stdinWrites[1]);
    expect(initializedMessage.method).toBe('initialized');
    expect(initializedMessage.params).toEqual({});
  });

  it('sends framed JSON-RPC requests and resolves matching responses', async () => {
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    await startClient(client, child);

    const hoverPromise = client.request<{ contents: string }>('textDocument/hover', {
      textDocument: { uri: 'file:///workspace/project/src/index.ts' },
      position: { line: 0, character: 1 }
    }, 1000);

    const hoverRequest = extractMessage(child.stdinWrites[2]);
    expect(child.stdinWrites[2]).toMatch(/^Content-Length: \d+\r\n\r\n\{/);
    expect(hoverRequest.method).toBe('textDocument/hover');

    child.stdout.write(encodeMessage({
      jsonrpc: '2.0',
      id: hoverRequest.id,
      result: { contents: 'hover text' }
    }));

    await expect(hoverPromise).resolves.toEqual({ contents: 'hover text' });
    expect(client.getCapabilities()).toEqual({ hoverProvider: true });
  });

  it('rejects requests that exceed their timeout', async () => {
    jest.useFakeTimers();
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    await startClient(client, child);

    const hoverPromise = client.request('textDocument/hover', {}, 250);
    const expectation = expect(hoverPromise).rejects.toThrow('LSP request timed out: textDocument/hover');
    await jest.advanceTimersByTimeAsync(250);

    await expectation;
  });

  it('parses multibyte JSON-RPC payloads using byte-length framing', async () => {
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    await startClient(client, child);

    const hoverPromise = client.request<{ contents: string }>('textDocument/hover', {
      textDocument: { uri: 'file:///workspace/project/src/index.ts' },
      position: { line: 0, character: 1 }
    }, 1000);

    const hoverRequest = extractMessage(child.stdinWrites[2]);
    child.stdout.emit('data', encodeMessage({
      jsonrpc: '2.0',
      id: hoverRequest.id,
      result: { contents: 'Grüße 👋' }
    }));

    await expect(hoverPromise).resolves.toEqual({ contents: 'Grüße 👋' });
  });

  it('emits crash when the server exits unexpectedly', async () => {
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    await startClient(client, child);

    const crashPromise = onceErrorEvent(client, 'crash');
    child.emit('exit', 9, null);

    await expect(crashPromise).resolves.toThrow('LSP server exited unexpectedly');
    expect(client.isReady()).toBe(false);
  });

  it('rejects requests when the server returns a JSON-RPC error response', async () => {
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    await startClient(client, child);

    const hoverPromise = client.request('textDocument/hover', {}, 1000);
    const hoverRequest = extractMessage(child.stdinWrites[2]);

    child.stdout.write(encodeMessage({
      jsonrpc: '2.0',
      id: hoverRequest.id,
      error: { code: -32603, message: 'hover failed' }
    }));

    await expect(hoverPromise).rejects.toThrow('hover failed');
  });

  it('emits error when the child process reports an error', async () => {
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    await startClient(client, child);

    const errorPromise = onceErrorEvent(client, 'error');
    child.emit('error', new Error('spawn failed'));

    await expect(errorPromise).resolves.toThrow('spawn failed');
  });

  it('emits error when a message arrives without a content length header', async () => {
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    await startClient(client, child);

    const errorPromise = onceErrorEvent(client, 'error');
    child.stdout.write('X-Test: 1\r\n\r\n{}');

    await expect(errorPromise).resolves.toThrow('Missing Content-Length header');
  });

  it('shuts down gracefully and kills the process if it does not exit in time', async () => {
    jest.useFakeTimers();
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    await startClient(client, child);

    const shutdownPromise = client.shutdown();
    const shutdownRequest = extractMessage(child.stdinWrites[2]);
    expect(shutdownRequest.method).toBe('shutdown');

    child.stdout.write(encodeMessage({
      jsonrpc: '2.0',
      id: shutdownRequest.id,
      result: null
    }));

    await shutdownPromise;
    expect(extractMessage(child.stdinWrites[3]).method).toBe('exit');

    await jest.advanceTimersByTimeAsync(5000);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does not emit crash after an expected shutdown exit', async () => {
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    await startClient(client, child);

    const crashListener = jest.fn();
    client.on('crash', crashListener);

    const shutdownPromise = client.shutdown();
    const shutdownRequest = extractMessage(child.stdinWrites[2]);
    child.stdout.write(encodeMessage({ jsonrpc: '2.0', id: shutdownRequest.id, result: null }));
    await shutdownPromise;
    child.emit('exit', 0, null);

    expect(crashListener).not.toHaveBeenCalled();
  });

  it('does not spawn a second process when start is called twice', async () => {
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    await startClient(client, child);
    await client.start();

    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it('handles notifications, idle shutdown, and missing process writes safely', async () => {
    const child = new MockChildProcess();
    const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
    spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
    const client = new LspClient(SERVER, '/workspace/project', 'debug');

    const freshClient = new LspClient(SERVER, '/workspace/project', 'debug');
    await expect(freshClient.shutdown()).resolves.toBeUndefined();
    expect(() => freshClient.notify('initialized', {})).toThrow('LSP process is not running');
    await expect(freshClient.request('textDocument/hover', {}, 1000)).rejects.toThrow('LSP process is not running');

    await startClient(client, child);
    const notificationPromise = new Promise<{ method: string; params: unknown }>((resolve) => {
      client.once('notification', (method: string, params: unknown) => resolve({ method, params }));
    });

    child.stdout.write(encodeMessage({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///x', diagnostics: [] } }));

    await expect(notificationPromise).resolves.toEqual({ method: 'textDocument/publishDiagnostics', params: { uri: 'file:///x', diagnostics: [] } });
  });

  describe('openAllFilesForDiagnostics (workspace scan regressions)', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await mkdtemp(path.join(tmpdir(), 'lsp-client-scan-'));
    });

    afterEach(async () => {
      await rm(tmpDir, { recursive: true, force: true });
    });

    // Publish notifications never arrive in this test (no real server), so
    // shorten the wait so these regression tests run fast under real timers
    // instead of racing fake timers against real fs I/O.
    function withShortDiagnosticsWait(client: LspClient): void {
      const original = client.waitForDiagnosticsPublish.bind(client);
      client.waitForDiagnosticsPublish = (filePath: string) =>
        original(filePath, 50);
    }

    it('does not let one unreadable file abort the whole scan (regression)', async () => {
      const child = new MockChildProcess();
      const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
      spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
      const client = new LspClient(SERVER, tmpDir, 'error');
      await startClient(client, child);
      withShortDiagnosticsWait(client);

      await writeFile(path.join(tmpDir, 'a.ts'), 'const a = 1;\n');
      await writeFile(path.join(tmpDir, 'b.ts'), 'const b = 1;\n');
      const brokenPath = path.join(tmpDir, 'broken.ts');
      await writeFile(brokenPath, 'const c = 1;\n');
      await chmod(brokenPath, 0o000);

      if (process.getuid?.() === 0) {
        // Running as root: chmod 0o000 does not block reads, so this test cannot apply.
        return;
      }

      const summary = await client.openAllFilesForDiagnostics(['.ts']);

      expect(summary).toEqual({ opened: 2, failed: 1, truncated: false });
    }, 10000);

    it('skips virtualenv-style directories during the workspace scan (regression)', async () => {
      const child = new MockChildProcess();
      const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
      spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
      const client = new LspClient(SERVER, tmpDir, 'error');
      await startClient(client, child);
      withShortDiagnosticsWait(client);

      await writeFile(path.join(tmpDir, 'top1.py'), 'x = 1\n');
      await writeFile(path.join(tmpDir, 'top2.py'), 'y = 2\n');
      const venvPkgDir = path.join(tmpDir, '.venv', 'lib', 'site-packages');
      await mkdir(venvPkgDir, { recursive: true });
      await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          writeFile(path.join(venvPkgDir, `dep${i}.py`), `dep = ${i}\n`),
        ),
      );

      const summary = await client.openAllFilesForDiagnostics(['.py']);

      expect(summary).toEqual({ opened: 2, failed: 0, truncated: false });
      const openedUris = child.stdinWrites
        .map((raw) => extractMessage(raw))
        .filter((message) => message.method === 'textDocument/didOpen')
        .map((message) => getObject(message.params).textDocument as { uri: string })
        .map((textDocument) => textDocument.uri);
      expect(openedUris.some((uri) => uri.includes('.venv'))).toBe(false);
    }, 10000);

    it('caps the workspace scan at 100 files per language and reports truncation', async () => {
      const child = new MockChildProcess();
      const spawn = jest.requireMock('node:child_process').spawn as jest.MockedFunction<SpawnMock>;
      spawn.mockReturnValue(child as unknown as ReturnType<SpawnMock>);
      const client = new LspClient(SERVER, tmpDir, 'error');
      await startClient(client, child);
      withShortDiagnosticsWait(client);

      await Promise.all(
        Array.from({ length: 150 }, (_, i) =>
          writeFile(path.join(tmpDir, `file${i}.ts`), `const v${i} = ${i};\n`),
        ),
      );

      const summary = await client.openAllFilesForDiagnostics(['.ts']);

      expect(summary).toEqual({ opened: 100, failed: 0, truncated: true });
    }, 10000);
  });
});

function encodeMessage(payload: unknown): string {
  const body = JSON.stringify(payload);
  return `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`;
}

function extractMessage(raw: string): Record<string, unknown> {
  const [, body = ''] = raw.split('\r\n\r\n');
  return JSON.parse(body) as Record<string, unknown>;
}

function getObject(value: unknown): Record<string, unknown> {
  expect(value).toBeDefined();
  return value as Record<string, unknown>;
}

async function startClient(client: LspClient, child: MockChildProcess): Promise<void> {
  const startPromise = client.start();
  const initializeMessage = extractMessage(child.stdinWrites[0]);
  child.stdout.write(encodeMessage({
    jsonrpc: '2.0',
    id: initializeMessage.id,
    result: { capabilities: { hoverProvider: true } }
  }));
  await startPromise;
}

function onceErrorEvent(emitter: EventEmitter, eventName: 'crash' | 'error'): Promise<Error> {
  return new Promise((resolve) => {
    emitter.once(eventName, (error: Error) => resolve(error));
  });
}
