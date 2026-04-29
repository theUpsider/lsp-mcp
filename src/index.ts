#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

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

  const logLevel = env.LSP_MCP_LOG_LEVEL ?? 'info';
  const mcpServer = new McpServer(logLevel);

  stderr(`${JSON.stringify({ event: 'startup', status: 'waiting-for-init' })}\n`);

  await mcpServer.start();

  const shutdown = async () => {
    await mcpServer.shutdown();
    exit(0);
  };

  onSignal('SIGINT', shutdown);
  onSignal('SIGTERM', shutdown);
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
