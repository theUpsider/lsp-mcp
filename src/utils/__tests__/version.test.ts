import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getVersion, MCP_SERVER_NAME, PACKAGE_JSON_PATH } from '../version';

const packageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8')
) as { name: string; version: string };

describe('version', () => {
  it('resolves the repository package.json', () => {
    expect(PACKAGE_JSON_PATH).toBe(path.resolve(__dirname, '..', '..', '..', 'package.json'));
  });

  it('returns the package.json version', () => {
    expect(getVersion()).toBe(packageJson.version);
  });

  it('does not report the stale hardcoded 0.1.0 placeholder', () => {
    if (packageJson.version !== '0.1.0') {
      expect(getVersion()).not.toBe('0.1.0');
    }
  });

  it('uses the package name as MCP server name', () => {
    expect(MCP_SERVER_NAME).toBe(packageJson.name);
  });

  it('keeps server.json in sync with package.json', () => {
    const serverJson = JSON.parse(
      readFileSync(path.resolve(__dirname, '..', '..', '..', 'server.json'), 'utf8')
    ) as { version: string; packages: Array<{ identifier: string; version: string }> };

    expect(serverJson.version).toBe(packageJson.version);
    for (const pkg of serverJson.packages.filter((p) => p.identifier === packageJson.name)) {
      expect(pkg.version).toBe(packageJson.version);
    }
  });
});
