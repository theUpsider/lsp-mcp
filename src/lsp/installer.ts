import { exec } from 'node:child_process';

import type { LspCandidate } from '../detection/lsp-mapping';
import { getAugmentedEnv } from '../utils/spawn-env';

export async function installLsp(candidate: LspCandidate): Promise<{ success: boolean; error?: string; instructions?: string }> {
  const command = getInstallCommand(candidate);

  if (!command) {
    return {
      success: false,
      error: `Automatic user-local install is not supported for ${candidate.mgr}`,
      instructions: getManualInstructions(candidate)
    };
  }

  return await new Promise((resolve) => {
    exec(command, { env: getAugmentedEnv() }, (error) => {
      if (error) {
        resolve({
          success: false,
          error: error.message,
          instructions: getManualInstructions(candidate)
        });
        return;
      }

      resolve({ success: true });
    });
  });
}

function getInstallCommand(candidate: LspCandidate): string | null {
  switch (candidate.mgr) {
    case 'npm':
      return process.platform === 'win32'
        ? `npm install --global ${candidate.pkg}`
        : `npm install --global --prefix "$HOME/.local" ${candidate.pkg}`;
    case 'pip':
      return `pip install --user ${candidate.pkg}`;
    case 'go':
      return `go install ${candidate.pkg}@latest`;
    case 'gem':
      return `gem install --user-install ${candidate.pkg}`;
    case 'cargo':
      return `cargo install ${candidate.pkg}`;
    default:
      return null;
  }
}

function getManualInstructions(candidate: LspCandidate): string {
  switch (candidate.mgr) {
    case 'npm':
      return `npm install -g ${candidate.pkg}`;
    case 'pip':
      return `pip install ${candidate.pkg}`;
    case 'go':
      return `go install ${candidate.pkg}@latest`;
    case 'gem':
      return `gem install ${candidate.pkg}`;
    case 'cargo':
      return `cargo install ${candidate.pkg}`;
    case 'dotnet':
      return `dotnet tool install -g ${candidate.pkg}`;
    case 'apt':
      return `sudo apt install ${candidate.pkg}`;
    case 'brew':
      return `brew install ${candidate.pkg}`;
    default:
      return `${candidate.mgr} install ${candidate.pkg}`;
  }
}
