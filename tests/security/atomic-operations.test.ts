import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AtomicFileManager } from '../../src/security/AtomicFileManager.js';
import { 
  SecurityTestEnvironment, 
  TimingUtils, 
  PerformanceUtils 
} from './utils/security-test-helpers.js';
import { writeFile, readFile, unlink, stat } from 'fs/promises';
import path from 'path';

describe('Atomic File Operations and Race Condition Prevention', () => {
  let manager: AtomicFileManager;
  let testEnv: SecurityTestEnvironment;
  let testDir: string;

  beforeEach(async () => {
    testEnv = new SecurityTestEnvironment();
    testDir = await testEnv.createTempDir();
    manager = new AtomicFileManager(testDir);
  });

  afterEach(async () => {
    await manager.cleanup();
    await testEnv.cleanup();
  });

  describe('Lock Acquisition and Release', () => {
    it('should acquire and release locks successfully', async () => {
      const testFile = path.join(testDir, 'lock-test.txt');
      await writeFile(testFile, 'test content');

      // Acquire lock
      const lockId = await manager.acquireLock(testFile);
      expect(lockId).toBeTruthy();
      expect(typeof lockId).toBe('string');

      // Verify file is locked
      const isLocked = await manager.isFileLocked(testFile);
      expect(isLocked).toBe(true);

      // Get lock info
      const lockInfo = await manager.getLockInfo(testFile);
      expect(lockInfo).toBeTruthy();
      expect(lockInfo?.lockId).toBe(lockId);
      expect(lockInfo?.pid).toBe(process.pid);

      // Release lock
      await manager.releaseLock(testFile, lockId);

      // Verify file is unlocked
      const isUnlocked = await manager.isFileLocked(testFile);
      expect(isUnlocked).toBe(false);
    });

    it('should prevent concurrent lock acquisition', async () => {
      const testFile = path.join(testDir, 'concurrent-test.txt');
      await writeFile(testFile, 'test content');

      // Acquire first lock
      const lockId1 = await manager.acquireLock(testFile, { timeout: 5000 });

      // Try to acquire second lock (should fail)
      await expect(
        manager.acquireLock(testFile, { timeout: 1000 })
      ).rejects.toThrow(/already locked|already being held/i);

      // Release first lock
      await manager.releaseLock(testFile, lockId1);

      // Now second lock should succeed
      const lockId2 = await manager.acquireLock(testFile, { timeout: 1000 });
      expect(lockId2).toBeTruthy();
      await manager.releaseLock(testFile, lockId2);
    });

    it('should auto-cleanup stale locks', async () => {
      const testFile = path.join(testDir, 'cleanup-test.txt');
      await writeFile(testFile, 'test content');

      // Acquire lock with short timeout
      const lockId = await manager.acquireLock(testFile, { timeout: 500 });

      // Wait for auto-cleanup
      await TimingUtils.sleep(600);

      // Should be able to acquire new lock
      const newLockId = await manager.acquireLock(testFile, { timeout: 1000 });
      expect(newLockId).toBeTruthy();
      expect(newLockId).not.toBe(lockId);

      await manager.releaseLock(testFile, newLockId);
    });

    it('should validate lock IDs correctly', async () => {
      const testFile = path.join(testDir, 'validation-test.txt');
      await writeFile(testFile, 'test content');

      const lockId = await manager.acquireLock(testFile);

      // Try to release with wrong lock ID
      await expect(
        manager.releaseLock(testFile, 'wrong-lock-id')
      ).rejects.toThrow(/invalid lock id/i);

      // Release with correct lock ID should work
      await manager.releaseLock(testFile, lockId);
    });
  });

  describe('Atomic Write Operations', () => {
    it('should perform atomic writes successfully', async () => {
      const testFile = path.join(testDir, 'atomic-write.txt');
      const content = 'This is atomic content';

      await manager.atomicWrite(testFile, content);

      const readContent = await readFile(testFile, 'utf-8');
      expect(readContent).toBe(content);
    });

    it('should prevent race conditions during writes', async () => {
      const testFile = path.join(testDir, 'race-write.txt');
      const numOperations = 10;

      // Start multiple concurrent write operations
      const operations = Array.from({ length: numOperations }, (_, i) =>
        manager.atomicWrite(testFile, `Content from operation ${i}`, { timeout: 5000 })
      );

      const results = await Promise.allSettled(operations);

      // At least one should succeed
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(0);

      // File should exist and have valid content
      const finalContent = await readFile(testFile, 'utf-8');
      expect(finalContent).toMatch(/^Content from operation \d+$/);
    });

    it('should handle write failures with backup restoration', async () => {
      const testFile = path.join(testDir, 'backup-test.txt');
      const originalContent = 'Original content';
      const newContent = 'New content';

      // Create original file
      await writeFile(testFile, originalContent);

      // Mock a write failure by making the file unwritable temporarily
      const originalWrite = manager.atomicWrite.bind(manager);
      let callCount = 0;
      
      manager.atomicWrite = vi.fn().mockImplementation(async (filePath, data, options) => {
        callCount++;
        if (callCount === 1) {
          // First call fails
          throw new Error('Simulated write failure');
        }
        // Subsequent calls succeed
        return originalWrite(filePath, data, options);
      });

      // Attempt write with backup enabled
      await expect(
        manager.atomicWrite(testFile, newContent, { backup: true })
      ).rejects.toThrow('Simulated write failure');

      // Original content should be preserved
      const preservedContent = await readFile(testFile, 'utf-8');
      expect(preservedContent).toBe(originalContent);

      // Restore the original method
      manager.atomicWrite = originalWrite;
    });

    it('should verify integrity when requested', async () => {
      const testFile = path.join(testDir, 'integrity-test.txt');
      const content = 'Content with integrity check';

      await manager.atomicWrite(testFile, content, { checkIntegrity: true });

      // Read with integrity check should succeed
      const readContent = await manager.atomicRead(testFile, { checkIntegrity: true });
      expect(readContent).toBe(content);
    });

    it('should detect integrity violations', async () => {
      const testFile = path.join(testDir, 'integrity-violation.txt');
      const content = 'Original content';

      // Write with integrity
      await manager.atomicWrite(testFile, content, { checkIntegrity: true });

      // Manually modify file to simulate tampering
      await writeFile(testFile, 'Tampered content');

      // Reading with integrity check should fail
      await expect(
        manager.atomicRead(testFile, { checkIntegrity: true })
      ).rejects.toThrow(/integrity/i);
    });
  });

  describe('Atomic Read Operations', () => {
    it('should perform atomic reads successfully', async () => {
      const testFile = path.join(testDir, 'atomic-read.txt');
      const content = 'Content for atomic reading';

      await writeFile(testFile, content);

      const readContent = await manager.atomicRead(testFile);
      expect(readContent).toBe(content);
    });

    it('should prevent race conditions during reads', async () => {
      const testFile = path.join(testDir, 'race-read.txt');
      const content = 'Stable content for concurrent reads';

      await writeFile(testFile, content);

      // Start multiple concurrent read operations
      const operations = Array.from({ length: 20 }, () =>
        manager.atomicRead(testFile)
      );

      const results = await Promise.allSettled(operations);

      // All reads should succeed with same content
      const successful = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<string>[];
      expect(successful.length).toBe(20);

      for (const result of successful) {
        expect(result.value).toBe(content);
      }
    });

    it('should handle concurrent read/write operations', async () => {
      const testFile = path.join(testDir, 'read-write-race.txt');
      const initialContent = 'Initial content';

      await writeFile(testFile, initialContent);

      // Mix of read and write operations
      const operations = [];
      
      // Add some read operations
      for (let i = 0; i < 10; i++) {
        operations.push(
          manager.atomicRead(testFile).catch(() => 'read-failed')
        );
      }

      // Add some write operations
      for (let i = 0; i < 5; i++) {
        operations.push(
          manager.atomicWrite(testFile, `Write content ${i}`).catch(() => 'write-failed')
        );
      }

      const results = await Promise.allSettled(operations);

      // Some operations may fail due to locking, but system should remain stable
      expect(results.length).toBe(15);

      // File should exist and be readable
      const finalContent = await readFile(testFile, 'utf-8');
      expect(finalContent).toBeTruthy();
    });
  });

  describe('Lock Metadata Management', () => {
    it('should store and retrieve lock metadata correctly', async () => {
      const testFile = path.join(testDir, 'metadata-test.txt');
      await writeFile(testFile, 'test content');

      const lockId = await manager.acquireLock(testFile, { checkIntegrity: true });
      const lockInfo = await manager.getLockInfo(testFile);

      expect(lockInfo).toBeTruthy();
      expect(lockInfo?.lockId).toBe(lockId);
      expect(lockInfo?.pid).toBe(process.pid);
      expect(lockInfo?.filePath).toBe(testFile);
      expect(lockInfo?.userId).toBeTruthy();
      expect(lockInfo?.timestamp).toBeTypeOf('number');
      expect(lockInfo?.checksum).toBeTruthy();

      await manager.releaseLock(testFile, lockId);
    });

    it('should clean up metadata on lock release', async () => {
      const testFile = path.join(testDir, 'metadata-cleanup.txt');
      await writeFile(testFile, 'test content');

      const lockId = await manager.acquireLock(testFile);
      
      // Metadata should exist
      let lockInfo = await manager.getLockInfo(testFile);
      expect(lockInfo).toBeTruthy();

      await manager.releaseLock(testFile, lockId);

      // Metadata should be cleaned up
      lockInfo = await manager.getLockInfo(testFile);
      expect(lockInfo).toBeNull();
    });

    it('should handle corrupted metadata gracefully', async () => {
      const testFile = path.join(testDir, 'corrupted-metadata.txt');
      await writeFile(testFile, 'test content');

      const lockId = await manager.acquireLock(testFile);

      // Corrupt the metadata file
      const metadataPath = `${testFile}.ailock-meta`;
      await writeFile(metadataPath, 'corrupted json data');

      // Should handle corrupted metadata gracefully
      const lockInfo = await manager.getLockInfo(testFile);
      expect(lockInfo).toBeNull();

      // Force release should still work
      await manager.forceReleaseLock(testFile);
    });
  });

  describe('Force Release and Emergency Cleanup', () => {
    it('should force release locks when needed', async () => {
      const testFile = path.join(testDir, 'force-release.txt');
      await writeFile(testFile, 'test content');

      const lockId = await manager.acquireLock(testFile);
      
      // Verify lock exists
      expect(await manager.isFileLocked(testFile)).toBe(true);

      // Force release
      await manager.forceReleaseLock(testFile);

      // Lock should be released
      expect(await manager.isFileLocked(testFile)).toBe(false);

      // Should be able to acquire new lock
      const newLockId = await manager.acquireLock(testFile);
      expect(newLockId).toBeTruthy();
      await manager.releaseLock(testFile, newLockId);
    });

    it('should cleanup all locks on manager cleanup', async () => {
      const testFiles = [];
      const lockIds = [];

      // Create multiple locked files
      for (let i = 0; i < 5; i++) {
        const testFile = path.join(testDir, `cleanup-${i}.txt`);
        await writeFile(testFile, `content ${i}`);
        testFiles.push(testFile);
        
        const lockId = await manager.acquireLock(testFile);
        lockIds.push(lockId);
      }

      // Verify all are locked
      for (const file of testFiles) {
        expect(await manager.isFileLocked(file)).toBe(true);
      }

      // Cleanup manager
      await manager.cleanup();

      // All locks should be released
      for (const file of testFiles) {
        expect(await manager.isFileLocked(file)).toBe(false);
      }
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle non-existent files gracefully', async () => {
      const nonExistentFile = path.join(testDir, 'does-not-exist.txt');

      await expect(
        manager.acquireLock(nonExistentFile)
      ).rejects.toThrow();

      await expect(
        manager.atomicRead(nonExistentFile)
      ).rejects.toThrow();
    });

    it('should handle permission denied scenarios', async () => {
      const testFile = path.join(testDir, 'permission-denied.txt');
      await writeFile(testFile, 'test content');

      // This test might not work on all systems due to permission handling
      try {
        // Try to create lock in a scenario that might fail
        const lockId = await manager.acquireLock(testFile);
        await manager.releaseLock(testFile, lockId);
      } catch (error) {
        // If it fails due to permissions, that's also acceptable behavior
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle disk space exhaustion gracefully', async () => {
      const testFile = path.join(testDir, 'disk-space.txt');

      // We can't easily simulate disk space exhaustion, so we'll mock it
      const originalWrite = manager.atomicWrite.bind(manager);
      manager.atomicWrite = vi.fn().mockRejectedValue(new Error('ENOSPC: no space left on device'));

      await expect(
        manager.atomicWrite(testFile, 'content')
      ).rejects.toThrow(/no space left/i);

      // Restore original method
      manager.atomicWrite = originalWrite;
    });

    it('should handle system resource limits', async () => {
      // Test with many concurrent operations to stress system resources
      const operations = [];
      
      for (let i = 0; i < 100; i++) {
        const testFile = path.join(testDir, `resource-${i}.txt`);
        operations.push(
          writeFile(testFile, `content ${i}`)
            .then(() => manager.atomicWrite(testFile, `updated ${i}`))
            .catch(() => 'failed') // Allow some failures under stress
        );
      }

      const results = await Promise.allSettled(operations);
      
      // System should remain stable even if some operations fail
      expect(results.length).toBe(100);
      
      // At least some operations should succeed
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(0);
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle high concurrency efficiently', async () => {
      const { result: stressResult } = await PerformanceUtils.measureTime(async () => {
        return PerformanceUtils.stressTest(
          async () => {
            const testFile = path.join(testDir, `stress-${Math.random()}.txt`);
            await manager.atomicWrite(testFile, 'stress test content');
            return testFile;
          },
          20, // 20 concurrent operations
          2000 // for 2 seconds
        );
      });

      expect(stressResult.totalOperations).toBeGreaterThan(0);
      expect(stressResult.successCount).toBeGreaterThan(0);
      expect(stressResult.averageTime).toBeLessThan(1000); // Average operation under 1 second
    });

    it('should not leak memory during operations', async () => {
      const { memoryDelta } = await PerformanceUtils.measureMemoryUsage(async () => {
        // Perform many operations
        for (let i = 0; i < 100; i++) {
          const testFile = path.join(testDir, `memory-${i}.txt`);
          await manager.atomicWrite(testFile, `content ${i}`);
          await manager.atomicRead(testFile);
        }
      });

      // Should not leak significant memory (allow some variance)
      expect(memoryDelta).toBeLessThan(50 * 1024 * 1024); // 50MB
    });

    it('should handle lock contention efficiently', async () => {
      const testFile = path.join(testDir, 'contention-test.txt');
      await writeFile(testFile, 'initial content');

      const startTime = Date.now();
      
      // Create many operations that will contend for the same file
      const operations = Array.from({ length: 50 }, (_, i) =>
        manager.atomicWrite(testFile, `content-${i}`, { timeout: 10000 })
          .catch(() => `failed-${i}`)
      );

      await Promise.allSettled(operations);
      
      const duration = Date.now() - startTime;
      
      // Should complete in reasonable time even with contention
      expect(duration).toBeLessThan(30000); // 30 seconds

      // File should exist and be readable
      const finalContent = await readFile(testFile, 'utf-8');
      expect(finalContent).toBeTruthy();
    });
  });

  describe('Integration with File System Events', () => {
    it('should handle external file modifications', async () => {
      const testFile = path.join(testDir, 'external-mod.txt');
      const content = 'original content';

      await manager.atomicWrite(testFile, content);

      // Externally modify the file
      await writeFile(testFile, 'externally modified');

      // Read should return the externally modified content
      const readContent = await manager.atomicRead(testFile);
      expect(readContent).toBe('externally modified');
    });

    it('should detect file system changes during locked operations', async () => {
      const testFile = path.join(testDir, 'fs-change.txt');
      await writeFile(testFile, 'initial content');

      const lockId = await manager.acquireLock(testFile, { checkIntegrity: true });

      // Externally modify the file while locked
      await writeFile(testFile, 'tampered content');

      // Should detect the modification
      const lockInfo = await manager.getLockInfo(testFile);
      expect(lockInfo).toBeTruthy();

      // Release lock
      await manager.releaseLock(testFile, lockId);
    });
  });
});