import { access, readFile, writeFile } from "node:fs/promises";

import { registerWriteTools } from "../tools/write-tools";

jest.mock("node:fs/promises", () => ({
  access: jest.fn(),
  readFile: jest.fn(),
  writeFile: jest.fn(),
}));

interface RegisteredTool {
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

class FakeRegistrar {
  public readonly tools = new Map<string, RegisteredTool>();

  public registerTool(
    name: string,
    _config: { description?: string },
    handler: (args: Record<string, unknown>) => Promise<unknown>,
  ): void {
    this.tools.set(name, { handler });
  }
}

describe("registerWriteTools", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (access as jest.MockedFunction<typeof access>).mockResolvedValue(undefined);
    (readFile as jest.MockedFunction<typeof readFile>).mockImplementation(
      async (filePath) => {
        const pathText = String(filePath);
        if (pathText.endsWith(".editorconfig")) {
          return "root = true\n[*]\nindent_size = 2\nindent_style = space\n";
        }

        return "const foo = oldName\n";
      },
    );
    (writeFile as jest.MockedFunction<typeof writeFile>).mockResolvedValue(
      undefined,
    );
  });

  it("renames symbols when the server supports rename and saves the changed file", async () => {
    const registrar = new FakeRegistrar();
    const client = createClient({
      changes: {
        "file:///workspace/src/index.ts": [
          {
            range: {
              start: { line: 0, character: 12 },
              end: { line: 0, character: 19 },
            },
            newText: "newName",
          },
        ],
      },
    });

    registerWriteTools(registrar, createLifecycle(client));

    const result = await getHandler(
      registrar,
      "lsp_rename",
    )({
      file: "/workspace/src/index.ts",
      line: 0,
      character: 12,
      newName: "newName",
    });

    expect(client.request).toHaveBeenCalledWith(
      "textDocument/rename",
      {
        textDocument: { uri: "file:///workspace/src/index.ts" },
        position: { line: 0, character: 12 },
        newName: "newName",
      },
      15000,
    );
    expect(writeFile).toHaveBeenCalledWith(
      "/workspace/src/index.ts",
      "const foo = newName\n",
      "utf8",
    );
    expect(client.notify).toHaveBeenCalledWith("textDocument/didSave", {
      textDocument: { uri: "file:///workspace/src/index.ts" },
    });
    expect(result).toEqual({
      content: [{ type: "text", text: "Applied workspace edit to 1 file(s)" }],
      raw: { changedFiles: ["/workspace/src/index.ts"] },
    });
  });

  it("returns an error when rename is unsupported", async () => {
    const registrar = new FakeRegistrar();
    const client = createClient(null, { renameProvider: false });
    registerWriteTools(registrar, createLifecycle(client));

    await expect(
      getHandler(
        registrar,
        "lsp_rename",
      )({
        file: "/workspace/src/index.ts",
        line: 0,
        character: 0,
        newName: "x",
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "Rename is not supported by the active language server.",
        },
      ],
      error: true,
      raw: null,
    });
  });

  it("lists code actions without applying them", async () => {
    const registrar = new FakeRegistrar();
    const actions = [{ title: "Fix import", kind: "quickfix" }];
    const client = createClient(actions);
    registerWriteTools(registrar, createLifecycle(client));

    await expect(
      getHandler(
        registrar,
        "lsp_code_action",
      )({ file: "/workspace/src/index.ts", line: 0, character: 0 }),
    ).resolves.toEqual({
      content: [
        { type: "text", text: "Available code actions:\n- [0] Fix import" },
      ],
      raw: actions,
    });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("applies the selected code action edit and command", async () => {
    const registrar = new FakeRegistrar();
    const client = createClient([
      {
        title: "Fix import",
        edit: {
          changes: {
            "file:///workspace/src/index.ts": [
              {
                range: {
                  start: { line: 0, character: 0 },
                  end: { line: 0, character: 5 },
                },
                newText: "let",
              },
            ],
          },
        },
        command: { command: "workspace.applyFix", arguments: ["x"] },
      },
    ]);
    registerWriteTools(registrar, createLifecycle(client));

    const result = await getHandler(
      registrar,
      "lsp_code_action",
    )({ file: "/workspace/src/index.ts", line: 0, character: 0, apply: true });

    expect(client.request).toHaveBeenCalledWith(
      "workspace/executeCommand",
      { command: "workspace.applyFix", arguments: ["x"] },
      15000,
    );
    expect(result).toEqual({
      content: [{ type: "text", text: "Applied code action: Fix import" }],
      raw: { title: "Fix import", changedFiles: ["/workspace/src/index.ts"] },
    });
  });

  it("formats a file using editorconfig defaults", async () => {
    const registrar = new FakeRegistrar();
    const client = createClient([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 21 },
        },
        newText: "const foo = oldName;\n",
      },
    ]);
    registerWriteTools(registrar, createLifecycle(client));

    await getHandler(
      registrar,
      "lsp_formatting",
    )({ file: "/workspace/src/index.ts" });

    expect(client.request).toHaveBeenCalledWith(
      "textDocument/formatting",
      {
        textDocument: { uri: "file:///workspace/src/index.ts" },
        options: { tabSize: 2, insertSpaces: true },
      },
      15000,
    );
  });

  it("formats a range with explicit options", async () => {
    const registrar = new FakeRegistrar();
    const client = createClient([
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 21 },
        },
        newText: "const foo = oldName;\n",
      },
    ]);
    registerWriteTools(registrar, createLifecycle(client));

    await getHandler(
      registrar,
      "lsp_range_formatting",
    )({
      file: "/workspace/src/index.ts",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 21 },
      },
      options: { tabSize: 4, insertSpaces: false },
    });

    expect(client.request).toHaveBeenCalledWith(
      "textDocument/rangeFormatting",
      {
        textDocument: { uri: "file:///workspace/src/index.ts" },
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 21 },
        },
        options: { tabSize: 4, insertSpaces: false },
      },
      15000,
    );
  });

  it("supports indexed code actions and document changes", async () => {
    const registrar = new FakeRegistrar();
    const client = createClient([
      { title: "Skip me" },
      {
        title: "Apply me",
        edit: {
          documentChanges: [
            {
              textDocument: {
                uri: "file:///workspace/src/index.ts",
                version: 1,
              },
              edits: [
                {
                  range: {
                    start: { line: 0, character: 6 },
                    end: { line: 0, character: 9 },
                  },
                  newText: "bar",
                },
              ],
            },
          ],
        },
      },
    ]);
    registerWriteTools(registrar, createLifecycle(client));

    await expect(
      getHandler(
        registrar,
        "lsp_code_action",
      )({
        file: "/workspace/src/index.ts",
        line: 0,
        character: 0,
        apply: { index: 1 },
      }),
    ).resolves.toEqual({
      content: [{ type: "text", text: "Applied code action: Apply me" }],
      raw: { title: "Apply me", changedFiles: ["/workspace/src/index.ts"] },
    });
  });

  it("handles missing clients, formatter defaults, and empty code actions", async () => {
    const registrar = new FakeRegistrar();
    const noClientLifecycle = {
      getClientForFile: jest.fn(() => null),
      getReadyClients: jest.fn(() => []),
      getFileDiagnostics: jest.fn((_: string) => []),
      getWorkspaceDiagnostics: jest.fn(() => []),
      getHealth: jest.fn(() => []),
      ensureLanguageForFile: jest.fn().mockResolvedValue(undefined),
      ensureSeedFilesOpen: jest.fn().mockResolvedValue(undefined),
      analyzeWorkspace: jest.fn().mockResolvedValue({ perLanguage: [] }),
    };
    registerWriteTools(registrar, noClientLifecycle);

    await expect(
      getHandler(
        registrar,
        "lsp_rename",
      )({ file: "/workspace/README.md", line: 0, character: 0, newName: "x" }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "No language server available for .md files. Run lsp_health for details.",
        },
      ],
      error: true,
      raw: null,
    });
    await expect(
      getHandler(
        registrar,
        "lsp_code_action",
      )({ file: "/workspace/README.md", line: 0, character: 0 }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "No language server available for .md files. Run lsp_health for details.",
        },
      ],
      error: true,
      raw: null,
    });
    await expect(
      getHandler(registrar, "lsp_formatting")({ file: "/workspace/README.md" }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "No language server available for .md files. Run lsp_health for details.",
        },
      ],
      error: true,
      raw: null,
    });

    const secondRegistrar = new FakeRegistrar();
    const client = createClient([]);
    (access as jest.MockedFunction<typeof access>).mockRejectedValue(
      new Error("missing"),
    );
    registerWriteTools(secondRegistrar, createLifecycle(client));
    await expect(
      getHandler(
        secondRegistrar,
        "lsp_formatting",
      )({ file: "/workspace/src/index.ts" }),
    ).resolves.toEqual({
      content: [{ type: "text", text: "Applied workspace edit to 0 file(s)" }],
      raw: { changedFiles: [] },
    });
    await expect(
      getHandler(
        secondRegistrar,
        "lsp_code_action",
      )({ file: "/workspace/src/index.ts", line: 0, character: 0 }),
    ).resolves.toEqual({
      content: [{ type: "text", text: "No result" }],
      raw: [],
    });
  });

  it("maps write failures to timeout guidance", async () => {
    const registrar = new FakeRegistrar();
    const client = createClient(
      new Error("LSP request timed out: textDocument/rename"),
    );
    registerWriteTools(registrar, createLifecycle(client));

    await expect(
      getHandler(
        registrar,
        "lsp_rename",
      )({
        file: "/workspace/src/index.ts",
        line: 0,
        character: 0,
        newName: "x",
      }),
    ).resolves.toEqual({
      content: [
        {
          type: "text",
          text: "Operation timed out after 15s — try a more specific query or check the LSP server health",
        },
      ],
      error: true,
      raw: null,
    });
  });
});

