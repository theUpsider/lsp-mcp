import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface WorkspaceEntry {
  languages?: string[];
}

interface ConfigFile {
  workspaces: Record<string, WorkspaceEntry>;
  lastRoot?: string;
}

function getConfigDir(): string {
  const platform = os.platform();

  if (platform === "win32") {
    const appData = process.env["APPDATA"];
    if (appData) return path.join(appData, "lsp-mcp");
    return path.join(os.homedir(), "AppData", "Roaming", "lsp-mcp");
  }

  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "lsp-mcp");
  }

  // Linux / other POSIX — respect XDG
  const xdgConfig = process.env["XDG_CONFIG_HOME"];
  const base = xdgConfig ?? path.join(os.homedir(), ".config");
  return path.join(base, "lsp-mcp");
}

const CONFIG_FILE = path.join(getConfigDir(), "config.json");

async function readConfig(): Promise<ConfigFile> {
  try {
    const raw = await readFile(CONFIG_FILE, "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "workspaces" in parsed &&
      typeof (parsed as ConfigFile).workspaces === "object"
    ) {
      return parsed as ConfigFile;
    }
  } catch {
    // File missing or malformed — start fresh
  }
  return { workspaces: {} };
}

async function writeConfig(config: ConfigFile): Promise<void> {
  await mkdir(path.dirname(CONFIG_FILE), { recursive: true });
  await writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf8");
}

export async function loadWorkspaceConfig(
  root: string,
): Promise<WorkspaceEntry | null> {
  const config = await readConfig();
  return config.workspaces[root] ?? null;
}

export async function saveWorkspaceConfig(
  root: string,
  entry: WorkspaceEntry,
): Promise<void> {
  const config = await readConfig();
  config.workspaces[root] = entry;
  config.lastRoot = root;
  await writeConfig(config);
}

export async function loadLastRoot(): Promise<string | null> {
  const config = await readConfig();
  return config.lastRoot ?? null;
}
