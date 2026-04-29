import {
  formatCompletion,
  formatDefinition,
  formatDiagnostics,
  formatError,
  formatHealth,
  formatHover,
  formatReferences,
  formatSymbols
} from '../formatters';

import type { CompletionItem } from 'vscode-languageserver-protocol';

describe('mcp formatters', () => {
  it('formats hover results as markdown summary plus code block', () => {
    expect(formatHover({
      contents: {
        kind: 'markdown',
        value: '```ts\ntype Foo = string\n```\n\nFoo description'
      }
    })).toBe('**type Foo = string** — Foo description\n\n```ts\ntype Foo = string\n```');
  });

  it('formats definition locations with file coordinates', () => {
    expect(formatDefinition([
      {
        uri: 'file:///workspace/src/index.ts',
        range: {
          start: { line: 41, character: 4 },
          end: { line: 41, character: 7 }
        }
      }
    ])).toBe('Found 1 definition: `/workspace/src/index.ts:42:5`');
  });

  it('formats references as a bulleted list', () => {
    expect(formatReferences([
      {
        uri: 'file:///workspace/src/index.ts',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 1 }
        }
      },
      {
        uri: 'file:///workspace/src/lib.ts',
        range: {
          start: { line: 2, character: 3 },
          end: { line: 2, character: 4 }
        }
      }
    ])).toBe('Found 2 references:\n- `/workspace/src/index.ts:1:1`\n- `/workspace/src/lib.ts:3:4`');
  });

  it('formats symbols with kind icons', () => {
    expect(formatSymbols([
      {
        name: 'UserService',
        kind: 5,
        location: {
          uri: 'file:///workspace/src/user-service.ts',
          range: {
            start: { line: 4, character: 0 },
            end: { line: 10, character: 0 }
          }
        }
      },
      {
        name: 'login',
        kind: 12,
        location: {
          uri: 'file:///workspace/src/user-service.ts',
          range: {
            start: { line: 6, character: 2 },
            end: { line: 8, character: 0 }
          }
        }
      }
    ])).toContain('- 📦 `UserService` — /workspace/src/user-service.ts:5:1');
  });

  it('formats diagnostics grouped by severity with errors first', () => {
    expect(formatDiagnostics([
      {
        message: 'Cannot find name Foo',
        severity: 1,
        source: 'ts',
        range: {
          start: { line: 1, character: 0 },
          end: { line: 1, character: 3 }
        },
        uri: 'file:///workspace/src/index.ts'
      },
      {
        message: 'Unused variable',
        severity: 2,
        source: 'ts',
        range: {
          start: { line: 3, character: 2 },
          end: { line: 3, character: 5 }
        },
        uri: 'file:///workspace/src/index.ts'
      }
    ], 'workspace')).toBe([
      'Workspace diagnostics: 2 issue(s)',
      '',
      '### Errors',
      '- `/workspace/src/index.ts:2:1` ts: Cannot find name Foo',
      '',
      '### Warnings',
      '- `/workspace/src/index.ts:4:3` ts: Unused variable'
    ].join('\n'));
  });

  it('formats completion items grouped by kind and limited to 50', () => {
    const items: CompletionItem[] = Array.from({ length: 55 }, (_, index) => ({
      label: `item-${index}`,
      kind: index < 30 ? 3 : 2,
      detail: index === 0 ? 'string' : undefined
    }));

    const text = formatCompletion(items);

    expect(text).toContain('Showing 50 of 55 completion item(s)');
    expect(text).toContain('### Functions');
    expect(text).toContain('- `item-0` — string');
    expect(text).toContain('### Methods');
    expect(text).not.toContain('item-54');
  });

  it('formats health rows as a markdown table', () => {
    expect(formatHealth([
      { language: 'typescript', status: 'ready' },
      { language: 'python', status: 'error', error: 'spawn failed' }
    ])).toBe([
      '| Language | Status | Error |',
      '| --- | --- | --- |',
      '| typescript | ready |  |',
      '| python | error | spawn failed |'
    ].join('\n'));
  });

  it('formats errors with raw payload passthrough', () => {
    expect(formatError(new Error('boom'))).toEqual({
      error: true,
      text: 'boom',
      raw: expect.any(Error)
    });
  });

  it('returns no result for empty formatter inputs', () => {
    expect(formatHover(null)).toBe('No result');
    expect(formatDefinition(null)).toBe('No result');
    expect(formatReferences([])).toBe('No result');
    expect(formatSymbols(null)).toBe('No result');
    expect(formatDiagnostics([], 'file')).toBe('No result');
    expect(formatCompletion(null)).toBe('No result');
    expect(formatHealth([])).toBe('No result');
  });

  it('formats multi-definition and string hover fallbacks', () => {
    expect(formatHover({ contents: 'Plain hover text' })).toBe('Plain hover text');
    expect(formatDefinition([
      {
        uri: 'file:///workspace/src/a.ts',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }
      },
      {
        uri: 'file:///workspace/src/b.ts',
        range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }
      }
    ])).toContain('Found definitions:');
  });
});