function getHandler(
  registrar: FakeRegistrar,
  name: string,
): (args: Record<string, unknown>) => Promise<unknown> {
  const tool = registrar.tools.get(name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }

  return tool.handler;
}

function createLifecycle(client: MockClient): MockLifecycle {
  return {
    getClientForFile: jest.fn((_: string) => client),
    getReadyClients: jest.fn(() => [client]),
    getFileDiagnostics: jest.fn((_: string) => []),
    getWorkspaceDiagnostics: jest.fn(() => []),
    getHealth: jest.fn(() => []),
    ensureLanguageForFile: jest.fn().mockResolvedValue(undefined),
    ensureSeedFilesOpen: jest.fn().mockResolvedValue(undefined),
    analyzeWorkspace: jest.fn().mockResolvedValue({ perLanguage: [] }),
  };
}

function createClient(
  result: unknown,
  capabilities: Record<string, unknown> = { renameProvider: true },
): MockClient {
  return {
    request: jest.fn().mockImplementation(async (method: string) => {
      if (method === "workspace/executeCommand") {
        return null;
      }

      if (result instanceof Error) {
        throw result;
      }

      return result;
    }),
    notify: jest.fn(),
    getCapabilities: jest.fn(() => capabilities),
    ensureDidOpen: jest.fn().mockResolvedValue(undefined),
    waitForDiagnosticsPublish: jest.fn().mockResolvedValue(undefined),
    ensureSeedFileOpen: jest.fn().mockResolvedValue(undefined),
  };
}

interface MockClient {
  request: jest.Mock<Promise<unknown>, [string, unknown, number]>;
  notify: jest.Mock<void, [string, unknown]>;
  getCapabilities: jest.Mock<Record<string, unknown>, []>;
  ensureDidOpen: jest.Mock<Promise<void>, [string]>;
  waitForDiagnosticsPublish: jest.Mock<Promise<void>, [string, number]>;
  ensureSeedFileOpen: jest.Mock<Promise<void>, [string[]]>;
}

interface MockLifecycle {
  getClientForFile: jest.Mock<MockClient | null, [string]>;
  getReadyClients: jest.Mock<MockClient[], [string?]>;
  getFileDiagnostics: jest.Mock<[], [string]>;
  getWorkspaceDiagnostics: jest.Mock<[], [string?]>;
  getHealth: jest.Mock<[], []>;
  ensureLanguageForFile: jest.Mock<Promise<void>, [string]>;
  ensureSeedFilesOpen: jest.Mock<Promise<void>, []>;
  analyzeWorkspace: jest.Mock<Promise<any>, [string?]>;
}
