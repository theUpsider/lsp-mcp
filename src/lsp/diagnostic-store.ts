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
  private readonly diagnostics = new Map<string, DiagnosticEntry[]>();

  public store(params: unknown): void {
    if (!isPublishDiagnosticsParams(params)) {
      return;
    }

    this.diagnostics.set(params.uri, cloneDiagnostics(params.diagnostics));
  }

  public getForFile(filePath: string): Array<DiagnosticEntry & { uri: string }> {
    const uri = pathToUri(filePath);
    return (this.diagnostics.get(uri) ?? []).map((diagnostic) => ({ ...diagnostic, uri }));
  }

  public getForWorkspace(language?: string): Array<DiagnosticEntry & { uri: string }> {
    const allowedExtensions = language ? extensionsForLanguage(language) : null;

    return Array.from(this.diagnostics.entries())
      .filter(([uri]) => {
        if (!allowedExtensions) {
          return true;
        }

        return allowedExtensions.includes(path.extname(uriToPath(uri)).toLowerCase());
      })
      .flatMap(([uri, diagnostics]) => diagnostics.map((diagnostic) => ({ ...diagnostic, uri })))
      .sort((left, right) => (left.severity ?? 4) - (right.severity ?? 4));
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
