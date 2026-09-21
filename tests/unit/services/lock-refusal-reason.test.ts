import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync, chmodSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

/**
 * `ailock lock` refuses a file for two unrelated reasons, and it used to report
 * both as "Quota exceeded".
 *
 * Measured 2026-09-21 with a brand-new config: locking a file under /tmp
 * printed "🚫 Quota exceeded for: <path>" followed by "Current quota: No
 * projects protected yet (0/2 quota used)" — the same run told you the quota
 * was full and that nothing was using it. The real reason was that a temp
 * directory is not a legitimate project root, which is a different answer with
 * a different fix (run from a real project, not buy capacity).
 *
 * These tests pin the two apart. HOME is isolated per run so the machine-global
 * ~/.ailock/user-config.json quota cannot leak in either direction.
 */

const CLI = path.resolve(process.cwd(), 'dist/index.js');
const SANDBOX_HOME = mkdtempSync(path.join(tmpdir(), 'ailock-lockmsg-home-'));

function run(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  // spawnSync, not execFileSync: a refused lock exits 0 (it is a normal business
  // outcome, not an error), so execFileSync's return value carries stdout only
  // and the warn()/error() lines — which is where every reason is printed —
  // would be dropped.
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: SANDBOX_HOME },
  });
  return {
    stdout: r.stdout?.toString() ?? '',
    stderr: r.stderr?.toString() ?? '',
    status: r.status ?? 1,
  };
}

/** A path ailock refuses because it is not a legitimate project root. */
function tempProject() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ailock-lockmsg-tmp-'));
  writeFileSync(path.join(dir, 'a.key'), 'x');
  return dir;
}

/**
 * A path ailock accepts as a project root. filterTempDirectories() drops every
 * /var/folders/ path whose name does not contain "ailock-test", so on macOS the
 * directory name has to carry that marker for the quota path to be reachable at
 * all — otherwise every run is refused for the temp-directory reason and the
 * quota branch can never be exercised.
 */
function realProject() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ailock-test-proj-'));
  writeFileSync(path.join(dir, 'a.key'), 'x');
  return dir;
}

/**
 * `ailock lock` chmods files to 0444, and macOS refuses to unlink a read-only
 * file without an interactive prompt. rmSync({force:true}) swallows the EACCES
 * and then fails the rmdir with a misleading ENOTEMPTY, so restore the write
 * bit before removing. Walks the tree directly rather than shelling out.
 */
function makeWritable(dir: string): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) makeWritable(full);
    else {
      try { chmodSync(full, 0o644); } catch { /* already gone */ }
    }
  }
  try { chmodSync(dir, 0o700); } catch { /* already gone */ }
}

/**
 * `ailock lock` sets the user-immutable flag (uchg) as well as mode 0444, and
 * macOS refuses to unlink OR chmod an immutable file without an interactive
 * prompt. rmSync({force:true}) swallows the resulting EACCES and then fails the
 * rmdir with a misleading ENOTEMPTY, so clear the flag first. Node exposes no
 * chflags API, hence the subprocess; on a platform without chflags it simply
 * fails and the rest of the cleanup still runs.
 */
function cleanup(dir: string): void {
  spawnSync('chflags', ['-R', 'nouchg', dir], { stdio: 'ignore' });
  makeWritable(dir);
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
}

describe('ailock lock reports WHY a file was refused', () => {
  beforeAll(() => {
    mkdirSync(SANDBOX_HOME, { recursive: true });
    // A genuine quota wall fires the conversion-analytics call, which is a
    // network round trip. Measured 2026-09-21: with analytics on, the second
    // test below took 37s waiting on it; with analytics off, 0.4s. The call is
    // not what either test is about, so keep it out of the way.
    mkdirSync(path.join(SANDBOX_HOME, '.ailock'), { recursive: true });
    writeFileSync(
      path.join(SANDBOX_HOME, '.ailock', 'user-config.json'),
      JSON.stringify({
        projectQuota: 2,
        protectedProjects: [],
        directoryQuota: 2,
        lockedDirectories: [],
        analyticsEnabled: false,
        offlineMode: false,
        version: '2.0.0',
        privacyLevel: 'standard',
        telemetryOptOut: true,
        hasAcceptedPrivacyPolicy: true,
      }),
    );
  });
  afterAll(() => { cleanup(SANDBOX_HOME); });

  it('does not call a refused temp path a quota problem', () => {
    const dir = tempProject();
    try {
      const out = run(['lock', path.join(dir, 'a.key')], dir);
      const text = out.stdout + out.stderr;

      // The quota framing must be absent — this run has 0 of 2 projects used.
      expect(text).not.toContain('Quota exceeded');
      expect(text).not.toContain('Current quota');
      expect(text).not.toContain('auth code');

      // ...and the real reason must be present.
      expect(text.toLowerCase()).toContain('temporary or system director');
    } finally {
      cleanup(dir);
    }
  });

  it('still reports a genuine quota wall as a quota problem', () => {
    // Exhaust the 2-project free tier inside the sandbox so the refusal really
    // is about quota, then lock a third project's file.
    const first = realProject();
    const second = realProject();
    const third = realProject();
    try {
      for (const dir of [first, second]) {
        writeFileSync(path.join(dir, 'seed.key'), 'x');
        run(['lock', path.join(dir, 'seed.key')], dir);
      }
      const target = path.join(third, 'a.key');
      const out = run(['lock', target], third);
      const text = out.stdout + out.stderr;

      expect(text).toContain('Quota exceeded');
      expect(text).toContain('Current quota');
      expect(text.toLowerCase()).not.toContain('temporary or system director');
    } finally {
      for (const dir of [first, second, third]) cleanup(dir);
    }
  });
});
