import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { getLspCandidates } from '../../src/detection/lsp-mapping';
import { LspClient } from '../../src/lsp/lsp-client';
import type { LanguageServerHealth } from '../../src/lsp/lifecycle-manager';
import { registerReadTools } from '../../src/mcp/tools/read-tools';
import { type McpToolResult, type MinimalLifecycleManager, type ToolRegistrar } from '../../src/mcp/tools/shared';
import { pathToUri } from '../../src/utils/uri';

export interface TmpProject {
  dir: string;
  file: string;
}

export interface SmokeResult {
  text: string;
  raw: unknown;
}

interface SmokeRequest {
  language: string;
  line: number;
  character: number;
}

type SmokeTool = 'lsp_definition';

class IntegrationRegistrar implements ToolRegistrar {
  public readonly tools = new Map<string, (args: Record<string, unknown>) => Promise<McpToolResult>>();

  public registerTool(
    name: string,
    _config: { description?: string },
    handler: (args: Record<string, unknown>) => Promise<McpToolResult>
  ): void {
    this.tools.set(name, handler);
  }
}

export function hasAvailableLsp(language: string): boolean {
  return getSmokeCandidate(language) !== null;
}

export async function spawnLspClient(language: string, tmpDir: string): Promise<LspClient | null> {
  const candidate = getSmokeCandidate(language);
  if (!candidate) {
    return null;
  }

  const client = new LspClient(candidate, tmpDir, 'error');
  await client.start();
  return client;
}

export async function createTmpProject(language: string): Promise<TmpProject> {
  const dir = await mkdtemp(path.join(tmpdir(), `lsp-mcp-${language}-`));
  const fixture = fixtureFor(language, dir);

  await Promise.all(fixture.files.map(async ({ relativePath, content }) => {
    const filePath = path.join(dir, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content, 'utf8');
  }));

  return { dir, file: path.join(dir, fixture.entryFile) };
}

export async function cleanup(dir: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (!isRetryableCleanupError(error) || attempt === 19) {
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

export async function runDefinitionSmokeTest(request: SmokeRequest): Promise<SmokeResult> {
  return await runToolSmokeTest('lsp_definition', request);
}

async function runToolSmokeTest(toolName: SmokeTool, request: SmokeRequest): Promise<SmokeResult> {
  const project = await createTmpProject(request.language);
  let client: LspClient | null = null;

  try {
    client = await spawnLspClient(request.language, project.dir);
    if (!client) {
      throw new Error(`No LSP binary available for ${request.language}`);
    }

    const result = await waitForMeaningfulResult(toolName, client, request.language, project.file, request.line, request.character);
    return result;
  } finally {
    if (client) {
      await client.shutdown().catch(() => undefined);
      await delay(1500);
    }

    await cleanup(project.dir);
  }
}

async function waitForMeaningfulResult(
  toolName: SmokeTool,
  client: LspClient,
  language: string,
  file: string,
  line: number,
  character: number
): Promise<SmokeResult> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const result = await invokeTool(toolName, client, language, file, line, character);
    if (result.text !== 'No result' && result.raw !== null) {
      return result;
    }

    await delay(500);
  }

  return await invokeTool(toolName, client, language, file, line, character);
}

async function invokeTool(toolName: SmokeTool, client: LspClient, language: string, file: string, line: number, character: number): Promise<SmokeResult> {
  const registrar = new IntegrationRegistrar();
  registerReadTools(registrar, createLifecycleManager(client, language), {
    initializeManager: async () => ({ root: path.dirname(file), health: [] })
  });

  const handler = registrar.tools.get(toolName);
  if (!handler) {
    throw new Error(`${toolName} tool was not registered`);
  }

  if (language === 'rust') {
    await client.ensureDidOpen(file);
    client.notify('textDocument/didSave', { textDocument: { uri: pathToUri(file) } });
  }

  return await handler({ file, line, character }).then((result) => ({
    text: extractText(result),
    raw: result.raw
  }));
}

function createLifecycleManager(client: LspClient, language: string): MinimalLifecycleManager {
  const health: LanguageServerHealth[] = [{ language, status: 'ready' }];

  return {
    getClientForFile: () => client,
    getReadyClients: () => [client],
    getFileDiagnostics: () => [],
    getWorkspaceDiagnostics: () => [],
    getHealth: () => health,
    ensureLanguageForFile: async () => undefined,
    ensureSeedFilesOpen: async () => undefined,
    analyzeWorkspace: async () => undefined
  };
}

function extractText(result: McpToolResult): string {
  const item = result.content[0];
  if (item?.type !== 'text') {
    throw new Error('Unexpected MCP tool response shape');
  }

  return item.text;
}

function commandExists(command: string): boolean {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [command], { stdio: 'ignore' });
  return result.status === 0;
}

