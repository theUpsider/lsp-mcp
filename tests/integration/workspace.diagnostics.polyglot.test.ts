import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

const polyglotServersAvailable =
  commandExists('typescript-language-server') &&
  (commandExists('pyright-langserver') || commandExists('pylsp')) &&
  commandExists('gopls');

const describeIfAvailable = polyglotServersAvailable ? describe : describe.skip;

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

describeIfAvailable('lsp_diagnostics workspace scope across a polyglot repo (REQ-013 regression)', () => {
  let tmpDir: string;
  let manager: LifecycleManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'lsp-mcp-polyglot-'));

    await Promise.all([
      writeFile(path.join(tmpDir, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}'),
      writeFile(path.join(tmpDir, 'package.json'), '{"name":"polyglot-test","private":true}'),
      writeFile(path.join(tmpDir, 'pyproject.toml'), '[project]\nname = "polyglot"\nversion = "0.0.0"\n'),
      writeFile(path.join(tmpDir, 'go.mod'), 'module polyglot\n\ngo 1.22\n'),
      writeFile(path.join(tmpDir, 'broken.ts'), 'const x: number = "not a number";\n'),
      writeFile(path.join(tmpDir, 'broken.py'), 'x: int = "not a number"\n'),
      writeFile(
        path.join(tmpDir, 'broken.go'),
        'package main\n\nfunc main() {\n\tvar x int = "not a number"\n\t_ = x\n}\n'
      ),
    ]);

    manager = new LifecycleManager(tmpDir, 'error');
    await manager.start(['typescript', 'python', 'go']);
  }, 45000);

  afterEach(async () => {
    await manager.shutdown().catch(() => undefined);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('reports diagnostics for typescript, python, and go together', async () => {
    const registry = new ToolRegistry();
    registerReadTools(registry, manager, { initializeManager: noop });

    const handler = registry.tools.get('lsp_diagnostics');
    if (!handler) {
      throw new Error('lsp_diagnostics not registered');
    }

    const result = await handler({ scope: 'workspace' });
    expect(result.error).not.toBe(true);

    const raw = result.raw as DiagnosticRaw[];
    expect(raw.some((d) => d.uri.endsWith('.ts'))).toBe(true);
    expect(raw.some((d) => d.uri.endsWith('.py'))).toBe(true);
    expect(raw.some((d) => d.uri.endsWith('.go'))).toBe(true);
  }, 60000);

  test('filters workspace diagnostics to a single language', async () => {
    const registry = new ToolRegistry();
    registerReadTools(registry, manager, { initializeManager: noop });

    const handler = registry.tools.get('lsp_diagnostics');
    if (!handler) {
      throw new Error('lsp_diagnostics not registered');
    }

    const result = await handler({ scope: 'workspace', language: 'python' });
    const raw = result.raw as DiagnosticRaw[];

    expect(raw.length).toBeGreaterThan(0);
    expect(raw.every((d) => d.uri.endsWith('.py'))).toBe(true);
  }, 60000);
});
