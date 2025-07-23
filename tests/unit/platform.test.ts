import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, chmod } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { detectPlatform, getPlatformAdapter, Platform } from '../../src/core/platform.js';

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
      tempDir = join(tmpdir(), `ailock-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      testFile = join(tempDir, 'test.txt');
      await writeFile(testFile, 'test content');
    });

    afterEach(async () => {
      try {
        // Ensure file is unlocked before cleanup
        await chmod(testFile, 0o644);
      } catch {
        // Ignore errors during cleanup
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
      const nonExistentFile = join(tmpdir(), 'non-existent-file.txt');
      
      // Should throw error for non-existent file
      await expect(adapter.lockFile(nonExistentFile)).rejects.toThrow();
      await expect(adapter.unlockFile(nonExistentFile)).rejects.toThrow();
    });
  });
});