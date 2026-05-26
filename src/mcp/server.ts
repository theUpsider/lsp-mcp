import { McpServer as SdkMcpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  normalizeObjectSchema,
  type AnySchema,
} from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  RootsListChangedNotificationSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { LifecycleManager } from "../lsp/lifecycle-manager";
import {
  failure,
  noProjectRootResult,
  type McpToolResult,
  type MinimalLifecycleManager,
  type ToolRegistrar,
} from "./tools/shared";
import {
  loadLastRoot,
  loadWorkspaceConfig,
  saveWorkspaceConfig,
} from "../utils/workspace-config";

import { registerReadTools } from "./tools/read-tools";
import { registerWriteTools } from "./tools/write-tools";

export class McpServer {
  private currentManager: LifecycleManager | null = null;
  private currentRoot: string | null = null;
  private initialized = false;
  /** When true, lsp_init is hidden from ListTools (client auto-initialized). */
  private hideInitTool = false;
  private readonly logLevel: string;
  private readonly createLifecycleManager: LifecycleManagerFactory;
  private readonly server: InstanceType<typeof SdkMcpServer>;
  private readonly tools = new Map<string, RegisteredToolDefinition>();

  public constructor(
    logLevel = "info",
    createLifecycleManager: LifecycleManagerFactory = (root, level) =>
      new LifecycleManager(root, level),
  ) {
    this.logLevel = logLevel;
    this.createLifecycleManager = createLifecycleManager;
    this.server = new SdkMcpServer({
      name: "@theupsider/lsp-mcp",
      version: "0.1.0",
    });
  }

