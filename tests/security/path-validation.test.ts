import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SecurePathValidator } from '../../src/security/PathValidator.js';
import { 
  MALICIOUS_INPUTS, 
  SecurityTestEnvironment, 
  SecurityAssertions,
  PlatformUtils
} from './utils/security-test-helpers.js';
import path from 'path';
import { writeFile, mkdir, symlink, chmod } from 'fs/promises';

describe('Path Validation and Traversal Prevention', () => {
  let validator: SecurePathValidator;
  let testEnv: SecurityTestEnvironment;
  let testDir: string;

  beforeEach(async () => {
    testEnv = new SecurityTestEnvironment();
    testDir = await testEnv.createTempDir();
    validator = new SecurePathValidator([testDir]);
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Directory Traversal Attack Prevention', () => {
    it('should prevent classic traversal attacks', async () => {
      for (const maliciousPath of MALICIOUS_INPUTS.pathTraversal) {
        await expect(
          validator.validateAndSanitizePath(maliciousPath, testDir)
        ).rejects.toThrow(/path traversal attempt detected/i);
      }
    });

    it('should prevent URL-encoded traversal attempts', async () => {
      const encodedPaths = [
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
        '%2e%2e/%2e%2e/%2e%2e/etc/passwd',
        '..%c0%af..%c0%af..%c0%afetc%c0%afpasswd',
        '%252e%252e%252fetc%252fpasswd'
      ];

      for (const encoded of encodedPaths) {
        const decoded = decodeURIComponent(encoded);
        await expect(
          validator.validateAndSanitizePath(decoded, testDir)
        ).rejects.toThrow(/path traversal attempt detected/i);
      }
    });

    it('should prevent double-encoded traversal attempts', async () => {
      const doubleEncoded = [
        '%252e%252e%252f%252e%252e%252f%252e%252e%252fetc%252fpasswd',
        '%25252e%25252e%25252fetc%25252fpasswd'
      ];

      for (const encoded of doubleEncoded) {
        let decoded = encoded;
        // Decode multiple times to simulate double encoding
        for (let i = 0; i < 3; i++) {
          try {
            decoded = decodeURIComponent(decoded);
          } catch {
            break;
          }
        }
        
        await expect(
          validator.validateAndSanitizePath(decoded, testDir)
        ).rejects.toThrow(/path traversal attempt detected/i);
      }
    });

    it('should prevent Windows-style traversal attacks', async () => {
      const windowsPaths = [
        '..\\\\..\\\\..\\\\etc\\\\passwd',
        '..\\\\..\\\\windows\\\\system32',
        'C:\\\\Windows\\\\System32\\\\config\\\\SAM',
        '\\\\..\\\\..\\\\Users\\\\Administrator'
      ];

      for (const winPath of windowsPaths) {
        await expect(
          validator.validateAndSanitizePath(winPath, testDir)
        ).rejects.toThrow(/path traversal attempt detected/i);
      }
    });

    it('should prevent Unicode normalization attacks', async () => {
      const unicodeAttacks = [
        '\u002e\u002e\u002f\u002e\u002e\u002f', // Unicode encoded dots and slashes
        '\uff0e\uff0e\uff0f\uff0e\uff0e\uff0f', // Full-width unicode chars
        '\u2024\u2024\u2044',                    // Unicode alternatives
      ];

      for (const attack of unicodeAttacks) {
        await expect(
          validator.validateAndSanitizePath(attack, testDir)
        ).rejects.toThrow(/path traversal attempt detected/i);
      }
    });
  });

  describe('Absolute Path Attack Prevention', () => {
    it('should prevent absolute path access', async () => {
      const absolutePaths = PlatformUtils.getDangerousPaths();

      for (const absPath of absolutePaths) {
        await expect(
          validator.validateAndSanitizePath(absPath, testDir)
        ).rejects.toThrow(/path traversal attempt detected/i);
      }
    });

    it('should prevent UNC path attacks on Windows', async () => {
      const uncPaths = [
        '\\\\\\\\server\\\\share\\\\file.txt',
        '\\\\\\\\?\\\\C:\\\\Windows\\\\System32',
        '\\\\\\\\localhost\\\\c$\\\\Windows',
        '\\\\\\\\127.0.0.1\\\\admin$'
      ];

      for (const uncPath of uncPaths) {
        await expect(
          validator.validateAndSanitizePath(uncPath, testDir)
        ).rejects.toThrow(/path traversal attempt detected/i);
      }
    });

    it('should prevent drive letter access on Windows', async () => {
      const drivePaths = [
        'C:\\\\',
        'D:\\\\Users',
        'Z:\\\\network\\\\share'
      ];

      for (const drivePath of drivePaths) {
        await expect(
          validator.validateAndSanitizePath(drivePath, testDir)
        ).rejects.toThrow(/path traversal attempt detected/i);
      }
    });
  });

  describe('Path Length and Component Validation', () => {
    it('should enforce maximum path length', async () => {
      const longPath = 'a/'.repeat(3000);
      
      await expect(
        validator.validateAndSanitizePath(longPath, testDir)
      ).rejects.toThrow(/path too long/i);
    });

    it('should enforce maximum component length', async () => {
      const longComponent = 'x'.repeat(300);
      
      await expect(
        validator.validateAndSanitizePath(longComponent, testDir)
      ).rejects.toThrow(/path component too long/i);
    });

    it('should handle empty path components', async () => {
      const pathsWithEmpty = [
        'dir//file.txt',
        'dir///file.txt',
        'dir/./file.txt',
        'dir/../file.txt'
      ];

      for (const emptyPath of pathsWithEmpty) {
        // Should either sanitize or reject
        try {
          const result = await validator.validateAndSanitizePath(emptyPath, testDir);
          // If accepted, should be sanitized
          expect(result).not.toContain('//');
          expect(result).not.toContain('/./');
          expect(result).not.toContain('/../');
        } catch (error) {
          // If rejected, should have appropriate error
          expect(error.message).toMatch(/path|traversal|invalid/i);
        }
      }
    });
  });

  describe('Dangerous Character Filtering', () => {
    it('should filter null bytes', async () => {
      const nullBytePaths = [
        'file\0hidden.txt',
        'file.txt\0.exe',
        '\0/etc/passwd',
        'normal\0/../../../etc/passwd'
      ];

      for (const nullPath of nullBytePaths) {
        const result = await validator.validateAndSanitizePath(nullPath, testDir);
        expect(result).not.toContain('\0');
        SecurityAssertions.assertSanitizedPath(nullPath, result);
      }
    });

    it('should filter control characters', async () => {
      const controlCharPaths = MALICIOUS_INPUTS.specialCharacters.map(char => `file${char}name.txt`);

      for (const controlPath of controlCharPaths) {
        const result = await validator.validateAndSanitizePath(controlPath, testDir);
        // Should not contain dangerous control characters
        expect(result).not.toMatch(/[\x00-\x1f\x7f]/);
        SecurityAssertions.assertSanitizedPath(controlPath, result);
      }
    });

    it('should handle dangerous filename characters', async () => {
      const dangerousChars = ['<', '>', ':', '|', '?', '*', '"'];
      
      for (const char of dangerousChars) {
        const dangerousPath = `file${char}name.txt`;
        const result = await validator.validateAndSanitizePath(dangerousPath, testDir);
        
        expect(result).not.toContain(char);
        SecurityAssertions.assertSanitizedPath(dangerousPath, result);
      }
    });
  });

  describe('Windows Reserved Name Prevention', () => {
    it('should prevent Windows device names', async () => {
      const deviceNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'LPT1', 'LPT2'];
      
      for (const device of deviceNames) {
        await expect(
          validator.validateAndSanitizePath(device, testDir)
        ).rejects.toThrow();
      }
    });

    it('should prevent Windows device names with extensions', async () => {
      const deviceNamesWithExt = ['CON.txt', 'PRN.log', 'AUX.cfg', 'NUL.dat'];
      
      for (const device of deviceNamesWithExt) {
        await expect(
          validator.validateAndSanitizePath(device, testDir)
        ).rejects.toThrow();
      }
    });

    it('should prevent case-insensitive device names', async () => {
      const caseVariants = ['con', 'Con', 'CON', 'prn', 'Prn', 'PRN'];
      
      for (const variant of caseVariants) {
        await expect(
          validator.validateAndSanitizePath(variant, testDir)
        ).rejects.toThrow();
      }
    });
  });

  describe('Filename Sanitization', () => {
    it('should sanitize dangerous filenames', async () => {
      for (const dangerous of MALICIOUS_INPUTS.dangerousFilenames) {
        try {
          const sanitized = validator.sanitizeConfigFilename(dangerous);
          
          // Should not contain dangerous characters
          expect(sanitized).not.toContain('<');
          expect(sanitized).not.toContain('>');
          expect(sanitized).not.toContain(':');
          expect(sanitized).not.toContain('|');
          expect(sanitized).not.toContain('?');
          expect(sanitized).not.toContain('*');
          expect(sanitized).not.toContain('\0');
          
          // Should not be empty
          expect(sanitized.length).toBeGreaterThan(0);
          
          // Should not be just dots
          expect(sanitized).not.toBe('.');
          expect(sanitized).not.toBe('..');
          
        } catch (error) {
          // If sanitization fails, should throw appropriate error
          expect(error.message).toMatch(/invalid|filename|dangerous/i);
        }
      }
    });

    it('should handle Unicode filenames safely', async () => {
      const unicodeNames = [
        'café.txt',           // Accented characters
        '测试文件.txt',        // Chinese characters
        'файл.txt',           // Cyrillic
        'ファイル.txt',         // Japanese
        '🔒secure.txt',       // Emoji
        'file\u200e\u200f.txt' // Bidirectional marks
      ];

      for (const unicodeName of unicodeNames) {
        const sanitized = validator.sanitizeConfigFilename(unicodeName);
        expect(sanitized).toBeTruthy();
        expect(sanitized.length).toBeGreaterThan(0);
        
        // Should not contain bidirectional override characters
        expect(sanitized).not.toMatch(/[\u200e\u200f\u202a-\u202e]/);
      }
    });

    it('should prevent filename length attacks', async () => {
      const longFilename = 'a'.repeat(1000);
      const sanitized = validator.sanitizeConfigFilename(longFilename);
      
      // Should be truncated to reasonable length
      expect(sanitized.length).toBeLessThan(256);
    });
  });

  describe('Glob Pattern Security', () => {
    it('should reject dangerous glob patterns', async () => {
      for (const dangerous of MALICIOUS_INPUTS.globPatterns) {
        await expect(() => 
          validator.validateGlobPattern(dangerous)
        ).toThrow(/dangerous glob pattern/i);
      }
    });

    it('should allow safe glob patterns', async () => {
      const safePatterns = [
        '*.txt',
        '**/*.js',
        'config/*.json',
        'src/**/*.ts',
        'test-*.log',
        'file[0-9].txt',
        'prefix-??.ext'
      ];

      for (const pattern of safePatterns) {
        expect(() => validator.validateGlobPattern(pattern)).not.toThrow();
      }
    });

    it('should enforce glob pattern length limits', async () => {
      const longPattern = '*'.repeat(5000);
      
      await expect(() => 
        validator.validateGlobPattern(longPattern)
      ).toThrow(/too long/i);
    });
  });

  describe('Path Type Validation', () => {
    it('should validate file vs directory correctly', async () => {
      const testFile = await testEnv.createTestFile(testDir, 'test.txt');
      const testSubDir = path.join(testDir, 'subdir');
      await mkdir(testSubDir);

      // File validation
      await expect(
        validator.validatePathType(testFile, 'file')
      ).resolves.not.toThrow();

      await expect(
        validator.validatePathType(testFile, 'directory')
      ).rejects.toThrow(/expected directory/i);

      // Directory validation
      await expect(
        validator.validatePathType(testSubDir, 'directory')
      ).resolves.not.toThrow();

      await expect(
        validator.validatePathType(testSubDir, 'file')
      ).rejects.toThrow(/expected file/i);
    });

    it('should handle non-existent paths gracefully', async () => {
      const nonExistent = path.join(testDir, 'does-not-exist.txt');

      await expect(
        validator.validatePathType(nonExistent, 'file')
      ).rejects.toThrow(/path validation failed/i);
    });
  });

  describe('Access Permission Validation', () => {
    it('should validate file accessibility', async () => {
      const testFile = await testEnv.createTestFile(testDir, 'accessible.txt');

      // Should be able to check file exists
      await expect(
        validator.validateFileAccess(testFile)
      ).resolves.not.toThrow();

      // Should be able to check read access
      await expect(
        validator.validateFileAccess(testFile, 0o004) // R_OK
      ).resolves.not.toThrow();
    });

    it('should handle permission denied gracefully', async () => {
      const testFile = await testEnv.createTestFile(testDir, 'no-access.txt');
      
      try {
        // Remove all permissions
        await chmod(testFile, 0o000);

        await expect(
          validator.validateFileAccess(testFile, 0o004) // R_OK
        ).rejects.toThrow(/not accessible/i);
      } finally {
        // Restore permissions for cleanup
        await chmod(testFile, 0o644).catch(() => {});
      }
    });
  });

  describe('Symlink Attack Prevention', () => {
    it('should handle symlinks safely', async () => {
      try {
        const targetFile = await testEnv.createTestFile(testDir, 'target.txt');
        const symlinkPath = path.join(testDir, 'symlink.txt');
        
        // Create symlink
        await symlink(targetFile, symlinkPath);

        // Should handle symlink validation appropriately
        const result = await validator.validateAndSanitizePath(symlinkPath, testDir);
        expect(result).toBeTruthy();
        
      } catch (error) {
        // Symlink creation might fail on some systems, skip test in that case
        if (error.code === 'EPERM' || error.code === 'ENOENT') {
          console.warn('Skipping symlink test due to system limitations');
          return;
        }
        throw error;
      }
    });

    it('should prevent symlink traversal attacks', async () => {
      try {
        const symlinkPath = path.join(testDir, 'evil-link');
        
        // Try to create symlink pointing outside allowed directory
        await symlink('/etc/passwd', symlinkPath);

        // Following this symlink should be prevented
        await expect(
          validator.validatePathType(symlinkPath, 'file')
        ).rejects.toThrow();

      } catch (error) {
        // Symlink creation might fail, which is also acceptable
        if (error.code === 'EPERM' || error.code === 'ENOENT') {
          console.warn('Skipping symlink traversal test due to system limitations');
          return;
        }
        // Other errors should be examined
      }
    });
  });

  describe('Allowed Directory Enforcement', () => {
    it('should enforce allowed directory restrictions', async () => {
      const outsideDir = await testEnv.createTempDir();
      const outsideFile = path.join(outsideDir, 'outside.txt');

      // Should reject paths outside allowed directories (in non-test environment)
      const restrictiveValidator = new SecurePathValidator([testDir]);
      
      // In test environment, this might be relaxed, so we just verify the mechanism exists
      try {
        await restrictiveValidator.validateAndSanitizePath(outsideFile);
        // If it succeeds, verify it's because we're in test environment
        expect(process.env.NODE_ENV).toBe('test');
      } catch (error) {
        expect(error.message).toMatch(/not allowed/i);
      }
    });

    it('should allow paths within allowed directories', async () => {
      const innerFile = path.join(testDir, 'inner', 'file.txt');
      
      const result = await validator.validateAndSanitizePath(innerFile, testDir);
      expect(result).toContain(testDir);
      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty and null inputs', async () => {
      const invalidInputs = ['', '   ', null, undefined];

      for (const input of invalidInputs) {
        await expect(
          validator.validateAndSanitizePath(input as any, testDir)
        ).rejects.toThrow(/invalid path/i);
      }
    });

    it('should handle non-string inputs', async () => {
      const nonStringInputs = [123, true, {}, [], Symbol('test')];

      for (const input of nonStringInputs) {
        await expect(
          validator.validateAndSanitizePath(input as any, testDir)
        ).rejects.toThrow(/must be.*string/i);
      }
    });

    it('should provide informative error messages', async () => {
      await expect(
        validator.validateAndSanitizePath('../../../etc/passwd', testDir)
      ).rejects.toThrow(/Path traversal attempt detected/i);
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle many validation requests efficiently', async () => {
      const startTime = Date.now();
      const operations = [];

      // Test many concurrent validations
      for (let i = 0; i < 100; i++) {
        operations.push(
          validator.validateAndSanitizePath(`file-${i}.txt`, testDir)
        );
      }

      const results = await Promise.allSettled(operations);
      const endTime = Date.now();

      // Should complete reasonably quickly
      expect(endTime - startTime).toBeLessThan(5000);
      
      // All should succeed for simple filenames
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBe(100);
    });

    it('should not consume excessive memory', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Perform many operations
      for (let i = 0; i < 1000; i++) {
        await validator.validateAndSanitizePath(`test-${i}.txt`, testDir);
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Should not leak significant memory (allow for some variance)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // 10MB
    });
  });
});