import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Language server installers put binaries in per-tool user-local dirs (npm --prefix
// ~/.local, pip --user, cargo install, go install, gem --user-install). Hosts that
// launch this MCP server directly (not via an interactive login shell) often pass a
// minimal PATH that omits these dirs, so a server installed successfully still fails
// to spawn with ENOENT. Widen PATH to cover them before any `which`/spawn call.
const CANDIDATE_BIN_DIRS = process.platform === 'win32'
  ? []
  : [
      path.join(os.homedir(), '.local', 'bin'),
      path.join(os.homedir(), '.cargo', 'bin'),
      path.join(os.homedir(), 'go', 'bin'),
      path.join(os.homedir(), '.gem', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin'
    ];

export function getAugmentedEnv(baseEnv: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH';
  const currentPath = baseEnv[pathKey] ?? '';
  const existingDirs = new Set(currentPath.split(path.delimiter).filter(Boolean));
  const extraDirs = CANDIDATE_BIN_DIRS.filter(
    (dir) => !existingDirs.has(dir) && fs.existsSync(dir)
  );

  if (extraDirs.length === 0) {
    return { ...baseEnv };
  }

  return {
    ...baseEnv,
    [pathKey]: [currentPath, ...extraDirs].filter(Boolean).join(path.delimiter)
  };
}
