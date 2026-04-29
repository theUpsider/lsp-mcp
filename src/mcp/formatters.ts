import type {
  CompletionItem,
  Diagnostic,
  DocumentSymbol,
  Hover,
  Location,
  MarkedString,
  SymbolInformation
} from 'vscode-languageserver-protocol';

import type { LanguageServerHealth } from '../lsp/lifecycle-manager';

import { uriToPath } from '../utils/uri';

type DiagnosticWithUri = Diagnostic & { uri?: string };

const SYMBOL_KIND_ICONS: Record<number, string> = {
  1: '📄',
  2: '📦',
  3: '🔖',
  4: '🧩',
  5: '📦',
  6: '🔧',
  7: '🏗️',
  8: '🧠',
  9: '📐',
  10: '📚',
  11: '🔌',
  12: 'ƒ',
  13: '≡',
  14: '🔒',
  15: '📝',
  16: '№',
  17: '🧮',
  18: '📏',
  19: '🧱',
  20: '🔑',
  21: '❌',
  22: '🧩',
  23: '➡️',
  24: '🎯',
  25: '📦',
  26: '🔎'
};

const COMPLETION_KIND_LABELS: Record<number, string> = {
  2: 'Methods',
  3: 'Functions',
  4: 'Constructors',
  5: 'Fields',
  6: 'Variables',
  7: 'Classes',
  8: 'Interfaces',
  9: 'Modules',
  10: 'Properties',
  11: 'Units',
  12: 'Values',
  13: 'Enums',
  14: 'Keywords',
  15: 'Snippets',
  16: 'Colors',
  17: 'Files',
  18: 'References',
  19: 'Folders',
  20: 'Enum members',
  21: 'Constants',
  22: 'Structs',
  23: 'Events',
  24: 'Operators',
  25: 'Type parameters'
};

const DIAGNOSTIC_SEVERITY_LABELS: Record<number, string> = {
  1: 'Errors',
  2: 'Warnings',
  3: 'Information',
  4: 'Hints'
};

export function formatHover(result: Hover | null): string {
  if (!result) {
    return 'No result';
  }

  const rawText = hoverContentsToText(result.contents).trim();
  if (!rawText) {
    return 'No result';
  }

  const codeBlocks = Array.from(rawText.matchAll(/```(?<lang>[^\n`]*)\n(?<code>[\s\S]*?)```/g));
  const firstCode = codeBlocks[0]?.groups?.code?.trim();
  const firstLang = codeBlocks[0]?.groups?.lang?.trim() ?? '';
  const summarySource = rawText.replace(/```[\s\S]*?```/g, '').trim();
  const summaryLine = summarySource.split(/\n+/).find(Boolean) ?? '';

  if (firstCode && summaryLine) {
    return `**${firstCode}** — ${summaryLine}\n\n\`\`\`${firstLang}\n${firstCode}\n\`\`\``;
  }

  return summaryLine || firstCode || rawText;
}

export function formatDefinition(locations: Location[] | null): string {
  if (!locations || locations.length === 0) {
    return 'No result';
  }

  if (locations.length === 1) {
    return `Found 1 definition: \`${formatLocation(locations[0])}\``;
  }

  return ['Found definitions:', ...locations.map((location) => `- \`${formatLocation(location)}\``)].join('\n');
}

export function formatReferences(locations: Location[] | null): string {
  if (!locations || locations.length === 0) {
    return 'No result';
  }

  return [`Found ${locations.length} references:`, ...locations.map((location) => `- \`${formatLocation(location)}\``)].join('\n');
}

export function formatSymbols(symbols: Array<DocumentSymbol | SymbolInformation> | null): string {
  if (!symbols || symbols.length === 0) {
    return 'No result';
  }

  return symbols.map((symbol) => {
    const icon = SYMBOL_KIND_ICONS[symbol.kind] ?? '•';
    const detail = 'location' in symbol
      ? formatLocation(symbol.location)
      : `${symbol.name}`;
    return `- ${icon} \`${symbol.name}\`${'location' in symbol ? ` — ${detail}` : ''}`;
  }).join('\n');
}

export function formatDiagnostics(diagnostics: DiagnosticWithUri[] | null, scope: 'file' | 'workspace'): string {
  if (!diagnostics || diagnostics.length === 0) {
    return 'No result';
  }

  const grouped = new Map<number, DiagnosticWithUri[]>();
  const ordered = [...diagnostics].sort((left, right) => (left.severity ?? 4) - (right.severity ?? 4));
  for (const diagnostic of ordered) {
    const severity = diagnostic.severity ?? 4;
    const bucket = grouped.get(severity) ?? [];
    bucket.push(diagnostic);
    grouped.set(severity, bucket);
  }

  const lines = [`${scope === 'workspace' ? 'Workspace' : 'File'} diagnostics: ${diagnostics.length} issue(s)`];
  for (const severity of [1, 2, 3, 4]) {
    const bucket = grouped.get(severity);
    if (!bucket || bucket.length === 0) {
      continue;
    }

    lines.push('', `### ${DIAGNOSTIC_SEVERITY_LABELS[severity]}`);
    for (const diagnostic of bucket) {
      lines.push(`- ${formatDiagnostic(diagnostic)}`);
    }
  }

  return lines.join('\n');
}

export function formatCompletion(items: CompletionItem[] | null): string {
  if (!items || items.length === 0) {
    return 'No result';
  }

  const limited = items.slice(0, 50);
  const grouped = new Map<string, CompletionItem[]>();
  for (const item of limited) {
    const label = COMPLETION_KIND_LABELS[item.kind ?? 1] ?? 'Other';
    const bucket = grouped.get(label) ?? [];
    bucket.push(item);
    grouped.set(label, bucket);
  }

  const lines = [`Showing ${limited.length} of ${items.length} completion item(s)`];
  for (const [label, bucket] of grouped.entries()) {
    lines.push('', `### ${label}`);
    for (const item of bucket) {
      lines.push(`- \`${item.label}\`${item.detail ? ` — ${item.detail}` : ''}`);
    }
  }

  return lines.join('\n');
}

export function formatHealth(healths: LanguageServerHealth[]): string {
  if (healths.length === 0) {
    return 'No result';
  }

  return [
    '| Language | Status | Error |',
    '| --- | --- | --- |',
    ...healths.map((health) => `| ${health.language} | ${health.status} | ${health.error ?? ''} |`)
  ].join('\n');
}

export function formatError(error: unknown): { error: true; text: string; raw: unknown } {
  return {
    error: true,
    text: error instanceof Error ? error.message : String(error),
    raw: error
  };
}

function hoverContentsToText(contents: Hover['contents']): string {
  if (typeof contents === 'string') {
    return contents;
  }

  if (Array.isArray(contents)) {
    return contents.map(markedStringToText).join('\n\n');
  }

  if ('kind' in contents) {
    return contents.value;
  }

  return markedStringToText(contents);
}

function markedStringToText(value: MarkedString): string {
  return typeof value === 'string' ? value : `\`\`\`${value.language}\n${value.value}\n\`\`\``;
}

function formatLocation(location: Location): string {
  return `${uriToPath(location.uri)}:${location.range.start.line + 1}:${location.range.start.character + 1}`;
}

function formatDiagnostic(diagnostic: DiagnosticWithUri): string {
  const location = diagnostic.uri ? `\`${uriToPath(diagnostic.uri)}:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}\` ` : '';
  const source = diagnostic.source ? `${diagnostic.source}: ` : '';
  return `${location}${source}${diagnostic.message}`.trim();
}
