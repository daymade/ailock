import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'child_process';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * `ailock list --file <path>` must agree with the full `ailock list` glob.
 *
 * The Claude hook asks about ONE file on every write, so it uses --file instead of
 * globbing the whole project. That is only safe if the two answers are the same:
 * a second, subtly different implementation of pattern semantics would silently
 * weaken (or strengthen) protection. These tests pin them together on a corpus
 * that covers the shapes most likely to diverge — dotfiles, nested paths,
 * ignored directories, spaces, case, and paths outside the project root.
 */

const CLI = path.resolve(process.cwd(), 'dist/index.js');

/**
 * ailock keeps a machine-global registry (~/.ailock/user-config.json) with a
 * 2-project free quota. Pointing HOME at a scratch dir keeps each run hermetic:
 * otherwise a stale test project from a previous run exhausts the quota, `ailock
 * lock` starts refusing, and the "just been locked" assertion fails for reasons
 * that have nothing to do with --file.
 */
const SANDBOX_HOME = mkdtempSync(path.join(tmpdir(), 'ailock-list-file-home-'));

function runJson(args: string[], cwd: string): any {
  return JSON.parse(execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HOME: SANDBOX_HOME },
  }));
}

describe('ailock list --file (single-file fast path)', () => {
  let project: string;
  let outside: string;

  // Relative paths that exercise pattern edges. Default patterns are
  // .env, .env.*, **/*.key, **/*.pem, **/secrets.json.
  const cases = [
    '.env',                    // literal dotfile pattern
    '.env.production',         // .env.* pattern
    'a.key',                   // **/*.key at root
    'sub/deep/b.pem',          // **/*.pem nested
    'secrets.json',            // root-level
    'sub/secrets.json',        // nested
    'a.txt',                   // no pattern matches
    'notakey.keys',            // near-miss extension
    'node_modules/pkg/x.key',  // ignored directory
    '.git/config.key',         // ignored directory
    '.hidden/y.key',           // dotfile directory
    'with space.key',          // space in name
    'UPPER.KEY',               // case sensitivity
    '.env.local.bak',          // .env.* prefix but different suffix
  ];

  beforeAll(() => {
    project = mkdtempSync(path.join(tmpdir(), 'ailock-list-file-'));
    for (const dir of ['sub/deep', 'node_modules/pkg', '.git', '.hidden']) {
      mkdirSync(path.join(project, dir), { recursive: true });
    }
    for (const c of cases) writeFileSync(path.join(project, c), 'x');

    outside = mkdtempSync(path.join(tmpdir(), 'ailock-outside-'));
    writeFileSync(path.join(outside, 'outside.key'), 'x');
  });

  afterAll(() => {
    rmSync(project, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
    rmSync(SANDBOX_HOME, { recursive: true, force: true });
  });

  it('reports exactly the files the full glob reports, with the same locked verdict', () => {
    // fast-glob returns symlink-resolved absolute paths; compare resolved to
    // resolved. Building the key from the unresolved project path would make
    // every /tmp project look unprotected to this assertion.
    const resolvedProject = realpathSync(project);
    const full = runJson(['list', '--json'], project);
    const byAbs = new Map<string, boolean>();
    for (const f of full.files) byAbs.set(realpathSync(path.resolve(project, f.absolutePath)), f.locked);

    for (const c of cases) {
      const abs = path.join(resolvedProject, c);
      const expectedProtected = byAbs.has(abs);
      const one = runJson(['list', '--json', '--file', abs], project);

      if (expectedProtected) {
        expect(one.files, `${c} should be reported by --file`).toHaveLength(1);
        expect(one.files[0].absolutePath).toBe(abs);
        expect(one.files[0].locked, `${c} locked verdict`).toBe(byAbs.get(abs));
      } else {
        expect(one.files, `${c} should NOT be reported by --file`).toHaveLength(0);
      }
    }
  });

  /**
   * macOS resolves /var -> /private/var. A caller can hand `--file` either
   * spelling, and `loadConfig` derives rootDir from process.cwd() — already
   * resolved. Comparing an unresolved target against a resolved root makes
   * path.relative() yield a "../.." escape, and the file is reported
   * UNPROTECTED while the full glob (cwd-anchored) says protected.
   *
   * That is a silent miss, not an error, and it hits every project under /tmp
   * — the shape the previous version of this test only ever exercised from one
   * side. Assert both spellings here so the regression cannot come back.
   */
  it('agrees with the full glob for BOTH the resolved and unresolved spelling', () => {
    const resolvedProject = realpathSync(project);
    const full = runJson(['list', '--json'], project);
    const byAbs = new Map<string, boolean>();
    for (const f of full.files) byAbs.set(realpathSync(path.resolve(project, f.absolutePath)), f.locked);

    for (const c of cases) {
      const abs = realpathSync(path.join(resolvedProject, c));
      const expectedProtected = byAbs.has(abs);
      // The unresolved spelling is what a caller holding a /var path would send.
      const unresolved = abs.replace(/^\/private/, '');

      for (const spelling of [abs, unresolved]) {
        const one = runJson(['list', '--json', '--file', spelling], project);
        if (expectedProtected) {
          expect(one.files, `${c} via ${spelling} should be reported by --file`).toHaveLength(1);
          expect(one.files[0].locked, `${c} via ${spelling} locked verdict`).toBe(byAbs.get(abs));
        } else {
          expect(one.files, `${c} via ${spelling} should NOT be reported by --file`).toHaveLength(0);
        }
      }
    }
  });

  it('never reports a path outside the project root as protected', () => {
    const abs = path.join(outside, 'outside.key');
    const one = runJson(['list', '--json', '--file', abs], project);
    expect(one.files).toHaveLength(0);
  });

  /**
   * Both paths must give the SAME locked verdict.
   *
   * This drives the verdict with chmod rather than `ailock lock` on purpose: the
   * lock state IS the owner-write bit, and `ailock lock` additionally runs the
   * project-quota/licensing gate, which refuses temp directories outright. Going
   * through it would make this test fail for a reason that has nothing to do with
   * --file. Verified: chmod 444 flips the glob's verdict to locked.
   */
  it('gives the same locked verdict as the full glob when the file becomes read-only', () => {
    const resolvedProject = realpathSync(project);
    const target = path.join(resolvedProject, 'fresh.key');
    writeFileSync(target, 'x');

    const beforeFile = runJson(['list', '--json', '--file', target], project);
    expect(beforeFile.files).toHaveLength(1);
    expect(beforeFile.files[0].locked).toBe(false);

    chmodSync(target, 0o444);
    try {
      const afterFile = runJson(['list', '--json', '--file', target], project);
      const afterFull = runJson(['list', '--json'], project);
      const fullEntry = afterFull.files.find((f: any) => realpathSync(path.resolve(project, f.absolutePath)) === target);

      expect(fullEntry, 'the full glob must still list the file').toBeTruthy();
      expect(fullEntry.locked).toBe(true);
      expect(afterFile.files).toHaveLength(1);
      expect(afterFile.files[0].locked).toBe(true);
    } finally {
      chmodSync(target, 0o644);
    }
  });

  it('honours a custom .ailock config, including its ignore list', () => {
    const custom = mkdtempSync(path.join(tmpdir(), 'ailock-list-file-custom-'));
    try {
      writeFileSync(
        path.join(custom, '.ailock'),
        ['patterns:', '  - "**/*.secret"', '  - "config/*.yml"', '  - "exact-file.txt"', 'ignore:', '  - "vendor/**"', ''].join('\n')
      );
      for (const dir of ['config', 'vendor', 'sub']) mkdirSync(path.join(custom, dir), { recursive: true });
      const files = ['a.secret', 'sub/b.secret', 'config/x.yml', 'exact-file.txt', 'vendor/c.secret', 'plain.txt'];
      for (const f of files) writeFileSync(path.join(custom, f), 'x');

      const full = runJson(['list', '--json'], custom);
      const byAbs = new Set(full.files.map((f: any) => path.resolve(custom, f.absolutePath)));

      for (const f of files) {
        const abs = path.join(custom, f);
        const one = runJson(['list', '--json', '--file', abs], custom);
        const expected = byAbs.has(abs);
        expect(one.files.length === 1, `${f}: glob says ${expected}`).toBe(expected);
      }
    } finally {
      rmSync(custom, { recursive: true, force: true });
    }
  });
});
