import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getRepoStatus } from '../../../src/core/git.js';
import * as fs from 'fs';
import * as path from 'path';
import os from 'os';

describe('Status Command', () => {
  let tempDir: string;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ailock-status-test-'));
    process.chdir(tempDir);
    
    // Initialize Git repository
    const { execSync } = require('child_process');
    execSync('git init', { cwd: tempDir });
  });

  afterEach(async () => {
    // Clean up
    process.chdir('/');
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  describe('EISDIR error reproduction', () => {
    it('should handle when glob returns directories instead of files', async () => {
      // Create a directory structure that might confuse glob
      await fs.promises.mkdir(path.join(tempDir, 'dist'), { recursive: true });
      await fs.promises.mkdir(path.join(tempDir, 'node_modules'), { recursive: true });
      
      // Create a .gitignore that might match directories
      await fs.promises.writeFile(path.join(tempDir, '.gitignore'), 'dist/\nnode_modules/');
      
      // This should not throw EISDIR
      const status = await getRepoStatus(tempDir);
      
      expect(status).toBeDefined();
      expect(status.protectedFiles).toBeInstanceOf(Array);
    });

    it('should not try to check isLocked on directories', async () => {
      // Create a test directory
      await fs.promises.mkdir(path.join(tempDir, 'test-dir'), { recursive: true });
      
      // If findProtectedFiles returns a directory path, isLocked should handle it
      const { getPlatformAdapter } = await import('../../../src/core/platform.js');
      const adapter = getPlatformAdapter();
      
      // This should not throw EISDIR
      const isLocked = await adapter.isLocked(path.join(tempDir, 'test-dir'));
      
      expect(isLocked).toBe(false);
    });
  });
});