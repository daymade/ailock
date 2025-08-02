import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import path from 'path';

const TEST_DIR = path.join(__dirname, '../../test-simplified');
const PROJECT_DIR = path.join(TEST_DIR, 'test-project');

describe('simplified command behavior', () => {
  beforeEach(() => {
    // Clean up any existing test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(PROJECT_DIR, { recursive: true });
    
    // Create test project with .gitignore
    writeFileSync(path.join(PROJECT_DIR, 'package.json'), JSON.stringify({
      name: 'test-project',
      version: '1.0.0'
    }));
    writeFileSync(path.join(PROJECT_DIR, '.env'), 'API_KEY=test-key');
    writeFileSync(path.join(PROJECT_DIR, '.gitignore'), '.env\n*.secret\nnode_modules/\n.vscode/');
    writeFileSync(path.join(PROJECT_DIR, 'app.secret'), 'secret-data');
  });

  afterEach(() => {
    // Clean up test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe('lock command default behavior', () => {
    it('should include gitignore by default', () => {
      // Create .ailock config first
      execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts lock --dry-run --verbose`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toContain('Sensitive patterns from .gitignore');
      expect(result).toContain('.env');
      expect(result).toContain('*.secret');
      expect(result).not.toContain('node_modules');
      expect(result).not.toContain('.vscode');
    });

    it('should exclude gitignore with --no-gitignore', () => {
      // Create .ailock config first
      execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts lock --no-gitignore --dry-run --verbose`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toContain('Gitignore integration: disabled (--no-gitignore)');
      expect(result).not.toContain('Sensitive patterns from .gitignore');
    });
  });

  describe('unlock command default behavior', () => {
    it('should include gitignore by default', () => {
      // Create .ailock config and lock files first
      execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts unlock --dry-run --verbose`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toContain('Sensitive patterns from .gitignore');
    });

    it('should exclude gitignore with --no-gitignore', () => {
      // Create .ailock config first
      execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts unlock --no-gitignore --dry-run --verbose`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toContain('Gitignore integration: disabled (--no-gitignore)');
    });
  });

  describe('status command smart output', () => {
    it('should show simple output in non-interactive environment', () => {
      // Create .ailock config first
      execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts status`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..'), env: { ...process.env, CI: 'true' } }
      );

      // Should be simple format: Protected: X, Locked: Y, Git: Z, Hooks: W
      expect(result).toMatch(/Protected: \d+, Locked: \d+, Git: \w+, Hooks: \w+/);
    });

    it('should show detailed output with --verbose', () => {
      // Create .ailock config first
      execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts status --verbose`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toContain('AI-Proof File Guard Status');
      expect(result).toContain('File Protection Summary');
      expect(result).toContain('Quick Actions:');
    });

    it('should show simple output with --simple', () => {
      // Create .ailock config first
      execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && npx tsx ../../src/index.ts status --simple`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toMatch(/Protected: \d+, Locked: \d+, Git: \w+, Hooks: \w+/);
      expect(result).not.toContain('AI-Proof File Guard Status');
    });
  });
});