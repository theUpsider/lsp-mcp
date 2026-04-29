import { McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import type { LifecycleManager } from '../lsp/lifecycle-manager';
import type { McpToolResult } from './tools/shared';
import type { ZodTypeAny } from 'zod';

import { registerReadTools } from './tools/read-tools';
import { registerWriteTools } from './tools/write-tools';

export class McpServer {
  private readonly lifecycleManager: LifecycleManager;
  private readonly server: InstanceType<typeof SdkMcpServer>;

  public constructor(lifecycleManager: LifecycleManager) {
    this.lifecycleManager = lifecycleManager;
    this.server = new SdkMcpServer({ name: '@theupsider/lsp-mcp', version: '0.1.0' });
  }

  public async start(): Promise<void> {
    const registrar: ToolRegistrationAdapter = {
      registerTool: (name, config, handler) => {
        const toolConfig = config.inputSchema === undefined
          ? { description: config.description }
          : { description: config.description, inputSchema: config.inputSchema };
        this.server.registerTool(name, toolConfig, async (args: unknown) => {
          return await handler(isRecord(args) ? args : {});
        });
      },
      fromJsonSchema: (schema) => schema
    };

    registerReadTools(registrar, this.lifecycleManager);
    registerWriteTools(registrar, this.lifecycleManager);

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}

interface ToolRegistrationAdapter {
  registerTool(
    name: string,
    config: { description?: string; inputSchema?: ZodTypeAny },
    handler: (args: Record<string, unknown>) => Promise<McpToolResult>
  ): void;
  fromJsonSchema(schema: unknown): unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
