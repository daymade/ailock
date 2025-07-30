import { randomBytes, createHash } from 'crypto';
import { mkdir, writeFile, readFile, unlink, rename, stat } from 'fs/promises';
import { lock, unlock, check as isLocked } from 'proper-lockfile';
import writeFileAtomic from 'write-file-atomic';
import path from 'path';

export interface LockInfo {
  lockId: string;
  pid: number;
  timestamp: number;
  filePath: string;
  userId: string;
  checksum?: string;
}

export interface AtomicOperationOptions {
  timeout?: number;
  retries?: number;
  checkIntegrity?: boolean;
  backup?: boolean;
}

/**
 * Atomic file manager that prevents race conditions and ensures data integrity
 * during file operations
 */
export class AtomicFileManager {
  private readonly lockDir = '.ailock-locks';
  private readonly defaultTimeout = 5000; // 5 seconds (shorter for better test performance)
  private readonly activeLocks = new Map<string, string>(); // filePath -> lockId
  private readonly lockCleanupTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly workingDir: string = process.cwd()) {
    // Ensure lock directory exists
    this.initializeLockDirectory();
  }

  /**
   * Acquires an exclusive lock on a file with automatic cleanup
   */
  async acquireLock(
    filePath: string,
    options: AtomicOperationOptions = {}
  ): Promise<string> {
    const resolvedPath = path.resolve(this.workingDir, filePath);
    const lockId = randomBytes(16).toString('hex');
    const timeout = options.timeout || this.defaultTimeout;

    try {
      // Check if file is already locked by this process
      if (this.activeLocks.has(resolvedPath)) {
        throw new Error(`File already locked by this process: ${filePath}`);
      }

      // Acquire process-level lock using proper-lockfile
      await lock(resolvedPath, {
        lockfilePath: path.join(this.getLockDir(), `${path.basename(filePath)}.lock`),
        retries: {
          retries: options.retries || 5,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 5000,
          randomize: true,
        },
        realpath: false, // Don't resolve symlinks for security
      });

      // Create lock metadata
      const lockInfo: LockInfo = {
        lockId,
        pid: process.pid,
        timestamp: Date.now(),
        filePath: resolvedPath,
        userId: this.getCurrentUserId(),
        // Don't calculate checksum at lock time - will be set after write operations
        checksum: undefined,
      };

      // Store lock information
      await this.storeLockInfo(resolvedPath, lockInfo);
      this.activeLocks.set(resolvedPath, lockId);

      // Set automatic cleanup timer
      const cleanupTimer = setTimeout(() => {
        this.releaseLock(filePath, lockId).catch(() => {
          // Silent cleanup - log but don't throw
          console.warn(`Failed to auto-cleanup lock for ${filePath}`);
        });
      }, timeout);

      this.lockCleanupTimers.set(resolvedPath, cleanupTimer);

      return lockId;
    } catch (error) {
      // Clean up on failure
      try {
        await this.forceReleaseLock(resolvedPath);
      } catch {
        // Ignore cleanup errors
      }

      if (error instanceof Error && error.message.includes('already being held')) {
        throw new Error(`File is locked by another process: ${filePath}`);
      }

      throw new Error(`Failed to acquire lock: ${error}`);
    }
  }

  /**
   * Releases a file lock with validation
   */
  async releaseLock(filePath: string, lockId: string): Promise<void> {
    const resolvedPath = path.resolve(this.workingDir, filePath);

    try {
      // Validate lock ownership - be more lenient to handle edge cases
      const currentLockId = this.activeLocks.get(resolvedPath);
      if (currentLockId && currentLockId !== lockId) {
        throw new Error(`Invalid lock ID for ${filePath}`);
      }

      // Clear cleanup timer
      const timer = this.lockCleanupTimers.get(resolvedPath);
      if (timer) {
        clearTimeout(timer);
        this.lockCleanupTimers.delete(resolvedPath);
      }

      // Release process-level lock
      const lockfilePath = path.join(this.getLockDir(), `${path.basename(filePath)}.lock`);
      try {
        await unlock(resolvedPath, { lockfilePath });
      } catch (unlockError) {
        // Check if lock file exists and try direct removal
        try {
          await unlink(lockfilePath);
        } catch {
          // Lock may already be released, continue with cleanup
        }
      }

      // Clean up lock metadata and internal state
      try {
        await this.removeLockInfo(resolvedPath);
      } catch {
        // Metadata file may not exist, continue
      }
      this.activeLocks.delete(resolvedPath);

    } catch (error) {
      // Still clean up internal state even if release fails
      this.activeLocks.delete(resolvedPath);
      const timer = this.lockCleanupTimers.get(resolvedPath);
      if (timer) {
        clearTimeout(timer);
        this.lockCleanupTimers.delete(resolvedPath);
      }
      throw error;
    }
  }

  /**
   * Performs an atomic write operation with lock protection
   */
  async atomicWrite(
    filePath: string,
    data: string | Buffer,
    options: AtomicOperationOptions = {}
  ): Promise<void> {
    const resolvedPath = path.resolve(this.workingDir, filePath);
    let lockId: string | null = null;

    try {
      // Acquire exclusive lock
      lockId = await this.acquireLock(filePath, options);

      // Create backup if requested
      if (options.backup) {
        await this.createBackup(resolvedPath);
      }

      // Perform atomic write
      const writeOptions: any = {
        mode: 0o644,
      };
      
      if (typeof data === 'string') {
        writeOptions.encoding = 'utf8';
      }
      
      await writeFileAtomic(resolvedPath, data, writeOptions);

      // Update checksum after write if integrity checking is enabled
      if (options.checkIntegrity) {
        await this.updateChecksumAfterWrite(resolvedPath, lockId);
      }

    } catch (error) {
      // Restore backup on failure
      if (options.backup) {
        await this.restoreBackup(resolvedPath).catch(() => {
          // Log but don't throw - original error is more important
          console.warn(`Failed to restore backup for ${filePath}`);
        });
      }

      throw new Error(`Atomic write failed: ${error}`);
    } finally {
      // Always release lock
      if (lockId) {
        await this.releaseLock(filePath, lockId).catch(() => {
          console.warn(`Failed to release lock after write: ${filePath}`);
        });
      }
    }
  }

  /**
   * Performs an atomic read operation with lock protection
   */
  async atomicRead(
    filePath: string,
    options: AtomicOperationOptions = {}
  ): Promise<string> {
    const resolvedPath = path.resolve(this.workingDir, filePath);
    let lockId: string | null = null;

    try {
      // Check if file exists before attempting to lock
      try {
        await stat(resolvedPath);
      } catch (error) {
        throw new Error(`File does not exist: ${filePath}`);
      }

      // Acquire shared lock (for read operations, we still use exclusive for simplicity)
      lockId = await this.acquireLock(filePath, { 
        ...options, 
        timeout: (options.timeout || this.defaultTimeout) / 2 // Shorter timeout for reads
      });

      // Read file content
      const content = await readFile(resolvedPath, 'utf8');

      // Verify integrity if requested
      if (options.checkIntegrity) {
        await this.verifyIntegrity(resolvedPath, lockId);
      }

      return content;

    } catch (error) {
      throw new Error(`Atomic read failed: ${error}`);
    } finally {
      // Always release lock
      if (lockId) {
        await this.releaseLock(filePath, lockId).catch(() => {
          console.warn(`Failed to release lock after read: ${filePath}`);
        });
      }
    }
  }

  /**
   * Checks if a file is currently locked
   */
  async isFileLocked(filePath: string): Promise<boolean> {
    const resolvedPath = path.resolve(this.workingDir, filePath);
    const lockfilePath = path.join(this.getLockDir(), `${path.basename(filePath)}.lock`);

    try {
      // Simple check - just ask the external lock system
      // Don't try to "fix" state mismatches as this causes race conditions
      return await isLocked(resolvedPath, { lockfilePath });
    } catch {
      // If external check fails, assume unlocked (fail-safe behavior)
      return false;
    }
  }

  /**
   * Gets information about the current lock on a file
   */
  async getLockInfo(filePath: string): Promise<LockInfo | null> {
    const resolvedPath = path.resolve(this.workingDir, filePath);

    try {
      return await this.readLockInfo(resolvedPath);
    } catch {
      return null;
    }
  }

  /**
   * Forces release of a lock (emergency cleanup)
   */
  async forceReleaseLock(filePath: string): Promise<void> {
    const resolvedPath = path.resolve(this.workingDir, filePath);
    const lockfilePath = path.join(this.getLockDir(), `${path.basename(filePath)}.lock`);

    try {
      // Force unlock
      await unlock(resolvedPath, { lockfilePath }).catch(() => {
        // Try to remove lock file directly
        return unlink(lockfilePath).catch(() => {});
      });

      // Clean up metadata
      await this.removeLockInfo(resolvedPath).catch(() => {});
      this.activeLocks.delete(resolvedPath);

      // Clear timer
      const timer = this.lockCleanupTimers.get(resolvedPath);
      if (timer) {
        clearTimeout(timer);
        this.lockCleanupTimers.delete(resolvedPath);
      }
    } catch (error) {
      console.warn(`Force release failed for ${filePath}: ${error}`);
    }
  }

  /**
   * Cleans up all locks held by this process
   */
  async cleanup(): Promise<void> {
    const lockPromises = Array.from(this.activeLocks.entries()).map(
      ([filePath, lockId]) => this.releaseLock(filePath, lockId).catch(() => {})
    );

    await Promise.all(lockPromises);

    // Clear all timers
    for (const timer of this.lockCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.lockCleanupTimers.clear();
  }

  /**
   * Initialize lock directory
   */
  private async initializeLockDirectory(): Promise<void> {
    try {
      await mkdir(this.getLockDir(), { recursive: true, mode: 0o755 });
    } catch (error) {
      console.warn(`Failed to create lock directory: ${error}`);
    }
  }

  /**
   * Get lock directory path
   */
  private getLockDir(): string {
    return path.join(this.workingDir, this.lockDir);
  }

  /**
   * Store lock information in metadata file
   */
  private async storeLockInfo(filePath: string, lockInfo: LockInfo): Promise<void> {
    const metadataPath = `${filePath}.ailock-meta`;
    await writeFileAtomic(metadataPath, JSON.stringify(lockInfo, null, 2));
  }

  /**
   * Read lock information from metadata file
   */
  private async readLockInfo(filePath: string): Promise<LockInfo> {
    const metadataPath = `${filePath}.ailock-meta`;
    const content = await readFile(metadataPath, 'utf8');
    return JSON.parse(content);
  }

  /**
   * Remove lock information metadata file
   */
  private async removeLockInfo(filePath: string): Promise<void> {
    const metadataPath = `${filePath}.ailock-meta`;
    await unlink(metadataPath).catch(() => {}); // Ignore if doesn't exist
  }

  /**
   * Calculate file checksum for integrity verification
   */
  private async calculateChecksum(filePath: string): Promise<string> {
    try {
      const content = await readFile(filePath);
      return createHash('sha256').update(content).digest('hex');
    } catch {
      return 'file-not-accessible';
    }
  }

  /**
   * Update checksum in lock metadata after write operation
   */
  private async updateChecksumAfterWrite(filePath: string, lockId: string): Promise<void> {
    try {
      const lockInfo = await this.readLockInfo(filePath);
      if (lockInfo.lockId !== lockId) {
        throw new Error('Lock ID mismatch during checksum update');
      }

      // Calculate new checksum after write
      const newChecksum = await this.calculateChecksum(filePath);
      lockInfo.checksum = newChecksum;
      
      // Update lock metadata with new checksum
      await this.storeLockInfo(filePath, lockInfo);
    } catch (error) {
      throw new Error(`Failed to update checksum: ${error}`);
    }
  }

  /**
   * Verify file integrity against stored checksum
   */
  private async verifyIntegrity(filePath: string, lockId: string): Promise<void> {
    try {
      const lockInfo = await this.readLockInfo(filePath);
      if (lockInfo.lockId !== lockId) {
        throw new Error('Lock ID mismatch during integrity check');
      }

      if (lockInfo.checksum) {
        const currentChecksum = await this.calculateChecksum(filePath);
        if (currentChecksum !== lockInfo.checksum) {
          throw new Error('File integrity verification failed');
        }
      }
    } catch (error) {
      throw new Error(`Integrity verification failed: ${error}`);
    }
  }

  /**
   * Create backup of file
   */
  private async createBackup(filePath: string): Promise<void> {
    try {
      const backupPath = `${filePath}.ailock-backup`;
      const content = await readFile(filePath);
      await writeFileAtomic(backupPath, content);
    } catch (error) {
      // Only warn for backup failures - don't fail the operation
      console.warn(`Failed to create backup for ${filePath}: ${error}`);
    }
  }

  /**
   * Restore file from backup
   */
  private async restoreBackup(filePath: string): Promise<void> {
    const backupPath = `${filePath}.ailock-backup`;
    try {
      const content = await readFile(backupPath);
      await writeFileAtomic(filePath, content);
      await unlink(backupPath); // Clean up backup
    } catch (error) {
      throw new Error(`Failed to restore backup: ${error}`);
    }
  }

  /**
   * Get current user ID for lock tracking
   */
  private getCurrentUserId(): string {
    return process.env.USER || process.env.USERNAME || `pid-${process.pid}`;
  }
}