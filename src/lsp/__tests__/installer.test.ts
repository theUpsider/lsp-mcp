import { installLsp } from '../installer';

import type { LspCandidate } from '../../detection/lsp-mapping';

jest.mock('node:child_process', () => ({
  exec: jest.fn()
}));

describe('installLsp', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('installs npm packages into the user local prefix', async () => {
    const exec = jest.requireMock('node:child_process').exec as jest.MockedFunction<typeof import('node:child_process').exec>;
    exec.mockImplementation((...args) => {
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        callback(null, '', '');
      }

      return { on: jest.fn() } as unknown as ReturnType<typeof import('node:child_process').exec>;
    });

    const result = await installLsp({ cmd: 'typescript-language-server', args: ['--stdio'], pkg: 'typescript-language-server', mgr: 'npm' });

    expect(result).toEqual({ success: true });
    expect(exec).toHaveBeenCalledWith(
      'npm install --global --prefix "$HOME/.local" typescript-language-server',
      expect.objectContaining({ env: process.env }),
      expect.any(Function)
    );
  });

  it('installs pip packages into the user site directory', async () => {
    const exec = jest.requireMock('node:child_process').exec as jest.MockedFunction<typeof import('node:child_process').exec>;
    exec.mockImplementation((...args) => {
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        callback(null, '', '');
      }

      return { on: jest.fn() } as unknown as ReturnType<typeof import('node:child_process').exec>;
    });

    const result = await installLsp({ cmd: 'pylsp', args: [], pkg: 'python-lsp-server', mgr: 'pip' });

    expect(result).toEqual({ success: true });
    expect(exec).toHaveBeenCalledWith(
      'pip install --user python-lsp-server',
      expect.objectContaining({ env: process.env }),
      expect.any(Function)
    );
  });

  it.each<[LspCandidate, string]>([
    [{ cmd: 'gopls', args: ['serve'], pkg: 'golang.org/x/tools/gopls', mgr: 'go' }, 'go install golang.org/x/tools/gopls@latest'],
    [{ cmd: 'solargraph', args: ['stdio'], pkg: 'solargraph', mgr: 'gem' }, 'gem install --user-install solargraph'],
    [{ cmd: 'rust-analyzer', args: [], pkg: 'rust-analyzer', mgr: 'cargo' }, 'cargo install rust-analyzer']
  ])('uses a user-local install command for %s', async (candidate, expectedCommand) => {
    const exec = jest.requireMock('node:child_process').exec as jest.MockedFunction<typeof import('node:child_process').exec>;
    exec.mockImplementation((...args) => {
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        callback(null, '', '');
      }

      return { on: jest.fn() } as unknown as ReturnType<typeof import('node:child_process').exec>;
    });

    const result = await installLsp(candidate);

    expect(result).toEqual({ success: true });
    expect(exec).toHaveBeenCalledWith(
      expectedCommand,
      expect.objectContaining({ env: process.env }),
      expect.any(Function)
    );
  });

  it('returns a structured failure with manual instructions when install command fails', async () => {
    const exec = jest.requireMock('node:child_process').exec as jest.MockedFunction<typeof import('node:child_process').exec>;
    exec.mockImplementation((...args) => {
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        callback(new Error('permission denied'), '', '');
      }

      return { on: jest.fn() } as unknown as ReturnType<typeof import('node:child_process').exec>;
    });

    const result = await installLsp({ cmd: 'typescript-language-server', args: ['--stdio'], pkg: 'typescript-language-server', mgr: 'npm' });

    expect(result).toEqual({
      success: false,
      error: 'permission denied',
      instructions: 'npm install -g typescript-language-server'
    });
  });

  it('returns manual instructions for package managers without a user-local path', async () => {
    const exec = jest.requireMock('node:child_process').exec as jest.MockedFunction<typeof import('node:child_process').exec>;

    const result = await installLsp({ cmd: 'omnisharp', args: ['-lsp'], pkg: 'omnisharp-roslyn', mgr: 'dotnet' });

    expect(result).toEqual({
      success: false,
      error: 'Automatic user-local install is not supported for dotnet',
      instructions: 'dotnet tool install -g omnisharp-roslyn'
    });
    expect(exec).not.toHaveBeenCalled();
  });

  it.each([
    [{ cmd: 'clangd', args: [], pkg: 'clangd', mgr: 'apt' }, 'sudo apt install clangd'],
    [{ cmd: 'sourcekit-lsp', args: [], pkg: 'sourcekit-lsp', mgr: 'brew' }, 'brew install sourcekit-lsp'],
    [{ cmd: 'mystery-lsp', args: [], pkg: 'mystery-lsp', mgr: 'custom' }, 'custom install mystery-lsp']
  ] as const)('returns manual instructions for unsupported %s installs', async (candidate, instructions) => {
    const result = await installLsp({ ...candidate, args: [...candidate.args] });

    expect(result).toEqual({
      success: false,
      error: `Automatic user-local install is not supported for ${candidate.mgr}`,
      instructions
    });
  });

  it.each([
    [{ cmd: 'pylsp', args: [], pkg: 'python-lsp-server', mgr: 'pip' }, 'pip install python-lsp-server'],
    [{ cmd: 'gopls', args: ['serve'], pkg: 'golang.org/x/tools/gopls', mgr: 'go' }, 'go install golang.org/x/tools/gopls@latest'],
    [{ cmd: 'solargraph', args: ['stdio'], pkg: 'solargraph', mgr: 'gem' }, 'gem install solargraph'],
    [{ cmd: 'rust-analyzer', args: [], pkg: 'rust-analyzer', mgr: 'cargo' }, 'cargo install rust-analyzer']
  ] as const)('returns manager-specific manual instructions when %s install fails', async (candidate, instructions) => {
    const exec = jest.requireMock('node:child_process').exec as jest.MockedFunction<typeof import('node:child_process').exec>;
    exec.mockImplementation((...args) => {
      const callback = args[args.length - 1];
      if (typeof callback === 'function') {
        callback(new Error('network down'), '', '');
      }

      return { on: jest.fn() } as unknown as ReturnType<typeof import('node:child_process').exec>;
    });

    const result = await installLsp({ ...candidate, args: [...candidate.args] });

    expect(result).toEqual({
      success: false,
      error: 'network down',
      instructions
    });
  });
});
