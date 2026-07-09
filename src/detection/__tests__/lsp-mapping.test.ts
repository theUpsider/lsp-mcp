import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { findAvailableLinter, findAvailableLsp, getLinterCandidates, getLspCandidates, SUPPORTED_LANGUAGES } from '../lsp-mapping';

describe('lsp-mapping', () => {
  it('returns the configured python LSP candidates in priority order', () => {
    expect(getLspCandidates('python')).toEqual([
      { cmd: 'pyright-langserver', args: ['--stdio'], pkg: 'pyright', mgr: 'npm' },
      { cmd: 'pylsp', args: [], pkg: 'python-lsp-server', mgr: 'pip' }
    ]);
  });

  it('returns ruff as the python linter candidate, run alongside the primary server', () => {
    expect(getLinterCandidates('python')).toEqual([
      { cmd: 'ruff', args: ['server', '--quiet'], pkg: 'ruff', mgr: 'pip' }
    ]);
    expect(getLinterCandidates('typescript')).toEqual([]);
  });

  it('returns the full supported language list and shared candidate mappings', () => {
    expect(SUPPORTED_LANGUAGES).toEqual([
      'python',
      'typescript',
      'javascript',
      'csharp',
      'java',
      'go',
      'rust',
      'c',
      'cpp',
      'ruby',
      'php',
      'kotlin',
      'swift'
    ]);

    expect(getLspCandidates('javascript')).toEqual(getLspCandidates('typescript'));
    expect(getLspCandidates('cpp')).toEqual(getLspCandidates('c'));
    expect(getLspCandidates('kotlin')).toEqual([
      { cmd: 'kotlin-language-server', args: ['--stdio'], pkg: 'kotlin-language-server', mgr: 'npm' }
    ]);
  });

  it('returns the first available LSP candidate found on PATH', async () => {
    const binDir = await mkdtemp(path.join(tmpdir(), 'lsp-mapping-'));
    const originalPath = process.env.PATH;

    try {
      const fakeWhich = path.join(binDir, 'which');
      const fakeServer = path.join(binDir, 'typescript-language-server');
      await writeFile(
        fakeWhich,
        '#!/bin/sh\nBIN_DIR=$(dirname "$0")\nif [ -x "$BIN_DIR/$(basename "$1")" ]; then\n  printf "%s\\n" "$BIN_DIR/$(basename "$1")"\n  exit 0\nfi\nexit 1\n'
      );
      await writeFile(fakeServer, '#!/bin/sh\nexit 0\n');
      await chmod(fakeWhich, 0o755);
      await chmod(fakeServer, 0o755);

      process.env.PATH = `${binDir}${path.delimiter}${originalPath ?? ''}`;

      await expect(findAvailableLsp('typescript')).resolves.toEqual({
        cmd: 'typescript-language-server',
        args: ['--stdio'],
        pkg: 'typescript-language-server',
        mgr: 'npm'
      });
    } finally {
      process.env.PATH = originalPath;
      await rm(binDir, { recursive: true, force: true });
    }
  });

  it('returns null when no configured LSP command is available', async () => {
    const binDir = await mkdtemp(path.join(tmpdir(), 'lsp-mapping-'));
    const originalPath = process.env.PATH;

    try {
      const fakeWhich = path.join(binDir, 'which');
      await writeFile(fakeWhich, '#!/bin/sh\nexit 1\n');
      await chmod(fakeWhich, 0o755);

      process.env.PATH = binDir;

      await expect(findAvailableLsp('swift')).resolves.toBeNull();
      await expect(findAvailableLsp('unknown')).resolves.toBeNull();
      await expect(findAvailableLinter('python')).resolves.toBeNull();
    } finally {
      process.env.PATH = originalPath;
      await rm(binDir, { recursive: true, force: true });
    }
  });
});
