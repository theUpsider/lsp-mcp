export interface LanguageEntry {
  language: string;
  languageId: string;
}

const EXTENSION_MAP: Record<string, LanguageEntry> = {
  '.ts': { language: 'typescript', languageId: 'typescript' },
  '.tsx': { language: 'typescript', languageId: 'typescriptreact' },
  '.js': { language: 'javascript', languageId: 'javascript' },
  '.jsx': { language: 'javascript', languageId: 'javascriptreact' },
  '.py': { language: 'python', languageId: 'python' },
  '.cs': { language: 'csharp', languageId: 'csharp' },
  '.java': { language: 'java', languageId: 'java' },
  '.go': { language: 'go', languageId: 'go' },
  '.rs': { language: 'rust', languageId: 'rust' },
  '.c': { language: 'c', languageId: 'c' },
  '.h': { language: 'c', languageId: 'c' },
  '.cpp': { language: 'cpp', languageId: 'cpp' },
  '.hpp': { language: 'cpp', languageId: 'cpp' },
  '.cc': { language: 'cpp', languageId: 'cpp' },
  '.rb': { language: 'ruby', languageId: 'ruby' },
  '.php': { language: 'php', languageId: 'php' },
  '.kt': { language: 'kotlin', languageId: 'kotlin' },
  '.swift': { language: 'swift', languageId: 'swift' }
};

export function extensionToLanguage(ext: string): string | undefined {
  return EXTENSION_MAP[ext.toLowerCase()]?.language;
}

export function extensionToLanguageId(ext: string): string {
  return EXTENSION_MAP[ext.toLowerCase()]?.languageId ?? 'plaintext';
}

export function extensionsForLanguage(language: string): string[] {
  return Object.entries(EXTENSION_MAP)
    .filter(([, entry]) => entry.language === language)
    .map(([ext]) => ext);
}

export const KNOWN_EXTENSIONS: ReadonlySet<string> = new Set(Object.keys(EXTENSION_MAP));
