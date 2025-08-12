import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findAilockFile, findGitignoreFile, loadConfig } from '../../src/core/config.js';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';

describe('Config - Directory vs File Bug', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ailock-dir-bug-test-'));
    process.chdir(tempDir);
  });

  afterEach(async () => {
    // Clean up
    process.chdir('/');
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('findAilockFile', () => {
    it('should ignore .ailock if it is a directory', async () => {
      // Create .ailock as a directory
      await fs.promises.mkdir(path.join(tempDir, '.ailock'));
      
      // findAilockFile should return null since .ailock is a directory
      const result = await findAilockFile(tempDir);
      expect(result).toBeNull();
    });

    it('should find .ailock if it is a file', async () => {
      // Create .ailock as a file
      await fs.promises.writeFile(path.join(tempDir, '.ailock'), '*.env');
      
      // findAilockFile should find the file
      const result = await findAilockFile(tempDir);
      expect(result).toBe(path.join(tempDir, '.ailock'));
    });

    it('should skip directory and find file in parent', async () => {
      // Create subdirectory
      const subDir = path.join(tempDir, 'subdir');
      await fs.promises.mkdir(subDir);
      
      // Create .ailock as directory in subdir
      await fs.promises.mkdir(path.join(subDir, '.ailock'));
      
      // Create .ailock as file in parent
      await fs.promises.writeFile(path.join(tempDir, '.ailock'), '*.env');
      
      // Should find the file in parent, not the directory in subdir
      const result = await findAilockFile(subDir);
      expect(result).toBe(path.join(tempDir, '.ailock'));
    });
  });

  describe('findGitignoreFile', () => {
    it('should ignore .gitignore if it is a directory', async () => {
      // Initialize git repo
      await fs.promises.mkdir(path.join(tempDir, '.git'));
      
      // Create .gitignore as a directory
      await fs.promises.mkdir(path.join(tempDir, '.gitignore'));
      
      // findGitignoreFile should return null since .gitignore is a directory
      const result = await findGitignoreFile(tempDir);
      expect(result).toBeNull();
    });

    it('should find .gitignore if it is a file', async () => {
      // Initialize as a real git repo
      const { execSync } = require('child_process');
      execSync('git init', { cwd: tempDir });
      
      // Create .gitignore as a file
      await fs.promises.writeFile(path.join(tempDir, '.gitignore'), 'node_modules/');
      
      // findGitignoreFile should find the file
      const result = await findGitignoreFile(tempDir);
      expect(result).toBeTruthy();
      expect(result).toContain('.gitignore');
    });
  });

  describe('loadConfig', () => {
    it('should not throw EISDIR when .ailock is a directory', async () => {
      // Create .ailock as a directory
      await fs.promises.mkdir(path.join(tempDir, '.ailock'));
      
      // loadConfig should not throw and should return default config
      const config = await loadConfig(tempDir);
      
      expect(config).toBeDefined();
      expect(config.patterns).toContain('.env');
      expect(config.patterns).toContain('.env.*');
    });

    it('should load config from .ailock file correctly', async () => {
      // Create .ailock as a file
      const patterns = '*.env\n*.key\n# Comment\n*.pem';
      await fs.promises.writeFile(path.join(tempDir, '.ailock'), patterns);
      
      // loadConfig should load the patterns
      const config = await loadConfig(tempDir);
      
      expect(config).toBeDefined();
      expect(config.patterns).toContain('*.env');
      expect(config.patterns).toContain('*.key');
      expect(config.patterns).toContain('*.pem');
      expect(config.patterns).not.toContain('# Comment');
    });
  });

  describe('Real-world scenario', () => {
    it('should handle user home directory with .ailock directory', async () => {
      // Simulate the scenario where user has ~/.ailock/ directory
      // Create a parent directory with .ailock as directory
      const parentDir = path.join(tempDir, 'parent');
      await fs.promises.mkdir(parentDir);
      await fs.promises.mkdir(path.join(parentDir, '.ailock'));
      
      // Create project directory
      const projectDir = path.join(parentDir, 'project');
      await fs.promises.mkdir(projectDir);
      
      // Change to project directory
      process.chdir(projectDir);
      
      // This should not throw EISDIR
      const config = await loadConfig(projectDir);
      
      expect(config).toBeDefined();
      expect(config.patterns).toBeInstanceOf(Array);
    });
  });
});