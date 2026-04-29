import { pathToUri, uriToPath } from '../uri';

describe('uri utilities', () => {
  it('converts an absolute posix path to a file URI', () => {
    expect(pathToUri('/home/user/foo.ts')).toBe('file:///home/user/foo.ts');
  });

  it('round-trips posix paths with spaces', () => {
    const uri = pathToUri('/home/user/My Project/foo bar.ts');

    expect(uri).toBe('file:///home/user/My%20Project/foo%20bar.ts');
    expect(uriToPath(uri)).toBe('/home/user/My Project/foo bar.ts');
  });

  it('returns file URIs unchanged and rejects relative paths', () => {
    expect(pathToUri('file:///home/user/foo.ts')).toBe('file:///home/user/foo.ts');
    expect(() => pathToUri('src/foo.ts')).toThrow('Expected an absolute file path');
  });

  it('handles windows drive paths in both directions', () => {
    expect(pathToUri('C:\\work\\foo bar.ts')).toBe('file:///C:/work/foo%20bar.ts');
    expect(uriToPath('file:///C:/work/foo%20bar.ts')).toBe('C:\\work\\foo bar.ts');
  });
});
