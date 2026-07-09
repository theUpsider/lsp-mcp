import { DiagnosticStore } from '../diagnostic-store';

describe('DiagnosticStore', () => {
  it("replaces a source's diagnostics wholesale per uri on each publish", () => {
    const store = new DiagnosticStore();
    store.store('pyright', { uri: 'file:///a.ts', diagnostics: [makeDiagnostic(1, 'first')] });
    store.store('pyright', { uri: 'file:///a.ts', diagnostics: [makeDiagnostic(2, 'second')] });

    expect(store.getForFile('/a.ts')).toEqual([
      { ...makeDiagnostic(2, 'second'), uri: 'file:///a.ts' },
    ]);
  });

  it('merges diagnostics from multiple sources for the same uri instead of overwriting', () => {
    const store = new DiagnosticStore();
    store.store('pyright', { uri: 'file:///a.py', diagnostics: [makeDiagnostic(1, 'type error')] });
    store.store('ruff', { uri: 'file:///a.py', diagnostics: [makeDiagnostic(2, 'unused import')] });

    expect(store.getForFile('/a.py')).toEqual([
      { ...makeDiagnostic(1, 'type error'), uri: 'file:///a.py' },
      { ...makeDiagnostic(2, 'unused import'), uri: 'file:///a.py' },
    ]);
  });

  it("only replaces the publishing source's diagnostics, leaving other sources intact", () => {
    const store = new DiagnosticStore();
    store.store('pyright', { uri: 'file:///a.py', diagnostics: [makeDiagnostic(1, 'type error')] });
    store.store('ruff', { uri: 'file:///a.py', diagnostics: [makeDiagnostic(2, 'unused import')] });
    store.store('ruff', { uri: 'file:///a.py', diagnostics: [] });

    expect(store.getForFile('/a.py')).toEqual([
      { ...makeDiagnostic(1, 'type error'), uri: 'file:///a.py' },
    ]);
  });

  it('ignores malformed publishDiagnostics payloads', () => {
    const store = new DiagnosticStore();
    store.store('pyright', null);
    store.store('pyright', { uri: 'file:///a.ts' });
    store.store('pyright', { diagnostics: [] });

    expect(store.getForFile('/a.ts')).toEqual([]);
  });

  it('sorts workspace diagnostics by severity ascending (errors before warnings)', () => {
    const store = new DiagnosticStore();
    store.store('pyright', {
      uri: 'file:///warn.ts',
      diagnostics: [makeDiagnostic(2, 'a warning')],
    });
    store.store('pyright', {
      uri: 'file:///error.ts',
      diagnostics: [makeDiagnostic(1, 'an error')],
    });
    store.store('pyright', {
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
    store.store('pyright', { uri: 'file:///a.ts', diagnostics: [makeDiagnostic(1, 'ts issue')] });
    store.store('pyright', { uri: 'file:///b.py', diagnostics: [makeDiagnostic(1, 'py issue')] });

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
