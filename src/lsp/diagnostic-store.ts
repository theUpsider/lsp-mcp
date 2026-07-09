import path from 'node:path';

import type { Diagnostic } from 'vscode-languageserver-protocol';

import { extensionsForLanguage } from '../detection/language-registry';
import { pathToUri, uriToPath } from '../utils/uri';

type DiagnosticEntry = Diagnostic;

interface PublishDiagnosticsParams {
  uri: string;
  diagnostics: DiagnosticEntry[];
}

export class DiagnosticStore {
  // uri -> sourceId -> diagnostics. Keying by source lets multiple servers for the
  // same language (e.g. pyright's type checks and ruff's lint rules) publish
  // diagnostics for the same file without one server's publish overwriting another's.
  private readonly diagnostics = new Map<string, Map<string, DiagnosticEntry[]>>();

  public store(sourceId: string, params: unknown): void {
    if (!isPublishDiagnosticsParams(params)) {
      return;
    }

    let bySource = this.diagnostics.get(params.uri);
    if (!bySource) {
      bySource = new Map();
      this.diagnostics.set(params.uri, bySource);
    }

    bySource.set(sourceId, cloneDiagnostics(params.diagnostics));
  }

  public getForFile(filePath: string): Array<DiagnosticEntry & { uri: string }> {
    const uri = pathToUri(filePath);
    return this.flatten(uri);
  }

  public getForWorkspace(language?: string): Array<DiagnosticEntry & { uri: string }> {
    const allowedExtensions = language ? extensionsForLanguage(language) : null;

    return Array.from(this.diagnostics.keys())
      .filter((uri) => {
        if (!allowedExtensions) {
          return true;
        }

        return allowedExtensions.includes(path.extname(uriToPath(uri)).toLowerCase());
      })
      .flatMap((uri) => this.flatten(uri))
      .sort((left, right) => (left.severity ?? 4) - (right.severity ?? 4));
  }

  private flatten(uri: string): Array<DiagnosticEntry & { uri: string }> {
    const bySource = this.diagnostics.get(uri);
    if (!bySource) {
      return [];
    }

    return Array.from(bySource.values()).flatMap((diagnostics) =>
      diagnostics.map((diagnostic) => ({ ...diagnostic, uri }))
    );
  }
}

function isPublishDiagnosticsParams(value: unknown): value is PublishDiagnosticsParams {
  return typeof value === 'object' && value !== null
    && 'uri' in value && typeof value.uri === 'string'
    && 'diagnostics' in value && Array.isArray(value.diagnostics);
}

function cloneDiagnostics(diagnostics: DiagnosticEntry[]): DiagnosticEntry[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    range: {
      start: { ...diagnostic.range.start },
      end: { ...diagnostic.range.end }
    }
  }));
}
