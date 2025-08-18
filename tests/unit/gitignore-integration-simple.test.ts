import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { loadConfig } from '../../src/core/config.js';

const TEST_DIR = path.join(__dirname, '../../test-gitignore-simple');
const PROJECT_DIR = path.join(TEST_DIR, 'test-project');

describe('gitignore integration simple test', () => {
  beforeEach(() => {
    // Clean up any existing test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
    mkdirSync(TEST_DIR, { recursive: true });
    mkdirSync(PROJECT_DIR, { recursive: true });
    
    // Initialize as a git repository
    const { execSync } = require('child_process');
    execSync('git init', { cwd: PROJECT_DIR });
    
    // Create test files
    writeFileSync(path.join(PROJECT_DIR, '.env'), 'API_KEY=test-key');
    writeFileSync(path.join(PROJECT_DIR, '.gitignore'), '.env\n*.secret\nnode_modules/\n.vscode/');
    writeFileSync(path.join(PROJECT_DIR, 'app.secret'), 'secret-data');
    
    // Create basic .ailock config
    writeFileSync(path.join(PROJECT_DIR, '.ailock'), '# Auto-generated config\n.env\n*.key\n');
  });

  afterEach(() => {
    // Clean up test directories
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it('should load gitignore patterns correctly', async () => {
    const config = await loadConfig(PROJECT_DIR, { includeGitignored: true });
    
    // Should include gitignore patterns when includeGitignored is true
    expect(config.patterns).toContain('.env');
    expect(config.patterns).toContain('*.secret');
    
    // Should exclude common non-sensitive patterns
    expect(config.patterns).not.toContain('node_modules/');
    expect(config.patterns).not.toContain('.vscode/');
  });

  it('should exclude gitignore when requested', async () => {
    const config = await loadConfig(PROJECT_DIR, { includeGitignored: false });
    
    // Should only have .ailock patterns when gitignore is excluded
    expect(config.patterns).toContain('.env');
    expect(config.patterns).toContain('*.key');
    
    // With includeGitignored: false, should not include gitignore-specific patterns
    expect(config.patterns).not.toContain('*.secret');
  });
});