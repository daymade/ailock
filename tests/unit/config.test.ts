import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseAilockContent, loadConfig, findProtectedFiles } from '../../src/core/config.js';

describe('Configuration Parser', () => {
  describe('parseAilockContent', () => {
    it('should parse basic patterns', () => {
      const content = `.env
.env.*
config/*.json`;
      
      const patterns = parseAilockContent(content);
      expect(patterns).toEqual(['.env', '.env.*', 'config/*.json']);
    });

    it('should ignore comments and empty lines', () => {
      const content = `# This is a comment
.env

# Another comment
.env.*

config/*.json`;
      
      const patterns = parseAilockContent(content);
      expect(patterns).toEqual(['.env', '.env.*', 'config/*.json']);
    });

    it('should ignore negation patterns for now', () => {
      const content = `.env
!.env.example
config/*.json`;
      
      const patterns = parseAilockContent(content);
      expect(patterns).toEqual(['.env', 'config/*.json']);
    });

    it('should handle whitespace correctly', () => {
      const content = `  .env  
    config/*.json    
  `;
      
      const patterns = parseAilockContent(content);
      expect(patterns).toEqual(['.env', 'config/*.json']);
    });
  });

  describe('loadConfig', () => {
    let tempDir: string;
    
    beforeEach(async () => {
      tempDir = join(tmpdir(), `ailock-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should load configuration from .ailock file', async () => {
      const ailockContent = `.env
config/*.json`;
      
      await writeFile(join(tempDir, '.ailock'), ailockContent);
      
      const config = await loadConfig(tempDir);
      expect(config.patterns).toEqual(['.env', 'config/*.json']);
      expect(config.rootDir).toBe(tempDir);
    });

    it('should return default configuration when no .ailock file exists', async () => {
      const config = await loadConfig(tempDir);
      
      expect(config.patterns).toEqual([
        '.env', 
        '.env.*', 
        '**/*.key', 
        '**/*.pem', 
        '**/secrets.json'
      ]);
      expect(config.rootDir).toBe(tempDir);
    });

    it('should find .ailock file in parent directories', async () => {
      const subDir = join(tempDir, 'sub', 'dir');
      await mkdir(subDir, { recursive: true });
      
      const ailockContent = `.env
parent-config.json`;
      
      await writeFile(join(tempDir, '.ailock'), ailockContent);
      
      const config = await loadConfig(subDir);
      expect(config.patterns).toEqual(['.env', 'parent-config.json']);
      expect(config.rootDir).toBe(tempDir);
    });
  });

  describe('findProtectedFiles', () => {
    let tempDir: string;
    
    beforeEach(async () => {
      tempDir = join(tmpdir(), `ailock-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should find files matching patterns', async () => {
      // Create test files
      await writeFile(join(tempDir, '.env'), 'test');
      await writeFile(join(tempDir, '.env.local'), 'test');
      await writeFile(join(tempDir, 'config.json'), 'test');
      
      await mkdir(join(tempDir, 'config'), { recursive: true });
      await writeFile(join(tempDir, 'config', 'app.json'), 'test');
      
      const config = {
        patterns: ['.env*', 'config/*.json'],
        rootDir: tempDir
      };
      
      const files = await findProtectedFiles(config);
      const relativeFiles = files.map(f => f.replace(tempDir + '/', ''));
      
      expect(relativeFiles).toContain('.env');
      expect(relativeFiles).toContain('.env.local');
      expect(relativeFiles).toContain('config/app.json');
      expect(relativeFiles).not.toContain('config.json'); // Doesn't match pattern
    });

    it('should return empty array for empty patterns', async () => {
      const config = {
        patterns: [],
        rootDir: tempDir
      };
      
      const files = await findProtectedFiles(config);
      expect(files).toEqual([]);
    });

    it('should ignore node_modules and .git directories', async () => {
      await mkdir(join(tempDir, 'node_modules'), { recursive: true });
      await mkdir(join(tempDir, '.git'), { recursive: true });
      
      await writeFile(join(tempDir, 'node_modules', '.env'), 'test');
      await writeFile(join(tempDir, '.git', '.env'), 'test');
      await writeFile(join(tempDir, '.env'), 'test');
      
      const config = {
        patterns: ['.env'],
        rootDir: tempDir
      };
      
      const files = await findProtectedFiles(config);
      expect(files).toHaveLength(1);
      expect(files[0]).toBe(join(tempDir, '.env'));
    });
  });
});