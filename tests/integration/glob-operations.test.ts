import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { GlobValidator } from '../../src/security/validators/GlobValidator.js';
import { loadConfig, findProtectedFiles, type AilockConfig } from '../../src/core/config.js';
import { getPlatformAdapter, type PlatformAdapter } from '../../src/core/platform.js';

describe('Glob Operations Integration', () => {
  let tempDir: string;
  let validator: GlobValidator;
  let platformAdapter: PlatformAdapter;

  beforeEach(async () => {
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ailock-glob-test-'));
    
    // Create test file structure
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'src', 'utils'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'tests'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'config'), { recursive: true });
    
    // Create test files
    await fs.writeFile(path.join(tempDir, 'src', 'index.js'), 'console.log("index");');
    await fs.writeFile(path.join(tempDir, 'src', 'main.ts'), 'export default {};');
    await fs.writeFile(path.join(tempDir, 'src', 'utils', 'helper.js'), 'module.exports = {};');
    await fs.writeFile(path.join(tempDir, 'src', 'utils', 'math.ts'), 'export const add = (a, b) => a + b;');
    await fs.writeFile(path.join(tempDir, 'tests', 'test1.spec.js'), 'test("test1", () => {});');
    await fs.writeFile(path.join(tempDir, 'tests', 'test2.spec.ts'), 'test("test2", () => {});');
    await fs.writeFile(path.join(tempDir, 'config', 'dev.json'), '{}');
    await fs.writeFile(path.join(tempDir, 'config', 'prod.json'), '{}');
    await fs.writeFile(path.join(tempDir, '.env'), 'SECRET=123');
    await fs.writeFile(path.join(tempDir, '.env.local'), 'LOCAL_SECRET=456');
    await fs.writeFile(path.join(tempDir, 'README.md'), '# Test Project');
    
    validator = new GlobValidator();
    platformAdapter = getPlatformAdapter();
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('GlobValidator with real files', () => {
    it('should find JavaScript files using glob patterns', async () => {
      const files = await validator.findMatchingFiles(['**/*.js'], { cwd: tempDir });
      
      expect(files).toHaveLength(3);
      expect(files.some(f => f.endsWith('src/index.js'))).toBe(true);
      expect(files.some(f => f.endsWith('src/utils/helper.js'))).toBe(true);
      expect(files.some(f => f.endsWith('tests/test1.spec.js'))).toBe(true);
    });

    it('should find TypeScript files using glob patterns', async () => {
      const files = await validator.findMatchingFiles(['**/*.ts'], { cwd: tempDir });
      
      expect(files).toHaveLength(3);
      expect(files.some(f => f.endsWith('src/main.ts'))).toBe(true);
      expect(files.some(f => f.endsWith('src/utils/math.ts'))).toBe(true);
      expect(files.some(f => f.endsWith('tests/test2.spec.ts'))).toBe(true);
    });

    it('should find files in specific directories', async () => {
      const files = await validator.findMatchingFiles(['src/**/*'], { cwd: tempDir });
      
      expect(files).toHaveLength(4);
      expect(files.every(f => f.includes('/src/'))).toBe(true);
    });

    it('should find files with multiple patterns', async () => {
      const files = await validator.findMatchingFiles([
        'config/*.json',
        '.env*'
      ], { cwd: tempDir });
      
      expect(files).toHaveLength(4);
      expect(files.some(f => f.endsWith('config/dev.json'))).toBe(true);
      expect(files.some(f => f.endsWith('config/prod.json'))).toBe(true);
      expect(files.some(f => f.endsWith('.env'))).toBe(true);
      expect(files.some(f => f.endsWith('.env.local'))).toBe(true);
    });

    it('should respect ignore patterns', async () => {
      const files = await validator.findMatchingFiles(['**/*.js'], {
        cwd: tempDir,
        ignore: ['**/test*.spec.js']
      });
      
      expect(files).toHaveLength(2);
      expect(files.some(f => f.endsWith('src/index.js'))).toBe(true);
      expect(files.some(f => f.endsWith('src/utils/helper.js'))).toBe(true);
      expect(files.some(f => f.endsWith('test1.spec.js'))).toBe(false);
    });
  });

  describe('Config and protection with glob patterns', () => {
    it('should load config with glob patterns and find matching files', async () => {
      // Create .ailock config file
      const configContent = `# Test config
src/**/*.js
config/*.json
.env*
`;
      await fs.writeFile(path.join(tempDir, '.ailock'), configContent);
      
      const config = await loadConfig(tempDir);
      expect(config.patterns).toContain('src/**/*.js');
      expect(config.patterns).toContain('config/*.json');
      expect(config.patterns).toContain('.env*');
      
      const files = await findProtectedFiles(config);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some(f => f.endsWith('src/index.js'))).toBe(true);
      expect(files.some(f => f.endsWith('config/dev.json'))).toBe(true);
      expect(files.some(f => f.endsWith('.env'))).toBe(true);
    });

    it('should protect files matching glob patterns', async () => {
      // Skip on Windows as file protection works differently
      if (process.platform === 'win32') {
        return;
      }

      const filePath = path.join(tempDir, 'src', 'index.js');
      
      // Lock the file
      await platformAdapter.lockFile(filePath);
      
      // Verify lock
      const isLocked = await platformAdapter.isLocked(filePath);
      expect(isLocked).toBe(true);
      
      // Unlock for cleanup
      await platformAdapter.unlockFile(filePath);
    });

    it('should handle patterns from .gitignore integration', async () => {
      // Create .gitignore file
      const gitignoreContent = `node_modules/
*.log
.env*
config/*.json
`;
      await fs.writeFile(path.join(tempDir, '.gitignore'), gitignoreContent);
      
      const patterns = validator.loadPatternsFromFile(path.join(tempDir, '.gitignore'));
      expect(patterns).toContain('node_modules/');
      expect(patterns).toContain('*.log');
      expect(patterns).toContain('.env*');
      expect(patterns).toContain('config/*.json');
    });
  });

  describe('Pattern matching edge cases', () => {
    it('should handle patterns with special characters', async () => {
      // Create files with special characters
      await fs.writeFile(path.join(tempDir, 'test-file.js'), '');
      await fs.writeFile(path.join(tempDir, 'test_file.js'), '');
      await fs.writeFile(path.join(tempDir, 'test.file.js'), '');
      
      const files = await validator.findMatchingFiles(['test*.js'], { cwd: tempDir });
      
      expect(files).toHaveLength(3);
      expect(files.some(f => f.endsWith('test-file.js'))).toBe(true);
      expect(files.some(f => f.endsWith('test_file.js'))).toBe(true);
      expect(files.some(f => f.endsWith('test.file.js'))).toBe(true);
    });

    it('should handle nested directory patterns', async () => {
      // Create deeply nested structure
      await fs.mkdir(path.join(tempDir, 'a', 'b', 'c'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'a', 'b', 'c', 'deep.txt'), 'deep content');
      
      const files = await validator.findMatchingFiles(['**/deep.txt'], { cwd: tempDir });
      
      expect(files).toHaveLength(1);
      expect(files[0]).toContain('a/b/c/deep.txt');
    });

    it('should handle dot files', async () => {
      // Create hidden files
      await fs.writeFile(path.join(tempDir, '.hidden'), 'hidden');
      await fs.writeFile(path.join(tempDir, '.config.yml'), 'config');
      
      const files = await validator.findMatchingFiles(['.*'], { cwd: tempDir });
      
      expect(files.length).toBeGreaterThanOrEqual(2);
      expect(files.some(f => f.endsWith('.hidden'))).toBe(true);
      expect(files.some(f => f.endsWith('.config.yml'))).toBe(true);
    });

    it('should expand patterns correctly', async () => {
      const expanded = await validator.expandPatterns([
        'src/*.js',
        'config',
        '*.md'
      ], tempDir);
      
      expect(expanded.some(f => f.endsWith('src/index.js'))).toBe(true);
      expect(expanded.some(f => f.endsWith('README.md'))).toBe(true);
      // 'config' is a directory, should not be included as we only match files
    });
  });

  describe('Performance with large pattern sets', () => {
    it('should handle multiple patterns efficiently', async () => {
      const patterns = [
        '**/*.js',
        '**/*.ts',
        '**/*.json',
        '**/*.md',
        '.env*',
        'config/**/*',
        'src/**/*',
        'tests/**/*'
      ];
      
      const startTime = Date.now();
      const files = await validator.findMatchingFiles(patterns, { cwd: tempDir });
      const endTime = Date.now();
      
      expect(files.length).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should deduplicate overlapping patterns', async () => {
      const patterns = [
        '**/*.js',
        'src/**/*.js',  // Overlaps with first pattern
        'src/index.js', // Specific file already covered
        '**/*'          // Matches everything
      ];
      
      const files = await validator.findMatchingFiles(patterns, { cwd: tempDir });
      
      // Check that each file appears only once
      const uniqueFiles = new Set(files);
      expect(uniqueFiles.size).toBe(files.length);
    });
  });
});