  public async start(): Promise<void> {
    const lifecycleProxy = this.createLifecycleProxy();
    const registrar: ToolRegistrar = {
      registerTool: (name, config, handler) => {
        this.tools.set(name, {
          name,
          description: config.description,
          inputSchema: config.inputSchema,
          handler,
        });
      },
    };

    registerReadTools(registrar, lifecycleProxy, {
      initializeManager: async (root, languages) => {
        const result = await this.initializeManager(root, languages);
        // When lsp_init is called explicitly, hide it on success, re-expose on error
        this.updateInitVisibility(result.health);
        await this.server.server.sendToolListChanged();
        return result;
      },
    });
    registerWriteTools(registrar, lifecycleProxy);
    this.configureToolHandlers();

    // Hook into post-handshake to attempt auto-init from roots or persisted config.
    // Cast to `() => void` to satisfy the SDK type while still returning the promise
    // so test harnesses can await it when needed.
    this.server.server.oninitialized = (() => this.tryAutoInit()) as () => void;

    // Handle roots/list_changed: client switched workspace
    this.server.server.setNotificationHandler(
      RootsListChangedNotificationSchema,
      async () => {
        await this.tryAutoInitFromRoots();
      },
    );

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  public async initializeManager(
    root: string,
    languages?: string[],
  ): Promise<{
    root: string;
    health: ReturnType<LifecycleManager["getHealth"]>;
  }> {
    const nextManager = this.createLifecycleManager(root, this.logLevel);
    const previousManager = this.currentManager;

    if (previousManager) {
      await previousManager.shutdown();
      this.currentManager = null;
      this.currentRoot = null;
    }

    await nextManager.start(languages);
    this.setManager(nextManager);
    this.currentRoot = root;

    return { root, health: nextManager.getHealth() };
  }

  public setManager(lifecycleManager: LifecycleManager): void {
    this.currentManager = lifecycleManager;
    this.initialized = true;
  }

  public async shutdown(): Promise<void> {
    const activeManager = this.currentManager;
    this.currentManager = null;
    this.currentRoot = null;
    this.initialized = false;
    this.hideInitTool = false;
    if (activeManager) {
      await activeManager.shutdown();
    }
  }

  /** True when lsp_init is currently hidden from the tool list. */
  public isInitToolHidden(): boolean {
    return this.hideInitTool;
  }

  private updateInitVisibility(
    health: ReturnType<LifecycleManager["getHealth"]>,
  ): void {
    const hasErrors = health.some((entry) => entry.status === "error");
    this.hideInitTool = !hasErrors;
  }

  private async tryAutoInit(): Promise<void> {
    // Prefer roots from the client if supported
    const caps = this.server.server.getClientCapabilities();
    if (caps?.roots) {
      await this.tryAutoInitFromRoots();
      return;
    }

    // Fallback: load the last-used root from persisted config
    try {
      const lastRoot = await loadLastRoot();
      if (lastRoot) {
        await this.autoInitRoot(lastRoot);
      }
    } catch {
      // Non-fatal; lsp_init stays visible
    }
  }

  private async tryAutoInitFromRoots(): Promise<void> {
    try {
      const { roots } = await this.server.server.listRoots();
      const firstUri = roots[0]?.uri;
      if (!firstUri?.startsWith("file://")) return;

      // file:///path/to/project → /path/to/project
      const root = decodeURIComponent(new URL(firstUri).pathname);
      await this.autoInitRoot(root);
    } catch {
      // Client may not support roots (e.g. Cursor bug) — stay visible
    }
  }

  private async autoInitRoot(root: string): Promise<void> {
    const saved = await loadWorkspaceConfig(root);
    const languages = saved?.languages;

    const result = await this.initializeManager(root, languages);
    this.updateInitVisibility(result.health);

    // Persist successful init so we can restore on next startup
    const readyLanguages = result.health
      .filter((e) => e.status === "ready")
      .map((e) => e.language);
    await saveWorkspaceConfig(root, { languages: readyLanguages });

    // Notify client that tool list may have changed (lsp_init hidden/shown)
    try {
      await this.server.server.sendToolListChanged();
    } catch {
      // Client may not support list-changed notifications
    }
  }

  private configureToolHandlers(): void {
    this.server.server.registerCapabilities({ tools: {} });
    this.server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.listTools(),
    }));
    this.server.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        const toolName = request.params.name;

        if (toolName !== "lsp_init" && !this.initialized) {
          return noProjectRootResult();
        }

        const tool = this.tools.get(toolName);
        if (!tool) {
          return failure(`Tool not found: ${toolName}`);
        }

        return await tool.handler(
          isRecord(request.params.arguments) ? request.params.arguments : {},
        );
      },
    );
  }

  private listTools(): Tool[] {
    return [...this.tools.values()]
      .filter((tool) => !(tool.name === "lsp_init" && this.hideInitTool))
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: this.toInputSchema(tool.inputSchema),
      }));
  }

  private toInputSchema(schema: AnySchema | undefined): Tool["inputSchema"] {
    const normalized = normalizeObjectSchema(schema);
    const result = normalized
      ? toJsonSchemaCompat(normalized, {
          strictUnions: true,
          pipeStrategy: "input",
        })
      : {};
    return { type: "object", ...result } as Tool["inputSchema"];
  }

  private createLifecycleProxy(): MinimalLifecycleManager {
    return {
      getClientForFile: (filePath) =>
        this.requireManager().getClientForFile(filePath),
      getReadyClients: (language) =>
        this.requireManager().getReadyClients(language),
      getFileDiagnostics: (filePath) =>
        this.requireManager().getFileDiagnostics(filePath),
      getWorkspaceDiagnostics: (language) =>
        this.requireManager().getWorkspaceDiagnostics(language),
      getHealth: () => this.requireManager().getHealth(),
      ensureLanguageForFile: async (filePath) =>
        await this.requireManager().ensureLanguageForFile(filePath),
      ensureSeedFilesOpen: async () =>
        await this.requireManager().ensureSeedFilesOpen(),
      analyzeWorkspace: async (language) =>
        await this.requireManager().analyzeWorkspace(language),
    };
  }

  private requireManager(): LifecycleManager {
    if (this.currentManager === null) {
      throw new Error(
        "No project root set. Call lsp_init({ root: '/path/to/project' }) first.",
      );
    }

    return this.currentManager;
  }
}

type LifecycleManagerFactory = (
  root: string,
  logLevel: string,
) => LifecycleManager;

interface RegisteredToolDefinition {
  name: string;
  description?: string;
  inputSchema?: AnySchema;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
