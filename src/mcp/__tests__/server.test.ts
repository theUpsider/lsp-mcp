const mockRegisterCapabilities = jest.fn();
const mockSetRequestHandler = jest.fn();
const mockSetNotificationHandler = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockGetClientCapabilities = jest.fn().mockReturnValue(undefined);
const mockListRoots = jest.fn().mockResolvedValue({ roots: [] });
const mockSendToolListChanged = jest.fn().mockResolvedValue(undefined);

const mockInnerServer = {
  registerCapabilities: mockRegisterCapabilities,
  setRequestHandler: mockSetRequestHandler,
  setNotificationHandler: mockSetNotificationHandler,
  getClientCapabilities: mockGetClientCapabilities,
  listRoots: mockListRoots,
  sendToolListChanged: mockSendToolListChanged,
  oninitialized: undefined as (() => void) | undefined,
};

jest.mock("@modelcontextprotocol/sdk/server/mcp.js", () => ({
  McpServer: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    server: mockInnerServer,
  })),
}));

jest.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: jest.fn().mockImplementation(() => ({ kind: "stdio" })),
}));

jest.mock("@modelcontextprotocol/sdk/server/zod-compat.js", () => ({
  normalizeObjectSchema: jest.fn().mockReturnValue(null),
}));

jest.mock("@modelcontextprotocol/sdk/server/zod-json-schema-compat.js", () => ({
  toJsonSchemaCompat: jest.fn().mockReturnValue({}),
}));

jest.mock("../tools/read-tools", () => ({ registerReadTools: jest.fn() }));
jest.mock("../tools/write-tools", () => ({ registerWriteTools: jest.fn() }));
jest.mock("../../utils/workspace-config", () => ({
  loadWorkspaceConfig: jest.fn().mockResolvedValue(null),
  saveWorkspaceConfig: jest.fn().mockResolvedValue(undefined),
  loadLastRoot: jest.fn().mockResolvedValue(null),
}));

import { McpServer } from "../server";
import type { LifecycleManager } from "../../lsp/lifecycle-manager";

function getHandler(schema: unknown): Function {
  const call = mockSetRequestHandler.mock.calls.find(([s]) => s === schema);
  if (!call) throw new Error(`No handler registered for schema`);
  return call[1];
}

