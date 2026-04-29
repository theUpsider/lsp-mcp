import { readdir } from 'node:fs/promises';
import path from 'node:path';

export interface DetectedLanguage {
  language: string;
  confidence: 'marker' | 'extension';
  markers: string[];
}

const MARKER_DEFINITIONS: Array<{ language: string; markers: string[]; }> = [
  { language: 'javascript', markers: ['package.json'] },
  { language: 'typescript', markers: ['tsconfig.json'] },
  { language: 'python', markers: ['pyproject.toml', 'setup.py'] },
  { language: 'csharp', markers: ['.csproj', '.sln'] },
  { language: 'rust', markers: ['Cargo.toml'] },
  { language: 'go', markers: ['go.mod'] },
  { language: 'java', markers: ['pom.xml', 'build.gradle'] },
  { language: 'ruby', markers: ['Gemfile'] },
  { language: 'php', markers: ['composer.json'] },
  { language: 'kotlin', markers: ['build.gradle.kts'] },
  { language: 'swift', markers: ['Package.swift'] }
];

const EXTENSION_DEFINITIONS: Array<{ language: string; extensions: string[]; }> = [
  { language: 'c', extensions: ['.c', '.h'] },
  { language: 'cpp', extensions: ['.cpp', '.hpp', '.cc'] }
];

export async function detectLanguages(projectRoot: string): Promise<DetectedLanguage[]> {
  const entries = await collectEntries(projectRoot, projectRoot);
  const markerMatches = new Map<string, string[]>();

  for (const definition of MARKER_DEFINITIONS) {
    const matches = entries
      .filter((entry) => definition.markers.some((marker) => matchesMarker(entry.relativePath, marker)))
      .map((entry) => entry.relativePath);

    if (matches.length > 0) {
      markerMatches.set(definition.language, matches.sort());
    }
  }

  const detected: DetectedLanguage[] = [];

  if (markerMatches.has('javascript')) {
    detected.push({
      language: 'javascript',
      confidence: 'marker',
      markers: markerMatches.get('javascript') ?? []
    });
  }

  if (markerMatches.has('typescript')) {
    detected.push({
      language: 'typescript',
      confidence: 'marker',
      markers: markerMatches.has('javascript')
        ? ['package.json', ...(markerMatches.get('typescript') ?? [])]
        : (markerMatches.get('typescript') ?? [])
    });
  }

  for (const definition of MARKER_DEFINITIONS) {
    if (definition.language === 'javascript' || definition.language === 'typescript') {
      continue;
    }

    const matches = markerMatches.get(definition.language);
    if (matches && matches.length > 0) {
      detected.push({
        language: definition.language,
        confidence: 'marker',
        markers: matches
      });
    }
  }

  for (const definition of EXTENSION_DEFINITIONS) {
    const matches = entries
      .filter((entry) => definition.extensions.some((extension) => entry.relativePath.endsWith(extension)))
      .map((entry) => entry.relativePath)
      .sort((left, right) => compareByExtensionPriority(left, right, definition.extensions));

    if (matches.length > 0) {
      detected.push({
        language: definition.language,
        confidence: 'extension',
        markers: matches
      });
    }
  }

  return detected;
}

function compareByExtensionPriority(left: string, right: string, extensions: string[]): number {
  const leftIndex = extensions.findIndex((extension) => left.endsWith(extension));
  const rightIndex = extensions.findIndex((extension) => right.endsWith(extension));

  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  return left.localeCompare(right);
}

async function collectEntries(root: string, currentDir: string): Promise<Array<{ relativePath: string }>> {
  const dirents = await readdir(currentDir, { withFileTypes: true });
  const entries: Array<{ relativePath: string }> = [];

  for (const dirent of dirents) {
    const absolutePath = path.join(currentDir, dirent.name);

    if (dirent.isDirectory()) {
      entries.push(...await collectEntries(root, absolutePath));
      continue;
    }

    entries.push({
      relativePath: path.relative(root, absolutePath).split(path.sep).join('/')
    });
  }

  return entries;
}

function matchesMarker(relativePath: string, marker: string): boolean {
  return marker.startsWith('.') ? relativePath.endsWith(marker) : relativePath === marker;
}
