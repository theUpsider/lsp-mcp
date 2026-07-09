import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LifecycleManager } from '../../src/lsp/lifecycle-manager';
import { registerReadTools } from '../../src/mcp/tools/read-tools';
import type { McpToolResult, ToolRegistrar } from '../../src/mcp/tools/shared';

function commandExists(command: string): boolean {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  return spawnSync(lookup, [command], { stdio: 'ignore' }).status === 0;
}

const serversAvailable =
  commandExists('typescript-language-server') &&
  (commandExists('pyright-langserver') || commandExists('pylsp'));

const describeIfAvailable = serversAvailable ? describe : describe.skip;

class ToolRegistry implements ToolRegistrar {
  public readonly tools = new Map<string, (args: Record<string, unknown>) => Promise<McpToolResult>>();

  public registerTool(
    name: string,
    _config: unknown,
    handler: (args: Record<string, unknown>) => Promise<McpToolResult>
  ): void {
    this.tools.set(name, handler);
  }
}

function noop(): never {
  throw new Error('lsp_init should not be called in diagnostic tests');
}

interface DiagnosticRaw {
  uri: string;
}

describeIfAvailable('lsp_diagnostics workspace scope isolates per-language failures (regression)', () => {
  let tmpDir: string;
  let manager: LifecycleManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'lsp-mcp-isolation-'));

    await Promise.all([
      writeFile(path.join(tmpDir, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}'),
      writeFile(path.join(tmpDir, 'package.json'), '{"name":"isolation-test","private":true}'),
      writeFile(path.join(tmpDir, 'pyproject.toml'), '[project]\nname = "isolation"\nversion = "0.0.0"\n'),
      writeFile(path.join(tmpDir, 'broken.ts'), 'const x: number = "not a number";\n'),
      writeFile(path.join(tmpDir, 'broken.py'), 'x: int = "not a number"\n'),
    ]);

    manager = new LifecycleManager(tmpDir, 'error');
    await manager.start(['typescript', 'python']);
  }, 45000);

  afterEach(async () => {
    await manager.shutdown().catch(() => undefined);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('an unreadable file in one language does not blank out diagnostics for other languages', async () => {
    const brokenPyPath = path.join(tmpDir, 'broken.py');
    await chmod(brokenPyPath, 0o000);

    if (process.getuid?.() === 0) {
      // Running as root: chmod 0o000 does not block reads, so this test cannot apply.
      return;
    }

    const registry = new ToolRegistry();
    registerReadTools(registry, manager, { initializeManager: noop });

    const handler = registry.tools.get('lsp_diagnostics');
    if (!handler) {
      throw new Error('lsp_diagnostics not registered');
    }

    const result = await handler({ scope: 'workspace' });

    // The call must resolve to a structured result (success or {error:true}),
    // never throw/hang the whole process — and typescript's diagnostics must
    // still come through despite python's scan failing on the unreadable file.
    expect(result).toBeDefined();
    expect(result.error).not.toBe(true);

    const raw = result.raw as DiagnosticRaw[];
    expect(raw.some((d) => d.uri.endsWith('.ts'))).toBe(true);
  }, 60000);
});