describe("McpServer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInnerServer.oninitialized = undefined;
    mockGetClientCapabilities.mockReturnValue(undefined);
    mockListRoots.mockResolvedValue({ roots: [] });
    mockSendToolListChanged.mockResolvedValue(undefined);
  });

  it("registers tool capabilities, request handlers, notification handler, and connects on start", async () => {
    const server = new McpServer("info");
    await server.start();

    expect(mockRegisterCapabilities).toHaveBeenCalledWith({ tools: {} });
    expect(mockSetRequestHandler).toHaveBeenCalledTimes(2);
    expect(mockSetNotificationHandler).toHaveBeenCalledTimes(1);
    expect(mockConnect).toHaveBeenCalledWith({ kind: "stdio" });
  });

  it("sets oninitialized callback on start", async () => {
    const server = new McpServer("info");
    await server.start();

    expect(mockInnerServer.oninitialized).toBeInstanceOf(Function);
  });

  it("lists lsp_init before auto-init", async () => {
    const readTools = jest.requireMock("../tools/read-tools")
      .registerReadTools as jest.Mock;
    const writeTools = jest.requireMock("../tools/write-tools")
      .registerWriteTools as jest.Mock;

    readTools.mockImplementationOnce(
      (registrar: { registerTool: Function }) => {
        registrar.registerTool(
          "lsp_init",
          { description: "init" },
          async () => ({ content: [{ type: "text", text: "ok" }], raw: null }),
        );
        registrar.registerTool(
          "lsp_definition",
          { description: "definition" },
          async () => ({
            content: [{ type: "text", text: "definition" }],
            raw: null,
          }),
        );
      },
    );
    writeTools.mockImplementationOnce(() => undefined);

    const { ListToolsRequestSchema } = jest.requireActual(
      "@modelcontextprotocol/sdk/types.js",
    ) as { ListToolsRequestSchema: unknown };

    const server = new McpServer("info");
    await server.start();

    const listHandler = getHandler(ListToolsRequestSchema);
    const result = await listHandler({});

    expect(result.tools.map((t: { name: string }) => t.name)).toContain(
      "lsp_init",
    );
    expect(result.tools.map((t: { name: string }) => t.name)).toContain(
      "lsp_definition",
    );
  });

  it("hides lsp_init after successful auto-init (all servers ready)", async () => {
    const readTools = jest.requireMock("../tools/read-tools")
      .registerReadTools as jest.Mock;
    const writeTools = jest.requireMock("../tools/write-tools")
      .registerWriteTools as jest.Mock;

    readTools.mockImplementationOnce(
      (registrar: { registerTool: Function }) => {
        registrar.registerTool(
          "lsp_init",
          { description: "init" },
          async () => ({ content: [{ type: "text", text: "ok" }], raw: null }),
        );
        registrar.registerTool(
          "lsp_definition",
          { description: "definition" },
          async () => ({
            content: [{ type: "text", text: "definition" }],
            raw: null,
          }),
        );
      },
    );
    writeTools.mockImplementationOnce(() => undefined);

    const health = [{ language: "typescript", status: "ready" }];
    const manager = {
      start: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getHealth: jest.fn().mockReturnValue(health),
    };
    const factory = jest.fn().mockReturnValue(manager);

    mockGetClientCapabilities.mockReturnValue({ roots: { listChanged: true } });
    mockListRoots.mockResolvedValue({
      roots: [{ uri: "file:///workspace/project" }],
    });

    const { ListToolsRequestSchema } = jest.requireActual(
      "@modelcontextprotocol/sdk/types.js",
    ) as { ListToolsRequestSchema: unknown };

    const server = new McpServer(
      "info",
      factory as unknown as (
        root: string,
        logLevel: string,
      ) => LifecycleManager,
    );
    await server.start();

    // Trigger the oninitialized callback
    await mockInnerServer.oninitialized!();

    const listHandler = getHandler(ListToolsRequestSchema);
    const result = await listHandler({});

    expect(result.tools.map((t: { name: string }) => t.name)).not.toContain(
      "lsp_init",
    );
    expect(result.tools.map((t: { name: string }) => t.name)).toContain(
      "lsp_definition",
    );
  });

  it("keeps lsp_init visible after auto-init when a server has errors", async () => {
    const readTools = jest.requireMock("../tools/read-tools")
      .registerReadTools as jest.Mock;
    const writeTools = jest.requireMock("../tools/write-tools")
      .registerWriteTools as jest.Mock;

    readTools.mockImplementationOnce(
      (registrar: { registerTool: Function }) => {
        registrar.registerTool(
          "lsp_init",
          { description: "init" },
          async () => ({ content: [{ type: "text", text: "ok" }], raw: null }),
        );
      },
    );
    writeTools.mockImplementationOnce(() => undefined);

    const health = [
      { language: "typescript", status: "ready" },
      { language: "python", status: "error", error: "pylsp not found" },
    ];
    const manager = {
      start: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getHealth: jest.fn().mockReturnValue(health),
    };
    const factory = jest.fn().mockReturnValue(manager);

    mockGetClientCapabilities.mockReturnValue({ roots: { listChanged: true } });
    mockListRoots.mockResolvedValue({
      roots: [{ uri: "file:///workspace/project" }],
    });

    const { ListToolsRequestSchema } = jest.requireActual(
      "@modelcontextprotocol/sdk/types.js",
    ) as { ListToolsRequestSchema: unknown };

    const server = new McpServer(
      "info",
      factory as unknown as (
        root: string,
        logLevel: string,
      ) => LifecycleManager,
    );
    await server.start();

    await mockInnerServer.oninitialized!();

    const listHandler = getHandler(ListToolsRequestSchema);
    const result = await listHandler({});

    expect(result.tools.map((t: { name: string }) => t.name)).toContain(
      "lsp_init",
    );
  });

  it("falls back to persisted last root when client has no roots capability", async () => {
    const { loadLastRoot, loadWorkspaceConfig } = jest.requireMock(
      "../../utils/workspace-config",
    ) as {
      loadLastRoot: jest.Mock;
      loadWorkspaceConfig: jest.Mock;
    };

    loadLastRoot.mockResolvedValueOnce("/persisted/root");
    loadWorkspaceConfig.mockResolvedValueOnce({ languages: ["typescript"] });

    const health = [{ language: "typescript", status: "ready" }];
    const manager = {
      start: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getHealth: jest.fn().mockReturnValue(health),
    };
    const factory = jest.fn().mockReturnValue(manager);

    mockGetClientCapabilities.mockReturnValue(undefined); // no roots capability

    const server = new McpServer(
      "info",
      factory as unknown as (
        root: string,
        logLevel: string,
      ) => LifecycleManager,
    );
    await server.start();

    await mockInnerServer.oninitialized!();

    expect(manager.start).toHaveBeenCalled();
    expect(server.isInitToolHidden()).toBe(true);
  });

  it("returns no-root error for non-init tools before initialization", async () => {
    const readTools = jest.requireMock("../tools/read-tools")
      .registerReadTools as jest.Mock;
    const writeTools = jest.requireMock("../tools/write-tools")
      .registerWriteTools as jest.Mock;

    readTools.mockImplementationOnce(
      (registrar: { registerTool: Function }) => {
        registrar.registerTool(
          "lsp_definition",
          { description: "definition" },
          async () => ({
            content: [{ type: "text", text: "reachable" }],
            raw: null,
          }),
        );
      },
    );
    writeTools.mockImplementationOnce(() => undefined);

    const { CallToolRequestSchema } = jest.requireActual(
      "@modelcontextprotocol/sdk/types.js",
    ) as { CallToolRequestSchema: unknown };

    const server = new McpServer("info");
    await server.start();

    const callHandler = getHandler(CallToolRequestSchema);
    const result = await callHandler({
      params: { name: "lsp_definition", arguments: {} },
    });

    expect(result.content[0].text).toMatch(/No project root set/);
  });

  it("allows calling lsp_init directly even after initialization (re-init)", async () => {
    const readTools = jest.requireMock("../tools/read-tools")
      .registerReadTools as jest.Mock;
    const writeTools = jest.requireMock("../tools/write-tools")
      .registerWriteTools as jest.Mock;

    readTools.mockImplementationOnce(
      (registrar: { registerTool: Function }) => {
        registrar.registerTool(
          "lsp_init",
          { description: "init" },
          async () => ({
            content: [{ type: "text", text: "initialized" }],
            raw: null,
          }),
        );
      },
    );
    writeTools.mockImplementationOnce(() => undefined);

    const { CallToolRequestSchema } = jest.requireActual(
      "@modelcontextprotocol/sdk/types.js",
    ) as { CallToolRequestSchema: unknown };

    const server = new McpServer("info");
    await server.start();
    server.setManager({} as LifecycleManager);

    const callHandler = getHandler(CallToolRequestSchema);
    const result = await callHandler({
      params: { name: "lsp_init", arguments: { root: "/x" } },
    });

    expect(result.content[0].text).toBe("initialized");
  });

  it("shuts down the old manager before starting a new one", async () => {
    const order: string[] = [];
    const firstManager = {
      start: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockImplementation(async () => {
        order.push("shutdown-first");
      }),
      getHealth: jest
        .fn()
        .mockReturnValue([{ language: "typescript", status: "ready" }]),
    };
    const secondManager = {
      start: jest.fn().mockImplementation(async () => {
        order.push("start-second");
      }),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getHealth: jest
        .fn()
        .mockReturnValue([{ language: "python", status: "ready" }]),
    };

    const factory = jest
      .fn()
      .mockReturnValueOnce(firstManager)
      .mockReturnValueOnce(secondManager);

    const server = new McpServer(
      "debug",
      factory as unknown as (
        root: string,
        logLevel: string,
      ) => LifecycleManager,
    );

    await expect(server.initializeManager("/workspace-one")).resolves.toEqual({
      root: "/workspace-one",
      health: [{ language: "typescript", status: "ready" }],
    });
    await expect(server.initializeManager("/workspace-two")).resolves.toEqual({
      root: "/workspace-two",
      health: [{ language: "python", status: "ready" }],
    });

    expect(order).toEqual(["shutdown-first", "start-second"]);
  });

  it("tolerates shutdown with no active manager", async () => {
    const server = new McpServer("info");
    await expect(server.shutdown()).resolves.toBeUndefined();
  });

  it("shuts down active manager on server shutdown", async () => {
    const manager = {
      shutdown: jest.fn().mockResolvedValue(undefined),
    } as unknown as LifecycleManager;
    const server = new McpServer("info");
    server.setManager(manager);
    await server.shutdown();
    expect(manager.shutdown).toHaveBeenCalledTimes(1);
  });

  it("sends tool list changed notification when roots change", async () => {
    const { RootsListChangedNotificationSchema } = jest.requireActual(
      "@modelcontextprotocol/sdk/types.js",
    ) as { RootsListChangedNotificationSchema: unknown };

    const health = [{ language: "typescript", status: "ready" }];
    const manager = {
      start: jest.fn().mockResolvedValue(undefined),
      shutdown: jest.fn().mockResolvedValue(undefined),
      getHealth: jest.fn().mockReturnValue(health),
    };
    const factory = jest.fn().mockReturnValue(manager);

    mockGetClientCapabilities.mockReturnValue({ roots: {} });
    mockListRoots.mockResolvedValue({
      roots: [{ uri: "file:///workspace/new-project" }],
    });

    const server = new McpServer(
      "info",
      factory as unknown as (
        root: string,
        logLevel: string,
      ) => LifecycleManager,
    );
    await server.start();

    const notificationHandler = mockSetNotificationHandler.mock.calls.find(
      ([s]) => s === RootsListChangedNotificationSchema,
    )?.[1] as Function | undefined;
    expect(notificationHandler).toBeDefined();

    await notificationHandler!({});

    expect(mockSendToolListChanged).toHaveBeenCalled();
  });
});
