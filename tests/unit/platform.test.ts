import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, chmod } from 'fs/promises';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { detectPlatform, getPlatformAdapter, Platform } from '../../src/core/platform.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TEST_TEMP_DIR = resolve(__dirname, '../../.test-temp');

describe('Platform Detection and Adapters', () => {
  describe('detectPlatform', () => {
    it('should detect platform correctly', () => {
      const platform = detectPlatform();
      expect([Platform.UNIX, Platform.WINDOWS, Platform.WSL]).toContain(platform);
    });
  });

  describe('Platform Adapters', () => {
    let tempDir: string;
    let testFile: string;
    
    beforeEach(async () => {
      // Create test directory within project
      await mkdir(TEST_TEMP_DIR, { recursive: true });
      tempDir = join(TEST_TEMP_DIR, `test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      testFile = join(tempDir, 'test.txt');
      await writeFile(testFile, 'test content');
    });

    afterEach(async () => {
      try {
        // Try to unlock using the adapter first
        const adapter = getPlatformAdapter();
        await adapter.unlockFile(testFile);
      } catch {
        // If adapter fails, try manual cleanup
        try {
          await chmod(testFile, 0o644);
          // Remove immutable flag on macOS
          if (process.platform === 'darwin') {
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);
            await execAsync(`chflags nouchg "${testFile}"`).catch(() => {});
          }
        } catch {
          // Ignore errors during cleanup
        }
      }
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should lock and unlock files', async () => {
      const adapter = getPlatformAdapter();
      
      // Initially file should be unlocked (writable)
      const initiallyLocked = await adapter.isLocked(testFile);
      expect(initiallyLocked).toBe(false);
      
      // Lock the file
      await adapter.lockFile(testFile);
      
      // File should now be locked
      const isLocked = await adapter.isLocked(testFile);
      expect(isLocked).toBe(true);
      
      // Unlock the file
      await adapter.unlockFile(testFile);
      
      // File should be unlocked again
      const isUnlocked = await adapter.isLocked(testFile);
      expect(isUnlocked).toBe(false);
    });

    it('should handle locking already locked files', async () => {
      const adapter = getPlatformAdapter();
      
      // Lock the file twice - should not throw error
      await adapter.lockFile(testFile);
      await adapter.lockFile(testFile);
      
      const isLocked = await adapter.isLocked(testFile);
      expect(isLocked).toBe(true);
    });

    it('should handle unlocking already unlocked files', async () => {
      const adapter = getPlatformAdapter();
      
      // Unlock the file twice - should not throw error
      await adapter.unlockFile(testFile);
      await adapter.unlockFile(testFile);
      
      const isLocked = await adapter.isLocked(testFile);
      expect(isLocked).toBe(false);
    });

    it('should report immutable support capability', () => {
      const adapter = getPlatformAdapter();
      const supportsImmutable = adapter.supportsImmutable();
      expect(typeof supportsImmutable).toBe('boolean');
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent files gracefully', async () => {
      const adapter = getPlatformAdapter();
      const nonExistentFile = join(TEST_TEMP_DIR, 'non-existent-file.txt');
      
      // Should throw error for non-existent file
      await expect(adapter.lockFile(nonExistentFile)).rejects.toThrow();
      await expect(adapter.unlockFile(nonExistentFile)).rejects.toThrow();
    });

    it('should return false for isLocked on non-existent files', async () => {
      const adapter = getPlatformAdapter();
      const nonExistentFile = join(TEST_TEMP_DIR, 'definitely-does-not-exist-' + Date.now() + '.txt');
      
      // Non-existent file should not be considered locked
      const isLocked = await adapter.isLocked(nonExistentFile);
      expect(isLocked).toBe(false);
    });

    it('should correctly handle the reported bug scenario', async () => {
      const adapter = getPlatformAdapter();
      // This is the exact path from the bug report
      const buggedPath = '/home/tsong/workspace/java/mymercury-branches/oeg-mymercurysvc/oeg-mymercurysvc-application/src/main/resources/application-local.yml';
      
      // Non-existent file should not be considered locked
      const isLocked = await adapter.isLocked(buggedPath);
      expect(isLocked).toBe(false);
    });
  });
});