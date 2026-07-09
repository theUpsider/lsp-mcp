import { DiagnosticStore } from '../diagnostic-store';

describe('DiagnosticStore', () => {
  it('replaces diagnostics wholesale per uri on each publish', () => {
    const store = new DiagnosticStore();
    store.store({ uri: 'file:///a.ts', diagnostics: [makeDiagnostic(1, 'first')] });
    store.store({ uri: 'file:///a.ts', diagnostics: [makeDiagnostic(2, 'second')] });

    expect(store.getForFile('/a.ts')).toEqual([
      { ...makeDiagnostic(2, 'second'), uri: 'file:///a.ts' },
    ]);
  });

  it('ignores malformed publishDiagnostics payloads', () => {
    const store = new DiagnosticStore();
    store.store(null);
    store.store({ uri: 'file:///a.ts' });
    store.store({ diagnostics: [] });

    expect(store.getForFile('/a.ts')).toEqual([]);
  });

  it('sorts workspace diagnostics by severity ascending (errors before warnings)', () => {
    const store = new DiagnosticStore();
    store.store({
      uri: 'file:///warn.ts',
      diagnostics: [makeDiagnostic(2, 'a warning')],
    });
    store.store({
      uri: 'file:///error.ts',
      diagnostics: [makeDiagnostic(1, 'an error')],
    });
    store.store({
      uri: 'file:///hint.ts',
      diagnostics: [makeDiagnostic(4, 'a hint')],
    });

    const result = store.getForWorkspace();

    expect(result.map((d) => d.message)).toEqual([
      'an error',
      'a warning',
      'a hint',
    ]);
  });

  it('filters workspace diagnostics by language extension', () => {
    const store = new DiagnosticStore();
    store.store({ uri: 'file:///a.ts', diagnostics: [makeDiagnostic(1, 'ts issue')] });
    store.store({ uri: 'file:///b.py', diagnostics: [makeDiagnostic(1, 'py issue')] });

    const result = store.getForWorkspace('python');

    expect(result).toEqual([
      { ...makeDiagnostic(1, 'py issue'), uri: 'file:///b.py' },
    ]);
  });
});

function makeDiagnostic(severity: number, message: string) {
  return {
    severity,
    message,
    range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
  };
}
