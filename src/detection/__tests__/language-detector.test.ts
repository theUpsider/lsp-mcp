import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { detectLanguages } from '../language-detector';

describe('detectLanguages', () => {
  it('detects javascript from package.json marker', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'language-detector-'));

    try {
      await writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture"}');

      await expect(detectLanguages(projectRoot)).resolves.toEqual([
        {
          language: 'javascript',
          confidence: 'marker',
          markers: ['package.json']
        }
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('detects javascript and typescript once when package.json and tsconfig.json are present', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'language-detector-'));

    try {
      await writeFile(path.join(projectRoot, 'package.json'), '{"name":"fixture"}');
      await writeFile(path.join(projectRoot, 'tsconfig.json'), '{}');

      await expect(detectLanguages(projectRoot)).resolves.toEqual([
        {
          language: 'javascript',
          confidence: 'marker',
          markers: ['package.json']
        },
        {
          language: 'typescript',
          confidence: 'marker',
          markers: ['package.json', 'tsconfig.json']
        }
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('detects marker-based languages across the supported marker files', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'language-detector-'));

    try {
      await Promise.all([
        writeFile(path.join(projectRoot, 'pyproject.toml'), '[project]'),
        writeFile(path.join(projectRoot, 'app.csproj'), '<Project />'),
        writeFile(path.join(projectRoot, 'Cargo.toml'), '[package]'),
        writeFile(path.join(projectRoot, 'go.mod'), 'module example.com/app'),
        writeFile(path.join(projectRoot, 'pom.xml'), '<project />'),
        writeFile(path.join(projectRoot, 'Gemfile'), 'source "https://rubygems.org"'),
        writeFile(path.join(projectRoot, 'composer.json'), '{}'),
        writeFile(path.join(projectRoot, 'build.gradle.kts'), ''),
        writeFile(path.join(projectRoot, 'Package.swift'), '// swift-tools-version: 5.9')
      ]);

      await expect(detectLanguages(projectRoot)).resolves.toEqual([
        { language: 'python', confidence: 'marker', markers: ['pyproject.toml'] },
        { language: 'csharp', confidence: 'marker', markers: ['app.csproj'] },
        { language: 'rust', confidence: 'marker', markers: ['Cargo.toml'] },
        { language: 'go', confidence: 'marker', markers: ['go.mod'] },
        { language: 'java', confidence: 'marker', markers: ['pom.xml'] },
        { language: 'ruby', confidence: 'marker', markers: ['Gemfile'] },
        { language: 'php', confidence: 'marker', markers: ['composer.json'] },
        { language: 'kotlin', confidence: 'marker', markers: ['build.gradle.kts'] },
        { language: 'swift', confidence: 'marker', markers: ['Package.swift'] }
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('falls back to c and cpp file extensions when no project markers exist', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'language-detector-'));

    try {
      await mkdir(path.join(projectRoot, 'src'));
      await Promise.all([
        writeFile(path.join(projectRoot, 'src', 'main.c'), 'int main(void) { return 0; }'),
        writeFile(path.join(projectRoot, 'src', 'lib.h'), '#pragma once'),
        writeFile(path.join(projectRoot, 'src', 'app.cpp'), 'int main() { return 0; }'),
        writeFile(path.join(projectRoot, 'src', 'app.hpp'), '#pragma once')
      ]);

      await expect(detectLanguages(projectRoot)).resolves.toEqual([
        { language: 'c', confidence: 'extension', markers: ['src/main.c', 'src/lib.h'] },
        { language: 'cpp', confidence: 'extension', markers: ['src/app.cpp', 'src/app.hpp'] }
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('supports alternate markers and keeps typescript de-duplicated without javascript', async () => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'language-detector-'));

    try {
      await mkdir(path.join(projectRoot, 'nested'));
      await Promise.all([
        writeFile(path.join(projectRoot, 'tsconfig.json'), '{}'),
        writeFile(path.join(projectRoot, 'setup.py'), 'print("hello")'),
        writeFile(path.join(projectRoot, 'solution.sln'), 'Project'),
        writeFile(path.join(projectRoot, 'build.gradle'), 'plugins {}'),
        writeFile(path.join(projectRoot, 'nested', 'lib.cc'), 'int main() { return 0; }')
      ]);

      await expect(detectLanguages(projectRoot)).resolves.toEqual([
        { language: 'typescript', confidence: 'marker', markers: ['tsconfig.json'] },
        { language: 'python', confidence: 'marker', markers: ['setup.py'] },
        { language: 'csharp', confidence: 'marker', markers: ['solution.sln'] },
        { language: 'java', confidence: 'marker', markers: ['build.gradle'] },
        { language: 'cpp', confidence: 'extension', markers: ['nested/lib.cc'] }
      ]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });
});
