import { McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { normalizeObjectSchema, type AnySchema } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type Tool } from '@modelcontextprotocol/sdk/types.js';

import { LifecycleManager } from '../lsp/lifecycle-manager';
import { failure, noProjectRootResult, type McpToolResult, type MinimalLifecycleManager } from './tools/shared';
import type { ZodType } from 'zod';

import { registerReadTools } from './tools/read-tools';
import { registerWriteTools } from './tools/write-tools';

export class McpServer {
  private currentManager: LifecycleManager | null = null;
  private currentRoot: string | null = null;
  private initialized = false;
  private readonly logLevel: string;
  private readonly createLifecycleManager: LifecycleManagerFactory;
  private readonly server: InstanceType<typeof SdkMcpServer>;
  private readonly tools = new Map<string, RegisteredToolDefinition>();

  public constructor(logLevel = 'info', createLifecycleManager: LifecycleManagerFactory = (root, level) => new LifecycleManager(root, level)) {
    this.logLevel = logLevel;
    this.createLifecycleManager = createLifecycleManager;
    this.server = new SdkMcpServer({ name: '@theupsider/lsp-mcp', version: '0.1.0' });
  }

  public async start(): Promise<void> {
    const lifecycleProxy = this.createLifecycleProxy();
    const registrar: ToolRegistrationAdapter = {
      registerTool: (name, config, handler) => {
        this.tools.set(name, { name, description: config.description, inputSchema: config.inputSchema, handler });
      },
      fromJsonSchema: (schema) => schema
    };

    registerReadTools(registrar, lifecycleProxy, { initializeManager: async (root, languages) => await this.initializeManager(root, languages) });
    registerWriteTools(registrar, lifecycleProxy);
    this.configureToolHandlers();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  public async initializeManager(root: string, languages?: string[]): Promise<{ root: string; health: ReturnType<LifecycleManager['getHealth']> }> {
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
    if (activeManager) {
      await activeManager.shutdown();
    }
  }

  private configureToolHandlers(): void {
    this.server.server.registerCapabilities({ tools: {} });
    this.server.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: this.listTools() }));
    this.server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name;
      if (toolName === 'lsp_init' && this.initialized) {
        return failure(`Already initialized at ${this.currentRoot ?? 'unknown'}. Call lsp_init again with a new root to switch projects.`);
      }

      if (toolName !== 'lsp_init' && !this.initialized) {
        return noProjectRootResult();
      }

      const tool = this.tools.get(toolName);
      if (!tool) {
        return failure(`Tool not found: ${toolName}`);
      }

      return await tool.handler(isRecord(request.params.arguments) ? request.params.arguments : {});
    });
  }

  private listTools(): Tool[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: this.toInputSchema(tool.inputSchema)
    }));
  }

  private toInputSchema(schema: AnySchema | undefined): Tool['inputSchema'] {
    const normalized = normalizeObjectSchema(schema);
    const result = normalized
      ? toJsonSchemaCompat(normalized, { strictUnions: true, pipeStrategy: 'input' })
      : {};
    return { type: 'object', ...result } as Tool['inputSchema'];
  }

  private createLifecycleProxy(): MinimalLifecycleManager {
    return {
      getClientForFile: (filePath) => this.requireManager().getClientForFile(filePath),
      getReadyClients: (language) => this.requireManager().getReadyClients(language),
      getFileDiagnostics: (filePath) => this.requireManager().getFileDiagnostics(filePath),
      getWorkspaceDiagnostics: (language) => this.requireManager().getWorkspaceDiagnostics(language),
      getHealth: () => this.requireManager().getHealth(),
      ensureLanguageForFile: async (filePath) => await this.requireManager().ensureLanguageForFile(filePath)
    };
  }

  private requireManager(): LifecycleManager {
    if (this.currentManager === null) {
      throw new Error("No project root set. Call lsp_init({ root: '/path/to/project' }) first.");
    }

    return this.currentManager;
  }
}

type LifecycleManagerFactory = (root: string, logLevel: string) => LifecycleManager;

interface ToolRegistrationAdapter {
  registerTool(
    name: string,
    config: { description?: string; inputSchema?: ZodType },
    handler: (args: Record<string, unknown>) => Promise<McpToolResult>
  ): void;
  fromJsonSchema(schema: unknown): unknown;
}

interface RegisteredToolDefinition {
  name: string;
  description?: string;
  inputSchema?: AnySchema;
  handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
