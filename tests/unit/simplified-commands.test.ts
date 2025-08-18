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
    
    // Initialize git repository for gitignore tests
    execSync('git init', { cwd: PROJECT_DIR, stdio: 'ignore' });
    
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
        `cd "${PROJECT_DIR}" && node ../../dist/index.js init --config-only`,
        { cwd: path.join(__dirname, '../..'), timeout: 5000 }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js lock --dry-run --verbose`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..'), timeout: 5000 }
      );

      // Check that sensitive files are detected
      expect(result).toContain('.env');
      expect(result).toContain('Would lock');
      // Check for the dry run summary
      expect(result).toContain('Dry run completed');
      // Only .env matches the default .ailock patterns
      expect(result).toMatch(/1 file\(s\) would be locked/);
    }, 15000);

    it('should exclude gitignore with --no-gitignore', () => {
      // Create .ailock config first  
      execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js lock --no-gitignore --dry-run --verbose`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      // With --no-gitignore, still processes files but no additional gitignore patterns
      expect(result).toContain('Would lock');
      expect(result).toContain('Dry run completed');
    });
  });

  describe('unlock command default behavior', () => {
    it('should include gitignore by default', () => {
      // Create .ailock config and lock files first
      execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js unlock --dry-run --verbose`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      // Check that unlock command works with gitignore patterns
      expect(result).toContain('.env');
      expect(result).toContain('Would unlock');
      expect(result).toContain('Dry run completed');
    });

    it('should exclude gitignore with --no-gitignore', () => {
      // Create .ailock config first
      execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js unlock --no-gitignore --dry-run --verbose`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      // With --no-gitignore, it still processes files but doesn't add gitignore patterns
      expect(result).toContain('Would unlock');
      expect(result).toContain('Dry run completed');
    });
  });

  describe('status command smart output', () => {
    it('should show simple output in non-interactive environment', () => {
      // Create .ailock config first
      execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js status`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..'), env: { ...process.env, CI: 'true' } }
      );

      // Should be simple format: Protected: X, Locked: Y, Projects: X/Y, Git: Z, Hooks: W
      expect(result).toMatch(/Protected: \d+, Locked: \d+, Projects: \d+\/\d+, Git: \w+, Hooks: \w+/);
    });

    it('should show detailed output with --verbose', () => {
      // Create .ailock config first
      execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js status --verbose`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      // Updated expectations for new dashboard format
      expect(result).toContain('AI-Lock Protection Dashboard');
      expect(result).toContain('FILE PROTECTION STATUS');
      expect(result).toContain('NEXT STEPS');
    });

    it('should show simple output with --simple', () => {
      // Create .ailock config first
      execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js init --config-only`,
        { cwd: path.join(__dirname, '../..') }
      );

      const result = execSync(
        `cd "${PROJECT_DIR}" && node ../../dist/index.js status --simple`,
        { encoding: 'utf-8', cwd: path.join(__dirname, '../..') }
      );

      expect(result).toMatch(/Protected: \d+, Locked: \d+, Projects: \d+\/\d+, Git: \w+, Hooks: \w+/);
      expect(result).not.toContain('AI-Proof File Guard Status');
    });
  });
});