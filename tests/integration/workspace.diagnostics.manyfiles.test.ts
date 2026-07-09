import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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

interface DiagnosticRaw {
  uri: string;
  severity?: number;
}

describeIfAvailable('lsp_diagnostics workspace scope over many files (regression)', () => {
  let tmpDir: string;
  let manager: LifecycleManager;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'lsp-mcp-manyfiles-'));

    await Promise.all([
      writeFile(path.join(tmpDir, 'tsconfig.json'), '{"compilerOptions":{"strict":true}}'),
      writeFile(path.join(tmpDir, 'package.json'), '{"name":"manyfiles-test","private":true}')
    ]);

    manager = new LifecycleManager(tmpDir, 'error');
    await manager.start(['typescript']);
  }, 30000);

  afterEach(async () => {
    await manager.shutdown().catch(() => undefined);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test('reports diagnostics spanning every broken file across a 12-file project', async () => {
    const brokenCount = 8;
    const cleanCount = 4;

    await Promise.all([
      ...Array.from({ length: brokenCount }, (_, i) =>
        writeFile(
          path.join(tmpDir, `broken${i}.ts`),
          `const x${i}: number = "not a number";\n`
        )
      ),
      ...Array.from({ length: cleanCount }, (_, i) =>
        writeFile(
          path.join(tmpDir, `clean${i}.ts`),
          `const y${i}: number = ${i};\nconsole.log(y${i});\n`
        )
      ),
    ]);

    const registry = new ToolRegistry();
    registerReadTools(registry, manager, { initializeManager: noop });

    const handler = registry.tools.get('lsp_diagnostics');
    if (!handler) {
      throw new Error('lsp_diagnostics not registered');
    }

    const result = await handler({ scope: 'workspace', language: 'typescript' });
    const raw = result.raw as DiagnosticRaw[];

    const distinctBrokenUris = new Set(
      raw.map((d) => d.uri).filter((uri) => uri.includes('/broken')),
    );
    expect(distinctBrokenUris.size).toBe(brokenCount);
    expect(raw.some((d) => d.uri.includes('/clean'))).toBe(false);
  }, 60000);

  test('caps workspace diagnostics at 200 results across a large fixture', async () => {
    const fileCount = 15;
    const errorsPerFile = 15;

    await Promise.all(
      Array.from({ length: fileCount }, (_, fileIndex) => {
        const lines = Array.from(
          { length: errorsPerFile },
          (_, lineIndex) => `const v${fileIndex}_${lineIndex}: number = "wrong";`
        ).join('\n');
        return writeFile(path.join(tmpDir, `many${fileIndex}.ts`), `${lines}\n`);
      })
    );

    const registry = new ToolRegistry();
    registerReadTools(registry, manager, { initializeManager: noop });

    const handler = registry.tools.get('lsp_diagnostics');
    if (!handler) {
      throw new Error('lsp_diagnostics not registered');
    }

    const result = await handler({ scope: 'workspace', language: 'typescript' });
    const raw = result.raw as Array<{ severity?: number }>;

    expect(raw.length).toBe(200);
    for (let i = 1; i < raw.length; i += 1) {
      expect(raw[i]!.severity ?? 4).toBeGreaterThanOrEqual(raw[i - 1]!.severity ?? 4);
    }
  }, 60000);
});
