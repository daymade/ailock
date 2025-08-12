import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GlobValidator } from '../../../../src/security/validators/GlobValidator.js';
import * as fs from 'fs';
import * as path from 'path';
import { vol } from 'memfs';

vi.mock('fs');
vi.mock('fast-glob');

describe('GlobValidator', () => {
  let validator: GlobValidator;

  beforeEach(() => {
    validator = new GlobValidator();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateGlobPattern', () => {
    it('should accept valid glob patterns', () => {
      expect(() => validator.validateGlobPattern('*.js')).not.toThrow();
      expect(() => validator.validateGlobPattern('src/**/*.ts')).not.toThrow();
      expect(() => validator.validateGlobPattern('test-[0-9].txt')).not.toThrow();
    });

    it('should reject empty or invalid patterns', () => {
      expect(() => validator.validateGlobPattern('')).toThrow('Pattern must be a non-empty string');
      expect(() => validator.validateGlobPattern(null as any)).toThrow('Pattern must be a non-empty string');
      expect(() => validator.validateGlobPattern(undefined as any)).toThrow('Pattern must be a non-empty string');
    });

    it('should reject patterns that are too long', () => {
      const longPattern = 'a'.repeat(1025);
      expect(() => validator.validateGlobPattern(longPattern)).toThrow('Pattern exceeds maximum length');
    });

    it('should reject negation patterns', () => {
      expect(() => validator.validateGlobPattern('!node_modules')).toThrow('Negation patterns are not supported');
    });

    it('should warn about dangerous patterns', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      validator.validateGlobPattern('/**/*');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('may match a large number of files'));
      
      validator.validateGlobPattern('**/**');
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('may match a large number of files'));
      
      consoleSpy.mockRestore();
    });
  });

  describe('findMatchingFiles', () => {
    it('should find files matching glob patterns', async () => {
      const glob = await import('fast-glob');
      vi.mocked(glob.default).mockResolvedValue(['file1.js', 'file2.js']);

      const result = await validator.findMatchingFiles(['*.js']);
      
      expect(result).toContain('file1.js');
      expect(result).toContain('file2.js');
      expect(glob.default).toHaveBeenCalledWith('*.js', expect.objectContaining({
        absolute: true,
        dot: true,
        onlyFiles: true,
      }));
    });

    it('should handle multiple patterns', async () => {
      const glob = await import('fast-glob');
      vi.mocked(glob.default)
        .mockResolvedValueOnce(['file1.js'])
        .mockResolvedValueOnce(['file2.ts']);

      const result = await validator.findMatchingFiles(['*.js', '*.ts']);
      
      expect(result).toHaveLength(2);
      expect(result).toContain('file1.js');
      expect(result).toContain('file2.ts');
    });

    it('should deduplicate matching files', async () => {
      const glob = await import('fast-glob');
      vi.mocked(glob.default)
        .mockResolvedValueOnce(['file1.js', 'file2.js'])
        .mockResolvedValueOnce(['file2.js', 'file3.js']);

      const result = await validator.findMatchingFiles(['*.js', 'file*.js']);
      
      expect(result).toHaveLength(3);
      expect(result).toContain('file1.js');
      expect(result).toContain('file2.js');
      expect(result).toContain('file3.js');
    });

    it('should handle glob errors gracefully', async () => {
      const glob = await import('fast-glob');
      vi.mocked(glob.default).mockRejectedValue(new Error('Glob error'));
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const result = await validator.findMatchingFiles(['*.js']);
      
      expect(result).toHaveLength(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to match pattern'));
      
      consoleSpy.mockRestore();
    });

    it('should respect ignore patterns', async () => {
      const glob = await import('fast-glob');
      vi.mocked(glob.default).mockResolvedValue(['file1.js']);

      await validator.findMatchingFiles(['*.js'], { ignore: ['node_modules/**'] });
      
      expect(glob.default).toHaveBeenCalledWith('*.js', expect.objectContaining({
        ignore: ['node_modules/**'],
      }));
    });
  });

  describe('createIgnoreFilter', () => {
    it('should create a filter that excludes ignored paths', () => {
      const filter = validator.createIgnoreFilter(['node_modules', '*.log']);
      
      expect(filter('src/index.js')).toBe(true);
      expect(filter('node_modules/package/index.js')).toBe(false);
      expect(filter('debug.log')).toBe(false);
    });

    it('should ignore comment lines', () => {
      const filter = validator.createIgnoreFilter(['# comment', 'node_modules', '']);
      
      expect(filter('node_modules/index.js')).toBe(false);
      expect(filter('src/index.js')).toBe(true);
    });

    it('should handle empty patterns array', () => {
      const filter = validator.createIgnoreFilter([]);
      
      expect(filter('any/file.js')).toBe(true);
    });
  });

  describe('loadPatternsFromFile', () => {
    it('should load patterns from a file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('*.log\n# comment\nnode_modules\n  \n*.tmp');
      
      const patterns = validator.loadPatternsFromFile('.gitignore');
      
      expect(patterns).toEqual(['*.log', 'node_modules', '*.tmp']);
    });

    it('should return empty array if file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      
      const patterns = validator.loadPatternsFromFile('.gitignore');
      
      expect(patterns).toEqual([]);
      expect(fs.readFileSync).not.toHaveBeenCalled();
    });

    it('should handle file read errors gracefully', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Read error');
      });
      
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      const patterns = validator.loadPatternsFromFile('.gitignore');
      
      expect(patterns).toEqual([]);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load patterns'));
      
      consoleSpy.mockRestore();
    });
  });

  describe('matchesPattern', () => {
    const originalCwd = process.cwd();
    
    beforeEach(() => {
      vi.spyOn(process, 'cwd').mockReturnValue('/project');
    });

    afterEach(() => {
      vi.spyOn(process, 'cwd').mockReturnValue(originalCwd);
    });

    it('should match exact file paths', () => {
      expect(validator.matchesPattern('/project/src/index.js', ['src/index.js'])).toBe(true);
      expect(validator.matchesPattern('/project/src/index.js', ['src/other.js'])).toBe(false);
    });

    it('should match directory prefixes', () => {
      expect(validator.matchesPattern('/project/src/utils/helper.js', ['src'])).toBe(true);
      expect(validator.matchesPattern('/project/src/utils/helper.js', ['lib'])).toBe(false);
    });

    it('should match glob patterns with wildcards', () => {
      expect(validator.matchesPattern('/project/src/index.js', ['src/index.js'])).toBe(true); // Exact match
      expect(validator.matchesPattern('/project/src/index.js', ['src/*.js'])).toBe(true);
      expect(validator.matchesPattern('/project/src/utils/helper.js', ['src/*.js'])).toBe(true); // .* matches everything including /
      expect(validator.matchesPattern('/project/src/index.js', ['src/index.*'])).toBe(true); // Matches any extension
    });

    it('should match patterns with ? wildcard', () => {
      expect(validator.matchesPattern('/project/test1.txt', ['test?.txt'])).toBe(true); // ? becomes . in regex
      expect(validator.matchesPattern('/project/test12.txt', ['test?.txt'])).toBe(false);
    });

    it('should return false if no patterns match', () => {
      expect(validator.matchesPattern('/project/src/index.js', ['*.py', '*.rb'])).toBe(false);
    });
  });

  describe('expandPatterns', () => {
    it('should expand glob patterns to file paths', async () => {
      const glob = await import('fast-glob');
      vi.mocked(glob.default).mockResolvedValue(['/project/file1.js', '/project/file2.js']);
      
      const result = await validator.expandPatterns(['*.js'], '/project');
      
      expect(result).toContain('/project/file1.js');
      expect(result).toContain('/project/file2.js');
    });

    it('should handle direct file paths', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      
      const result = await validator.expandPatterns(['src/index.js'], '/project');
      
      expect(result).toContain('/project/src/index.js');
    });

    it('should handle absolute paths', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      
      const result = await validator.expandPatterns(['/absolute/path/file.js']);
      
      expect(result).toContain('/absolute/path/file.js');
    });

    it('should skip non-existent direct paths', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      
      const result = await validator.expandPatterns(['nonexistent.js'], '/project');
      
      expect(result).toHaveLength(0);
    });

    it('should handle mixed patterns and direct paths', async () => {
      const glob = await import('fast-glob');
      vi.mocked(glob.default).mockResolvedValue(['/project/glob1.js', '/project/glob2.js']);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      
      const result = await validator.expandPatterns(['*.js', 'direct.txt'], '/project');
      
      expect(result).toContain('/project/glob1.js');
      expect(result).toContain('/project/glob2.js');
      expect(result).toContain('/project/direct.txt');
    });
  });
});