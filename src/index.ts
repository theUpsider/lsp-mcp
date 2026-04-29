#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { LifecycleManager } from './lsp/lifecycle-manager';
import { McpServer } from './mcp/server';

interface MainOverrides {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  exit?: (code: number) => void;
  onSignal?: (signal: NodeJS.Signals, handler: () => void | Promise<void>) => void;
}

export async function main(argv = process.argv.slice(2), env = process.env, overrides: MainOverrides = {}): Promise<void> {
  const stdout = overrides.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = overrides.stderr ?? ((text: string) => process.stderr.write(text));
  const exit = overrides.exit ?? ((code: number) => process.exit(code));
  const onSignal = overrides.onSignal ?? ((signal: NodeJS.Signals, handler: () => void | Promise<void>) => {
    process.on(signal, () => {
      void handler();
    });
  });

  if (argv.includes('--version')) {
    stdout(`${readVersion()}\n`);
    exit(0);
    return;
  }

  const projectRoot = env.LSP_MCP_ROOT;
  if (!projectRoot) {
    stderr('LSP_MCP_ROOT is required\n');
    exit(1);
    return;
  }

  const lifecycleManager = new LifecycleManager(projectRoot, env.LSP_MCP_LOG_LEVEL ?? 'info');
  await lifecycleManager.start();

  const startupReport = summarizeHealth(lifecycleManager.getHealth());
  stderr(`${JSON.stringify(startupReport)}\n`);

  const mcpServer = new McpServer(lifecycleManager);
  await mcpServer.start();

  const shutdown = async () => {
    await lifecycleManager.shutdown();
    exit(0);
  };

  onSignal('SIGINT', shutdown);
  onSignal('SIGTERM', shutdown);
}

function summarizeHealth(health: Array<{ language: string; status: 'ready' | 'error' | 'starting'; error?: string }>): { languages: string[]; started: string[]; errors: string[] } {
  return {
    languages: health.map((entry) => entry.language),
    started: health.filter((entry) => entry.status === 'ready').map((entry) => entry.language),
    errors: health.filter((entry) => entry.status === 'error' && entry.error).map((entry) => entry.error as string)
  };
}

function readVersion(): string {
  const packageJsonPath = path.resolve(__dirname, '..', 'package.json');
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')).version as string;
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
