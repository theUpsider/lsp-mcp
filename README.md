# Universal LSP MCP Server

> One MCP server to rule all Language Servers — automatic language detection, zero-config setup.

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/@theupsider/lsp-mcp)](https://www.npmjs.com/package/@theupsider/lsp-mcp)
[![Node.js](https://img.shields.io/badge/Node.js-20%20%7C%2022%20%7C%2024-brightgreen)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-Linux%20%7C%20macOS%20%7C%20Windows-lightgrey)](https://github.com/theupsider/lsp-mcp)

## Overview

A Model Context Protocol (MCP) server that gives language models access to **Language Server Protocol (LSP)** functionality across all major programming languages. Unlike existing LSP-MCP servers, this project supports **13 languages out of the box** with **zero manual configuration** — it automatically detects your codebase, selects the right language server, and exposes all LSP operations through a stable, language-independent tool interface.

## Supported Languages

| Language   | Language Server              | Auto-Detected Via            |
| ---------- | ---------------------------- | ---------------------------- |
| Python     | `pyright` / `pylsp`          | `pyproject.toml`, `setup.py` |
| TypeScript | `typescript-language-server` | `tsconfig.json`              |
| JavaScript | `typescript-language-server` | `package.json`               |
| C#         | `omnisharp`                  | `*.csproj`, `*.sln`          |
| Java       | `vscode-java` / `jdtls`      | `pom.xml`, `build.gradle`    |
| Go         | `gopls`                      | `go.mod`                     |
| Rust       | `rust-analyzer`              | `Cargo.toml`                 |
| C / C++    | `clangd`                     | `*.c`, `*.cpp`, `*.h`        |
| Ruby       | `solargraph`                 | `Gemfile`                    |
| PHP        | `intelephense`               | `composer.json`              |
| Kotlin     | `kotlin-language-server`     | `build.gradle.kts`           |
| Swift      | `sourcekit-lsp`              | `Package.swift`              |

## Features

- **🔍 Automatic Language Detection** — Scans project root for language markers (`package.json`, `Cargo.toml`, `go.mod`, etc.)
- **🔄 Auto Language Server Selection** — Hardcoded mapping with fallback servers; installs missing LSPs automatically
- **🤖 Hands-Free Initialization** — Clients that support [MCP Roots](https://modelcontextprotocol.io/docs/concepts/roots) auto-initialize on connect — `lsp_init` disappears from the tool list once all servers start cleanly
- **💾 Cross-Session Persistence** — Initialized workspaces and their ready languages are remembered across server restarts
- **🔁 Graceful Degradation** — `lsp_init` reappears if a previously-working server starts failing (e.g. language added, binary missing)
- **🛠 12 LSP Tools** — Definition, references, symbols, diagnostics, rename, code actions, formatting, and more
- **📝 Read & Write Operations** — Both inspection and modification of code via LSP
- **🌐 Polyglot Support** — Multiple language servers run simultaneously in the same project
- **📋 Hybrid Responses** — Human-readable `text` field + raw LSP data in `raw` field
- **🔌 MCP Stdio Protocol** — Works with any MCP-compatible client
- **⚡ Zero Config** — Install and run, no per-language setup required

## Installation

> **Important:** Install `lsp-mcp` on the **same machine where your code lives**. The language servers it manages need direct filesystem access to your codebase — they cannot work over a remote connection or on a different machine than your source files.

```bash
# npm
npm install -g @theupsider/lsp-mcp@latest

# bun
bun install -g @theupsider/lsp-mcp@latest
```

## Quickstart

### VS Code / Cursor

Add to your **workspace** `.vscode/mcp.json` (recommended — ensures the server runs on the same machine as your code, including SSH remotes, WSL, and Dev Containers):

```json
{
  "servers": {
    "lsp-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@theupsider/lsp-mcp@latest"]
    }
  }
}
```

> **Why workspace config?** VS Code runs servers defined in `.vscode/mcp.json` wherever the workspace lives. Servers defined in your user profile always run locally — which breaks LSP when your code is on a remote machine.

### CLI

```bash
# Run the server (reads from stdin, writes to stdout)
lsp-mcp
```

The server starts with no active project. **Most clients auto-initialize** when they support the MCP Roots protocol (VS Code, Copilot, etc.), but `lsp_init` remains available as a manual override.

For clients without Roots support, the first action the model must take is calling `lsp_init`:

```
lsp_init({ root: "/path/to/your/project" })
```

`lsp_init` will:

1. Scan the root for language markers and start matching language servers (best-effort)
2. Disappear from the tool list when you called it explicitly — subsequent calls to any LSP tool trigger lazy server startup for that file's language if no server was detected at init time
3. Return health status for all servers that were started eagerly

**Optional: pre-warm specific languages** (skips detection, faster cold start):

```
lsp_init({ root: "/path/to/project", languages: ["python", "typescript"] })
```

**Persistence:** Once initialized, the workspace configuration (detected languages) is saved to your OS-standard config directory (`~/.config/lsp-mcp/` on Linux, `~/Library/Application Support/lsp-mcp/` on macOS, `%APPDATA%\lsp-mcp\` on Windows). On subsequent server startups, the MCP server will automatically reconnect using the last-known root, so you rarely need to call `lsp_init` again.

**Re-emergence:** If a language server that was previously healthy fails to start (e.g. you added a new language or removed a binary), `lsp_init` will reappear in the tool list, signaling the model should re-initialize.

## Available Tools

### Read-Only Tools

| Tool                    | Description                          | Key Parameters                                         | Visibility                                                       |
| ----------------------- | ------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `lsp_init`              | Initialize server for a project root | `root` (required), `languages` (optional string array) | Conditional — hidden after a successful explicit `lsp_init` call |
| `lsp_definition`        | Go to definition                     | `file`, `line`, `character`                            | Always                                                           |
| `lsp_references`        | Find all references                  | `file`, `line`, `character`                            | Always                                                           |
| `lsp_document_symbols`  | List symbols in a file               | `file`                                                 | Always                                                           |
| `lsp_workspace_symbols` | Search symbols across workspace      | `query` (limit: 100–500 results)                       | Always                                                           |
| `lsp_diagnostics`       | Get errors & warnings                | `file` (scope: `file` or `workspace`)                  | Always                                                           |
| `lsp_type_definition`   | Go to type definition                | `file`, `line`, `character`                            | Always                                                           |
| `lsp_implementation`    | Find implementations                 | `file`, `line`, `character`                            | Always                                                           |
| `lsp_health`            | Check status of all LSP servers      | _(none)_                                               | Always                                                           |

### Write Tools

| Tool                   | Description               | Key Parameters                         |
| ---------------------- | ------------------------- | -------------------------------------- |
| `lsp_rename`           | Rename symbol             | `file`, `line`, `character`, `newName` |
| `lsp_code_action`      | Apply / list code actions | `file`, `line`, `character`, `apply`   |
| `lsp_formatting`       | Format document           | `file`                                 |
| `lsp_range_formatting` | Format code range         | `file`, `range`                        |

## Configuration

| Environment Variable | Description                         | Default |
| -------------------- | ----------------------------------- | ------- |
| `LSP_MCP_LOG_LEVEL`  | Log level: `error`, `info`, `debug` | `info`  |

## Setup Scripts

Two helper scripts are included for setting up a development environment:

- **`setup-languages-ubuntu24.sh`** — Installs all language runtimes, compilers, and toolchains on Ubuntu 24.04 (Python, Node.js, Java, Go, Rust, Ruby, PHP, Kotlin, Swift, etc.)
- **`setup-lsp.sh`** — Installs all language servers (pyright, typescript-language-server, omnisharp, jdtls, gopls, rust-analyzer, clangd, solargraph, intelephense, kotlin-language-server)

```bash
# 1. Install language runtimes
chmod +x setup-languages-ubuntu24.sh
./setup-languages-ubuntu24.sh

# 2. Install language servers
chmod +x setup-lsp.sh
./setup-lsp.sh

# 3. Reload PATH
source ~/.bashrc
```

## Troubleshooting

### Language server not found

If a language server cannot be auto-installed, the server logs a structured error and continues running for other languages. Manually install the missing server:

```bash
# Python
pipx install python-lsp-server

# C#
dotnet tool install -g omnisharp-roslyn

# Java
npm install -g vscode-java

# Ruby
gem install solargraph
```

### Server not detecting language

Ensure your project root contains a language marker file (e.g., `package.json` for TypeScript, `Cargo.toml` for Rust). The server scans the directory passed to `lsp_init` for these markers.

### High memory usage

Each language server runs as a separate process. For large projects with many languages, consider limiting the workspace or using `LSP_MCP_LOG_LEVEL=info` to monitor server health.

## Architecture

```
┌─────────────────────────────────────────────┐
│           MCP Client (AI Model)             │
└──────────────────┬──────────────────────────┘
                   │ MCP Protocol (stdio)
                   ▼
┌─────────────────────────────────────────────┐
│         LSP MCP Server (Node.js)            │
│  ┌───────────┐ ┌──────────┐ ┌───────────┐  │
│  │ lsp_init  │ │ lsp_...  │ │ lsp_...   │  │
│  └─────┬─────┘ └────┬─────┘ └─────┬─────┘  │
│        └─────────────┼─────────────┘        │
│                      ▼                       │
│          Language Router & Adapter           │
│  (auto-detects language → selects LSP)       │
└──────┬──────────┬──────────┬───────────┬─────┘
       │          │          │           │
       ▼          ▼          ▼           ▼
   pyright  typescript  gopls    clangd
   pylsp    lsp         rust-    ...
                         analyzer
```

## License

[Apache-2.0](LICENSE)