function getSmokeCandidate(language: string): ReturnType<typeof getLspCandidates>[number] | null {
  const candidates = getLspCandidates(language);
  const supportedCandidates = language === 'kotlin'
    ? candidates.filter((candidate) => candidate.cmd === 'intellij-server')
    : candidates;

  return supportedCandidates.find((candidate) => commandExists(candidate.cmd)) ?? null;
}

function isRetryableCleanupError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as Error & { code?: string }).code === 'ENOTEMPTY';
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fixtureFor(language: string, dir: string): {
  entryFile: string;
  files: Array<{ relativePath: string; content: string }>;
} {
  switch (language) {
    case 'python':
      return {
        entryFile: 'test.py',
        files: [
          { relativePath: 'pyproject.toml', content: '[project]\nname = "smoke"\nversion = "0.0.0"\n' },
          { relativePath: 'test.py', content: 'x = 1\nprint(x)\n' }
        ]
      };
    case 'typescript':
      return {
        entryFile: 'test.ts',
        files: [
          { relativePath: 'package.json', content: '{"name":"smoke-ts","private":true}\n' },
          { relativePath: 'tsconfig.json', content: '{"compilerOptions":{"target":"ES2022"}}\n' },
          { relativePath: 'test.ts', content: 'const x = 1;\nconsole.log(x);\n' }
        ]
      };
    case 'javascript':
      return {
        entryFile: 'test.js',
        files: [
          { relativePath: 'package.json', content: '{"name":"smoke-js","private":true}\n' },
          { relativePath: 'test.js', content: 'const x = 1;\nconsole.log(x);\n' }
        ]
      };
    case 'go':
      return {
        entryFile: 'main.go',
        files: [
          { relativePath: 'go.mod', content: 'module smoke\n\ngo 1.22\n' },
          { relativePath: 'main.go', content: 'package main\nfunc main() { x := 1\n_ = x\n}\n' }
        ]
      };
    case 'rust':
      return {
        entryFile: 'src/main.rs',
        files: [
          { relativePath: 'Cargo.toml', content: '[package]\nname = "smoke"\nversion = "0.1.0"\nedition = "2021"\n' },
          { relativePath: 'src/main.rs', content: 'fn square(value: i32) -> i32 { value }\nfn main() { let y = square(1); let _ = y; }\n' }
        ]
      };
    case 'java':
      return {
        entryFile: 'src/main/java/com/example/Main.java',
        files: [
          {
            relativePath: 'pom.xml',
            content: '<project xmlns="http://maven.apache.org/POM/4.0.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd"><modelVersion>4.0.0</modelVersion><groupId>com.example</groupId><artifactId>smoke</artifactId><version>0.0.1</version></project>\n'
          },
          {
            relativePath: 'src/main/java/com/example/Main.java',
            content: 'package com.example;\nclass Main {\n  public static void main(String[] args) {\n    int x = 1;\n    System.out.println(x);\n  }\n}\n'
          }
        ]
      };
    case 'csharp':
      return {
        entryFile: 'Program.cs',
        files: [
          {
            relativePath: 'smoke.csproj',
            content: '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup></Project>\n'
          },
          { relativePath: 'Program.cs', content: 'namespace Smoke;\nclass Program {\n  static void Main() {\n    var x = 1;\n    _ = x;\n  }\n}\n' }
        ]
      };
    case 'ruby':
      return {
        entryFile: 'test.rb',
        files: [
          { relativePath: 'Gemfile', content: 'source "https://rubygems.org"\n' },
          { relativePath: 'test.rb', content: 'x = 1\nputs x\n' }
        ]
      };
    case 'php':
      return {
        entryFile: 'test.php',
        files: [
          { relativePath: 'composer.json', content: '{"name":"smoke/php"}\n' },
          { relativePath: 'test.php', content: '<?php\n$x = 1;\necho $x;\n' }
        ]
      };
    case 'kotlin':
      return {
        entryFile: 'src/main/kotlin/Main.kt',
        files: [
          { relativePath: 'build.gradle.kts', content: 'plugins { kotlin("jvm") version "1.9.24" }\nrepositories { mavenCentral() }\n' },
          { relativePath: 'src/main/kotlin/Main.kt', content: 'fun main() {\n    val x = 1\n    println(x)\n}\n' }
        ]
      };
    case 'swift':
      return {
        entryFile: 'Sources/main.swift',
        files: [
          { relativePath: 'Package.swift', content: '// swift-tools-version: 5.9\nimport PackageDescription\nlet package = Package(name: "Smoke")\n' },
          { relativePath: 'Sources/main.swift', content: 'let x = 1\nprint(x)\n' }
        ]
      };
    case 'c':
      return {
        entryFile: 'test.c',
        files: [{ relativePath: 'test.c', content: 'int main() {\n  int x = 1;\n  return x;\n}\n' }]
      };
    case 'cpp':
      return {
        entryFile: 'test.cpp',
        files: [{ relativePath: 'test.cpp', content: 'int main() {\n  int x = 1;\n  return x;\n}\n' }]
      };
    default:
      throw new Error(`Unsupported smoke test language: ${language} in ${dir}`);
  }
}
