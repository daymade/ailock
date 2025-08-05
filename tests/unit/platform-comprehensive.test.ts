import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { mkdir, writeFile, rm, chmod, access, constants } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { detectPlatform, getPlatformAdapter, Platform } from '../../src/core/platform.js';
import { SecureCommandExecutor } from '../../src/security/CommandExecutor.js';
import { SecurePathValidator } from '../../src/security/PathValidator.js';
import { AtomicFileManager } from '../../src/security/AtomicFileManager.js';

const execAsync = promisify(exec);

// Mock the security modules
vi.mock('../../src/security/CommandExecutor.js');
vi.mock('../../src/security/PathValidator.js');
vi.mock('../../src/security/AtomicFileManager.js');

describe('Platform Module Comprehensive Tests', () => {
  describe('Platform Detection', () => {
    const originalPlatform = process.platform;
    const originalEnv = process.env;

    afterEach(() => {
      Object.defineProperty(process, 'platform', {
        value: originalPlatform
      });
      process.env = originalEnv;
    });

    it('should detect Unix platform correctly', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux'
      });
      process.env = { ...originalEnv };
      delete process.env.WSL_DISTRO_NAME;
      delete process.env.WSLENV;
      
      expect(detectPlatform()).toBe(Platform.UNIX);
    });

    it('should detect Windows platform correctly', () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32'
      });
      
      expect(detectPlatform()).toBe(Platform.WINDOWS);
    });

    it('should detect WSL platform correctly with WSL_DISTRO_NAME', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux'
      });
      process.env = { ...originalEnv, WSL_DISTRO_NAME: 'Ubuntu' };
      
      expect(detectPlatform()).toBe(Platform.WSL);
    });

    it('should detect WSL platform correctly with WSLENV', () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux'
      });
      process.env = { ...originalEnv, WSLENV: 'WT_SESSION::WT_PROFILE_ID' };
      
      expect(detectPlatform()).toBe(Platform.WSL);
    });
  });

  describe('Unix Platform Adapter - Unit Tests with Mocks', () => {
    let mockCommandExecutor: MockedFunction<any>;
    let mockPathValidator: MockedFunction<any>;
    let mockAtomicManager: MockedFunction<any>;
    let tempDir: string;
    let testFile: string;

    beforeEach(async () => {
      // Setup mocks
      mockCommandExecutor = {
        executeCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
      };
      mockPathValidator = {
        validateAndSanitizePath: vi.fn((path) => Promise.resolve(path)),
        validatePathType: vi.fn().mockResolvedValue(true)
      };
      mockAtomicManager = {
        acquireLock: vi.fn().mockResolvedValue('lock-id-123'),
        releaseLock: vi.fn().mockResolvedValue(undefined)
      };

      (SecureCommandExecutor as any).mockImplementation(() => mockCommandExecutor);
      (SecurePathValidator as any).mockImplementation(() => mockPathValidator);
      (AtomicFileManager as any).mockImplementation(() => mockAtomicManager);

      // Create test files
      tempDir = join(tmpdir(), `ailock-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      testFile = join(tempDir, 'test.txt');
      await writeFile(testFile, 'test content');
    });

    afterEach(async () => {
      vi.clearAllMocks();
      await rm(tempDir, { recursive: true, force: true });
    });

    describe('lockFile', () => {
      it('should validate path before locking', async () => {
        const adapter = getPlatformAdapter();
        await adapter.lockFile(testFile);

        expect(mockPathValidator.validateAndSanitizePath).toHaveBeenCalledWith(testFile);
        expect(mockPathValidator.validatePathType).toHaveBeenCalledWith(testFile, 'file');
      });

      it('should acquire atomic lock during operation', async () => {
        const adapter = getPlatformAdapter();
        await adapter.lockFile(testFile);

        expect(mockAtomicManager.acquireLock).toHaveBeenCalledWith(
          testFile,
          expect.objectContaining({
            timeout: 10000,
            checkIntegrity: true,
            backup: true
          })
        );
        expect(mockAtomicManager.releaseLock).toHaveBeenCalledWith(testFile, 'lock-id-123');
      });

      it('should skip locking if file is already locked', async () => {
        const adapter = getPlatformAdapter();
        
        // First lock the file
        await adapter.lockFile(testFile);
        
        // Mock isLocked to return true
        const originalIsLocked = adapter.isLocked;
        adapter.isLocked = vi.fn().mockResolvedValue(true);
        
        // Clear previous calls
        mockAtomicManager.acquireLock.mockClear();
        
        // Try to lock again
        await adapter.lockFile(testFile);
        
        // Should not acquire lock again
        expect(mockAtomicManager.acquireLock).not.toHaveBeenCalled();
        
        // Restore original method
        adapter.isLocked = originalIsLocked;
      });

      it('should execute platform-specific commands on Linux', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', {
          value: 'linux',
          configurable: true
        });

        const adapter = getPlatformAdapter();
        await adapter.lockFile(testFile);

        expect(mockCommandExecutor.executeCommand).toHaveBeenCalledWith(
          'chattr',
          ['+i', testFile],
          { timeout: 5000 }
        );

        Object.defineProperty(process, 'platform', {
          value: originalPlatform
        });
      });

      it('should execute platform-specific commands on macOS', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true
        });

        const adapter = getPlatformAdapter();
        await adapter.lockFile(testFile);

        expect(mockCommandExecutor.executeCommand).toHaveBeenCalledWith(
          'chflags',
          ['uchg', testFile],
          { timeout: 5000 }
        );

        Object.defineProperty(process, 'platform', {
          value: originalPlatform
        });
      });

      it('should handle command execution errors gracefully', async () => {
        mockCommandExecutor.executeCommand.mockRejectedValue(new Error('Command failed'));
        
        const adapter = getPlatformAdapter();
        
        // Should not throw, just warn
        await expect(adapter.lockFile(testFile)).resolves.not.toThrow();
      });
    });

    describe('unlockFile', () => {
      it('should retry unlock operation on failure', async () => {
        const adapter = getPlatformAdapter();
        
        // Mock chmod to fail twice then succeed
        let callCount = 0;
        vi.spyOn(adapter as any, 'attemptUnlockFile').mockImplementation(async () => {
          callCount++;
          if (callCount < 3) {
            throw new Error('Unlock failed');
          }
        });

        await adapter.unlockFile(testFile);
        
        expect(callCount).toBe(3);
      });

      it('should remove platform-specific flags before chmod', async () => {
        const originalPlatform = process.platform;
        Object.defineProperty(process, 'platform', {
          value: 'linux',
          configurable: true
        });

        const adapter = getPlatformAdapter();
        await adapter.unlockFile(testFile);

        // Verify chattr -i was called
        expect(mockCommandExecutor.executeCommand).toHaveBeenCalledWith(
          'chattr',
          ['-i', testFile],
          { timeout: 5000 }
        );

        Object.defineProperty(process, 'platform', {
          value: originalPlatform
        });
      });

      it('should verify unlock success', async () => {
        const adapter = getPlatformAdapter();
        
        // Mock access to simulate file is writable
        const accessSpy = vi.spyOn(await import('fs/promises'), 'access').mockResolvedValue(undefined);
        
        await adapter.unlockFile(testFile);
        
        expect(accessSpy).toHaveBeenCalledWith(testFile, constants.W_OK);
        
        accessSpy.mockRestore();
      });

      it('should provide detailed diagnostics on final failure', async () => {
        const adapter = getPlatformAdapter();
        
        // Mock all unlock attempts to fail
        vi.spyOn(adapter as any, 'attemptUnlockFile').mockRejectedValue(new Error('Permission denied'));
        
        // Mock FileDiagnostics
        const mockDiagnostics = {
          diagnoseUnlockIssues: vi.fn().mockResolvedValue({
            diagnosis: ['File has immutable flag set'],
            recommendations: ['Use sudo chattr -i'],
            hasImmutableFlag: true
          }),
          formatDiagnostics: vi.fn().mockReturnValue('Diagnostic report')
        };
        
        vi.doMock('../utils/FileDiagnostics.js', () => ({
          FileDiagnostics: vi.fn(() => mockDiagnostics)
        }));
        
        await expect(adapter.unlockFile(testFile)).rejects.toThrow(/Failed to unlock file/);
      });
    });

    describe('isLocked', () => {
      it('should check write permissions', async () => {
        const adapter = getPlatformAdapter();
        
        // Mock access to simulate file is not writable
        const accessSpy = vi.spyOn(await import('fs/promises'), 'access')
          .mockRejectedValue(new Error('Permission denied'));
        
        const isLocked = await adapter.isLocked(testFile);
        
        expect(isLocked).toBe(true);
        expect(accessSpy).toHaveBeenCalledWith(testFile, constants.W_OK);
        
        accessSpy.mockRestore();
      });

      it('should return false for writable files', async () => {
        const adapter = getPlatformAdapter();
        
        // Mock access to succeed
        const accessSpy = vi.spyOn(await import('fs/promises'), 'access')
          .mockResolvedValue(undefined);
        
        const isLocked = await adapter.isLocked(testFile);
        
        expect(isLocked).toBe(false);
        
        accessSpy.mockRestore();
      });

      it('should handle non-existent files', async () => {
        const adapter = getPlatformAdapter();
        const nonExistentFile = join(tempDir, 'does-not-exist.txt');
        
        const isLocked = await adapter.isLocked(nonExistentFile);
        
        expect(isLocked).toBe(false);
      });
    });

    describe('Security methods', () => {
      it('should validate security of files', async () => {
        const adapter = getPlatformAdapter();
        
        // Mock stat to return file info
        const statSpy = vi.spyOn(await import('fs/promises'), 'stat')
          .mockResolvedValue({
            isFile: () => true,
            mode: 0o644,
            mtime: new Date()
          } as any);
        
        const isValid = await adapter.validateSecurity(testFile);
        
        expect(isValid).toBe(true);
        expect(mockPathValidator.validateAndSanitizePath).toHaveBeenCalledWith(testFile);
        
        statSpy.mockRestore();
      });

      it('should get security info for files', async () => {
        const adapter = getPlatformAdapter();
        
        // Mock stat
        const mockDate = new Date();
        const statSpy = vi.spyOn(await import('fs/promises'), 'stat')
          .mockResolvedValue({
            mode: 0o444,
            mtime: mockDate
          } as any);
        
        const info = await adapter.getSecurityInfo(testFile);
        
        expect(info).toMatchObject({
          isReadOnly: true,
          permissions: expect.stringMatching(/r--r--r--/),
          platform: expect.any(String),
          lastModified: mockDate
        });
        
        statSpy.mockRestore();
      });
    });
  });

  describe('Windows Platform Adapter - Unit Tests', () => {
    let mockCommandExecutor: MockedFunction<any>;
    let tempDir: string;
    let testFile: string;

    beforeEach(async () => {
      // Only run Windows tests on Windows
      if (process.platform !== 'win32') {
        return;
      }

      mockCommandExecutor = {
        executeCommand: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
      };

      tempDir = join(tmpdir(), `ailock-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      testFile = join(tempDir, 'test.txt');
      await writeFile(testFile, 'test content');
    });

    afterEach(async () => {
      if (process.platform !== 'win32') {
        return;
      }
      
      vi.clearAllMocks();
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should use attrib command for locking on Windows', async function() {
      if (process.platform !== 'win32') {
        this.skip();
        return;
      }

      const adapter = getPlatformAdapter();
      
      // Mock the adapter to be Windows adapter
      const windowsAdapter = adapter as any;
      windowsAdapter.commandExecutor = mockCommandExecutor;
      
      await adapter.lockFile(testFile);
      
      expect(mockCommandExecutor.executeCommand).toHaveBeenCalledWith(
        'attrib',
        ['+R', testFile],
        expect.any(Object)
      );
    });

    it('should use icacls for advanced permissions on Windows', async function() {
      if (process.platform !== 'win32') {
        this.skip();
        return;
      }

      const adapter = getPlatformAdapter();
      const windowsAdapter = adapter as any;
      windowsAdapter.commandExecutor = mockCommandExecutor;
      
      await adapter.lockFile(testFile);
      
      expect(mockCommandExecutor.executeCommand).toHaveBeenCalledWith(
        'icacls',
        expect.arrayContaining([testFile, '/deny']),
        expect.any(Object)
      );
    });
  });

  describe('Integration Tests - Real Filesystem Operations', () => {
    let tempDir: string;
    let testFile: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `ailock-integration-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      testFile = join(tempDir, 'test.txt');
      await writeFile(testFile, 'test content');
    });

    afterEach(async () => {
      // Ensure file is unlocked before cleanup
      try {
        await chmod(testFile, 0o644);
        
        if (process.platform === 'darwin') {
          await execAsync(`chflags nouchg "${testFile}"`).catch(() => {});
        } else if (process.platform === 'linux') {
          await execAsync(`chattr -i "${testFile}"`).catch(() => {});
        }
      } catch {
        // Ignore errors
      }
      
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should actually lock and unlock files on the filesystem', async () => {
      const adapter = getPlatformAdapter();
      
      // Initially unlocked
      expect(await adapter.isLocked(testFile)).toBe(false);
      
      // Lock the file
      await adapter.lockFile(testFile);
      
      // Verify locked
      expect(await adapter.isLocked(testFile)).toBe(true);
      
      // Try to write to locked file - should fail
      await expect(writeFile(testFile, 'new content')).rejects.toThrow();
      
      // Unlock the file
      await adapter.unlockFile(testFile);
      
      // Verify unlocked
      expect(await adapter.isLocked(testFile)).toBe(false);
      
      // Should be able to write now
      await expect(writeFile(testFile, 'new content')).resolves.not.toThrow();
    });

    it('should handle concurrent lock operations', async () => {
      const adapter = getPlatformAdapter();
      
      // Try to lock the same file concurrently
      const results = await Promise.allSettled([
        adapter.lockFile(testFile),
        adapter.lockFile(testFile),
        adapter.lockFile(testFile)
      ]);
      
      // All should succeed (idempotent operation)
      results.forEach(result => {
        expect(result.status).toBe('fulfilled');
      });
      
      // File should be locked
      expect(await adapter.isLocked(testFile)).toBe(true);
    });

    it('should handle permission errors gracefully', async () => {
      const adapter = getPlatformAdapter();
      const restrictedFile = '/root/test.txt'; // Typically not writable
      
      // Should not crash, but handle error appropriately
      await expect(adapter.lockFile(restrictedFile)).rejects.toThrow();
    });
  });

  describe('WSL Platform Adapter', () => {
    it('should handle WSL-specific scenarios', async () => {
      // Mock WSL environment
      const originalEnv = process.env;
      process.env = { ...originalEnv, WSL_DISTRO_NAME: 'Ubuntu' };
      
      const platform = detectPlatform();
      expect(platform).toBe(Platform.WSL);
      
      const adapter = getPlatformAdapter();
      expect(adapter).toBeDefined();
      
      // Restore environment
      process.env = originalEnv;
    });
  });

  describe('Error Scenarios and Edge Cases', () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = join(tmpdir(), `ailock-edge-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should handle symlinks correctly', async () => {
      const targetFile = join(tempDir, 'target.txt');
      const symlinkFile = join(tempDir, 'symlink.txt');
      
      await writeFile(targetFile, 'target content');
      
      // Create symlink
      const { symlink } = await import('fs/promises');
      await symlink(targetFile, symlinkFile);
      
      const adapter = getPlatformAdapter();
      
      // Lock via symlink
      await adapter.lockFile(symlinkFile);
      
      // Both should be locked
      expect(await adapter.isLocked(symlinkFile)).toBe(true);
      expect(await adapter.isLocked(targetFile)).toBe(true);
    });

    it('should handle very long file paths', async () => {
      // Create a deeply nested directory structure
      let deepPath = tempDir;
      for (let i = 0; i < 10; i++) {
        deepPath = join(deepPath, `very-long-directory-name-${i}`);
      }
      
      await mkdir(deepPath, { recursive: true });
      const longFile = join(deepPath, 'file-with-very-long-name-that-might-cause-issues.txt');
      await writeFile(longFile, 'content');
      
      const adapter = getPlatformAdapter();
      
      await expect(adapter.lockFile(longFile)).resolves.not.toThrow();
      expect(await adapter.isLocked(longFile)).toBe(true);
    });

    it('should handle files with special characters', async () => {
      const specialFiles = [
        'file with spaces.txt',
        'file-with-dashes.txt',
        'file_with_underscores.txt',
        'file.with.dots.txt',
        'file@with#special$chars.txt'
      ];
      
      const adapter = getPlatformAdapter();
      
      for (const filename of specialFiles) {
        const filePath = join(tempDir, filename);
        await writeFile(filePath, 'content');
        
        await expect(adapter.lockFile(filePath)).resolves.not.toThrow();
        expect(await adapter.isLocked(filePath)).toBe(true);
      }
    });
  });
});