import { readFileSync } from "node:fs";
import path from "node:path";

export const MCP_SERVER_NAME = "@theupsider/lsp-mcp";
export const LSP_CLIENT_NAME = "lsp-mcp";

/**
 * package.json sits two levels above this file both in the source tree
 * (src/utils/) and in the build output (dist/utils/), including when the
 * package is installed from npm ("files" ships dist/ next to package.json).
 */
export const PACKAGE_JSON_PATH = path.resolve(
  __dirname,
  "..",
  "..",
  "package.json",
);

let cachedVersion: string | undefined;

/** Returns the package version from package.json, the single source of truth. */
export function getVersion(): string {
  if (cachedVersion === undefined) {
    const parsed = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      version?: unknown;
    };
    if (typeof parsed.version !== "string" || parsed.version.length === 0) {
      throw new Error(`No version field in ${PACKAGE_JSON_PATH}`);
    }
    cachedVersion = parsed.version;
  }
  return cachedVersion;
}
