import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface LspCandidate {
  cmd: string;
  args: string[];
  pkg: string;
  mgr: string;
}

const TYPESCRIPT_CANDIDATES: LspCandidate[] = [
  { cmd: 'typescript-language-server', args: ['--stdio'], pkg: 'typescript-language-server', mgr: 'npm' }
];

const CLANGD_CANDIDATES: LspCandidate[] = [
  { cmd: 'clangd', args: [], pkg: 'clangd', mgr: 'apt' }
];

// Linters that run alongside (not instead of) the primary language server for a
// language, so their diagnostics (e.g. ruff lint rules) show up next to the
// primary server's diagnostics (e.g. pyright type errors) instead of being lost.
const LANGUAGE_TO_LINTERS: Record<string, LspCandidate[]> = {
  python: [
    { cmd: 'ruff', args: ['server', '--quiet'], pkg: 'ruff', mgr: 'pip' }
  ]
};

const LANGUAGE_TO_CANDIDATES: Record<string, LspCandidate[]> = {
  python: [
    { cmd: 'pyright-langserver', args: ['--stdio'], pkg: 'pyright', mgr: 'npm' },
    { cmd: 'pylsp', args: [], pkg: 'python-lsp-server', mgr: 'pip' }
  ],
  typescript: TYPESCRIPT_CANDIDATES,
  javascript: TYPESCRIPT_CANDIDATES,
  csharp: [
    { cmd: 'omnisharp', args: ['-lsp'], pkg: 'omnisharp-roslyn', mgr: 'dotnet' }
  ],
  java: [
    { cmd: 'java-language-server', args: [], pkg: 'vscode-java', mgr: 'npm' },
    { cmd: 'jdtls', args: [], pkg: 'eclipse.jdt.ls', mgr: 'apt' }
  ],
  go: [
    { cmd: 'gopls', args: ['serve'], pkg: 'golang.org/x/tools/gopls', mgr: 'go' }
  ],
  rust: [
    { cmd: 'rust-analyzer', args: [], pkg: 'rust-analyzer', mgr: 'cargo' }
  ],
  c: CLANGD_CANDIDATES,
  cpp: CLANGD_CANDIDATES,
  ruby: [
    { cmd: 'solargraph', args: ['stdio'], pkg: 'solargraph', mgr: 'gem' }
  ],
  php: [
    { cmd: 'intelephense', args: ['--stdio'], pkg: 'intelephense', mgr: 'npm' }
  ],
  kotlin: [
    { cmd: 'kotlin-language-server', args: ['--stdio'], pkg: 'kotlin-language-server', mgr: 'npm' }
  ],
  swift: [
    { cmd: 'sourcekit-lsp', args: [], pkg: 'sourcekit-lsp', mgr: 'brew' }
  ]
};

export const SUPPORTED_LANGUAGES = Object.freeze([
  'python',
  'typescript',
  'javascript',
  'csharp',
  'java',
  'go',
  'rust',
  'c',
  'cpp',
  'ruby',
  'php',
  'kotlin',
  'swift'
]);

export function getLspCandidates(language: string): LspCandidate[] {
  return LANGUAGE_TO_CANDIDATES[language]?.map((candidate) => ({ ...candidate, args: [...candidate.args] })) ?? [];
}

export function getLinterCandidates(language: string): LspCandidate[] {
  return LANGUAGE_TO_LINTERS[language]?.map((candidate) => ({ ...candidate, args: [...candidate.args] })) ?? [];
}

export async function findAvailableLsp(language: string): Promise<LspCandidate | null> {
  return await findFirstAvailable(getLspCandidates(language));
}

export async function findAvailableLinter(language: string): Promise<LspCandidate | null> {
  return await findFirstAvailable(getLinterCandidates(language));
}

async function findFirstAvailable(candidates: LspCandidate[]): Promise<LspCandidate | null> {
  for (const candidate of candidates) {
    if (await commandExists(candidate.cmd)) {
      return candidate;
    }
  }

  return null;
}

async function commandExists(command: string): Promise<boolean> {
  const lookupCommand = process.platform === 'win32' ? 'where' : 'which';

  try {
    await execFileAsync(lookupCommand, [command], { env: { ...process.env } });
    return true;
  } catch {
    return false;
  }
}
