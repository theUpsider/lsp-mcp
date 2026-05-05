import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LifecycleManager } from '../../src/lsp/lifecycle-manager';
import { registerReadTools } from '../../src/mcp/tools/read-tools';
import type { McpToolResult, ToolRegistrar } from '../../src/mcp/tools/shared';

const tsServerAvailable = spawnSync(
  process.platform === 'win32' ? 'where' : 'which',
  ['typescript-language-server'],
  { stdio: 'ignore' }
).status === 0;

const describeIfAvailable = tsServerAvailable ? describe : describe.skip;

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

describeIfAvailable('lsp_diagnostics (TypeScript)', () => {
  let tmpDir: string;
  let manager: LifecycleManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'lsp-mcp-diag-'));

    await Promise.all([
      writeFile(path.join(tmpDir, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}'),
      writeFile(path.join(tmpDir, 'package.json'), '{"name":"diag-test","private":true}')
    ]);

    manager = new LifecycleManager(tmpDir, 'error');
    await manager.start(['typescript']);
  }, 30000);

  afterEach(async () => {
    await manager.shutdown().catch(() => undefined);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('returns file diagnostics when file has a type error', async () => {
    const filePath = path.join(tmpDir, 'broken.ts');
    await writeFile(filePath, 'const x: number = "not a number";\n');

    const registry = new ToolRegistry();
    registerReadTools(registry, manager, { initializeManager: noop });

    const handler = registry.tools.get('lsp_diagnostics');
    if (!handler) {
      throw new Error('lsp_diagnostics not registered');
    }

    const result = await handler({ file: filePath, scope: 'file' });
    const text = result.content[0]?.text ?? '';

    expect(text).not.toBe('No result');
    expect(text).toMatch(/error|Error/i);
  }, 30000);

  test('returns workspace diagnostics when project has errors', async () => {
    const filePath = path.join(tmpDir, 'src', 'broken.ts');
    await mkdir(path.join(tmpDir, 'src'), { recursive: true });
    await writeFile(filePath, 'const x: number = "not a number";\n');

    const registry = new ToolRegistry();
    registerReadTools(registry, manager, { initializeManager: noop });

    const handler = registry.tools.get('lsp_diagnostics');
    if (!handler) {
      throw new Error('lsp_diagnostics not registered');
    }

    const result = await handler({ file: filePath, scope: 'workspace', language: 'typescript' });
    const text = result.content[0]?.text ?? '';

    expect(text).not.toBe('No result');
    expect(text).toMatch(/error|Error/i);
  }, 30000);

  test('returns no diagnostics for a valid file', async () => {
    const filePath = path.join(tmpDir, 'valid.ts');
    await writeFile(filePath, 'const x: number = 1;\n');

    const registry = new ToolRegistry();
    registerReadTools(registry, manager, { initializeManager: noop });

    const handler = registry.tools.get('lsp_diagnostics');
    if (!handler) {
      throw new Error('lsp_diagnostics not registered');
    }

    const result = await handler({ file: filePath, scope: 'file' });
    const text = result.content[0]?.text ?? '';

    expect(text).toBe('No diagnostics found');
  }, 30000);
});
