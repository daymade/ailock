import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { PUBLIC_GLOBAL_OPTION_WORDS } from '../../src/completion/spec.js';
import { generateBashCompletion } from '../../src/completion/templates/bash.js';
import { generateFishCompletion } from '../../src/completion/templates/fish.js';
import { generatePowerShellCompletion } from '../../src/completion/templates/powershell.js';
import { generateZshCompletion } from '../../src/completion/templates/zsh.js';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), 'tinkle_ailock-template-test-'));
  temporaryDirectories.push(directory);
  return directory;
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(directory => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe('generated template release contracts', () => {
  it('keeps public root options in the real CLI and every shell completion', () => {
    const help = execFileSync(
      process.execPath,
      [path.join(repositoryRoot, 'dist/index.js'), '--help'],
      { cwd: repositoryRoot, encoding: 'utf8' }
    );
    const scripts = [
      generateBashCompletion(),
      generateZshCompletion(),
      generateFishCompletion(),
      generatePowerShellCompletion()
    ];

    for (const option of PUBLIC_GLOBAL_OPTION_WORDS) {
      expect(help).toContain(option);
      expect(
        scripts.every(
          script =>
            script.includes(option) ||
            (option.startsWith('--') && script.includes(`-l ${option.slice(2)}`)) ||
            (/^-[^-]$/.test(option) && script.includes(`-s ${option.slice(1)}`))
        )
      ).toBe(true);
    }
  });

  it('fetches enough PR history for the generated changed-file check', async () => {
    const fixture = await temporaryDirectory();
    const remote = path.join(fixture, 'remote.git');
    const source = path.join(fixture, 'source');
    const shallow = path.join(fixture, 'shallow');
    const complete = path.join(fixture, 'complete');
    const remoteUrl = pathToFileURL(remote).href;

    git(fixture, ['init', '--bare', remote]);
    git(fixture, ['init', source]);
    git(source, ['config', 'user.name', 'AILock Template Test']);
    git(source, ['config', 'user.email', 'ailock-template@example.invalid']);
    await writeFile(path.join(source, 'base.txt'), 'base\n');
    git(source, ['add', 'base.txt']);
    git(source, ['commit', '-m', 'base']);
    git(source, ['branch', '-M', 'main']);
    git(source, ['remote', 'add', 'origin', remoteUrl]);
    git(source, ['push', '-u', 'origin', 'main']);
    git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

    git(source, ['checkout', '-b', 'feature']);
    await writeFile(path.join(source, 'feature.txt'), 'feature\n');
    git(source, ['add', 'feature.txt']);
    git(source, ['commit', '-m', 'feature']);
    git(source, ['push', '-u', 'origin', 'feature']);

    git(fixture, ['clone', '--depth', '1', '--single-branch', '--branch', 'feature', remoteUrl, shallow]);
    const shallowDiff = spawnSync('git', ['diff', '--name-only', 'origin/main...HEAD'], {
      cwd: shallow,
      encoding: 'utf8'
    });
    expect(shallowDiff.status).not.toBe(0);

    git(fixture, ['clone', remoteUrl, complete]);
    git(complete, ['checkout', 'feature']);
    expect(git(complete, ['diff', '--name-only', 'origin/main...HEAD'])).toBe('feature.txt');

    const template = await readFile(
      path.join(repositoryRoot, 'src/templates/ci-cd/github-actions.yml'),
      'utf8'
    );
    expect(template).toContain('fetch-depth: 0');
    expect(template).not.toMatch(/^\s*cache:\s*['"]?npm['"]?\s*$/m);
  });

  it('keeps machine-readable artifacts honest and generated container syntax explicit', async () => {
    const gitlab = await readFile(
      path.join(repositoryRoot, 'src/templates/ci-cd/gitlab-ci.yml'),
      'utf8'
    );
    const dockerfile = await readFile(
      path.join(repositoryRoot, 'src/templates/docker/Dockerfile.prod'),
      'utf8'
    );
    const devcontainer = await readFile(
      path.join(repositoryRoot, 'src/templates/devcontainer/devcontainer.json'),
      'utf8'
    );
    const devcontainerSetup = await readFile(
      path.join(repositoryRoot, 'src/templates/devcontainer/setup.sh'),
      'utf8'
    );

    expect(gitlab).not.toMatch(/reports:\s*\n\s+junit:\s+ailock-status[.]json/);
    expect(dockerfile).not.toMatch(/^COPY .*\|\|/m);
    expect(dockerfile).toContain('.ailock configuration is required');
    expect(dockerfile).toContain('ailock list --json');
    expect(dockerfile).not.toContain('--unlocked-only');
    expect(dockerfile).not.toContain('status --json --skip-analytics');
    expect(devcontainer).toContain('typescript-node:24-bookworm');
    expect(devcontainer).toContain('ailock list --json > /dev/null');
    expect(devcontainer).toContain('"setup-git": [');
    expect(devcontainer).toContain('"${containerWorkspaceFolder}"');
    for (const optionalSource of ['.ailock', 'config', 'secrets', '.env', '.env.local']) {
      expect(devcontainer).not.toContain(
        `source=\${localWorkspaceFolder}/${optionalSource}`
      );
    }
    expect(devcontainer).not.toContain(
      '"setup-git": "git config --global --add safe.directory'
    );
    expect(devcontainerSetup).toContain('ailock list --json');
    expect(devcontainerSetup).toContain('[ -w "$TINKLE_PROTECTED_FILE" ]');
    expect(devcontainerSetup).not.toContain('status --skip-analytics');
  });
});
