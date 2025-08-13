import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, writeFile, rm, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import {
  isDirectoryTracked,
  getTrackedDirectories,
  getQuotaUsage,
  canLockFile,
  trackFileLocked,
  trackFileUnlocked,
  initializeUserConfig,
  getQuotaStatusSummary,
  resetDirectoryTracking,
  validateDirectoryTracking,
  repairDirectoryTracking,
  safeQuotaOperation
} from '../../../src/core/directory-tracker.js';

// Mock dependencies
vi.mock('../../../src/core/user-config.js', () => ({
  loadUserConfig: vi.fn(),
  saveUserConfig: vi.fn(),
  addLockedDirectory: vi.fn(),
  removeLockedDirectory: vi.fn(),
  getLockedDirectoryCount: vi.fn(),
  getUserQuota: vi.fn(),
  isWithinQuota: vi.fn()
}));

vi.mock('../../../src/services/CliApiService.js', () => ({
  getApiService: vi.fn().mockReturnValue({
    trackUsage: vi.fn().mockResolvedValue({ success: true })
  })
}));

vi.mock('../../../src/core/machine-id.js', () => ({
  getMachineUuid: vi.fn().mockResolvedValue('test-machine-uuid')
}));

describe('directory-tracker', () => {
  let tempDir: string;
  let testFile: string;
  let mockUserConfig: any;
  let mockApiService: any;

  beforeEach(async () => {
    // Create temporary directory for tests
    tempDir = join(tmpdir(), `ailock-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    testFile = join(tempDir, 'test.txt');
    await writeFile(testFile, 'test content');

    // Setup mocks
    mockUserConfig = {
      lockedDirectories: [],
      directoryQuota: 10,
      machineUuid: null
    };

    const { loadUserConfig, saveUserConfig, addLockedDirectory, removeLockedDirectory, getLockedDirectoryCount, getUserQuota } = await import('../../../src/core/user-config.js');
    vi.mocked(loadUserConfig).mockResolvedValue(mockUserConfig);
    vi.mocked(saveUserConfig).mockResolvedValue(undefined);
    vi.mocked(addLockedDirectory).mockResolvedValue(undefined);
    vi.mocked(removeLockedDirectory).mockResolvedValue(undefined);
    vi.mocked(getLockedDirectoryCount).mockResolvedValue(0);
    vi.mocked(getUserQuota).mockResolvedValue(10);

    const { getApiService } = await import('../../../src/services/CliApiService.js');
    mockApiService = {
      trackUsage: vi.fn().mockResolvedValue({ success: true })
    };
    vi.mocked(getApiService).mockReturnValue(mockApiService);

    // Clear environment variables
    delete process.env.AILOCK_DEBUG;
  });

  afterEach(async () => {
    // Clean up temp directory
    if (existsSync(tempDir)) {
      await rm(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('isDirectoryTracked', () => {
    it('should return false for untracked directory', async () => {
      const result = await isDirectoryTracked(testFile);
      expect(result).toBe(false);
    });

    it('should return true for tracked directory', async () => {
      mockUserConfig.lockedDirectories = [tempDir];
      
      const result = await isDirectoryTracked(testFile);
      expect(result).toBe(true);
    });

    it('should handle nested paths correctly', async () => {
      const nestedDir = join(tempDir, 'nested');
      const nestedFile = join(nestedDir, 'file.txt');
      
      mockUserConfig.lockedDirectories = [nestedDir];
      
      const result = await isDirectoryTracked(nestedFile);
      expect(result).toBe(true);
    });
  });

  describe('getTrackedDirectories', () => {
    it('should return empty array when no directories tracked', async () => {
      const result = await getTrackedDirectories();
      expect(result).toEqual([]);
    });

    it('should return copy of tracked directories', async () => {
      const directories = ['/path/1', '/path/2'];
      mockUserConfig.lockedDirectories = directories;
      
      const result = await getTrackedDirectories();
      expect(result).toEqual(directories);
      expect(result).not.toBe(directories); // Should be a copy
    });
  });

  describe('getQuotaUsage', () => {
    it('should return quota usage information', async () => {
      const { getLockedDirectoryCount, getUserQuota } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(3);
      vi.mocked(getUserQuota).mockResolvedValue(10);

      const result = await getQuotaUsage();

      expect(result).toEqual({
        used: 3,
        quota: 10,
        available: 7,
        withinQuota: true
      });
    });

    it('should handle quota exceeded scenario', async () => {
      const { getLockedDirectoryCount, getUserQuota } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(12);
      vi.mocked(getUserQuota).mockResolvedValue(10);

      const result = await getQuotaUsage();

      expect(result).toEqual({
        used: 12,
        quota: 10,
        available: 0,
        withinQuota: false
      });
    });
  });

  describe('canLockFile', () => {
    it('should allow locking when directory already tracked', async () => {
      mockUserConfig.lockedDirectories = [tempDir];
      const { getLockedDirectoryCount } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(1);

      const result = await canLockFile(testFile);

      expect(result.canLock).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should allow locking when within quota', async () => {
      const { getLockedDirectoryCount } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(5);

      const result = await canLockFile(testFile);

      expect(result.canLock).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('should reject locking when quota exceeded', async () => {
      const { getLockedDirectoryCount } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(10);

      const result = await canLockFile(testFile);

      expect(result.canLock).toBe(false);
      expect(result.reason).toContain('Directory quota exceeded');
    });
  });

  describe('trackFileLocked', () => {
    it('should add new directory to tracking', async () => {
      const { addLockedDirectory, getLockedDirectoryCount } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(1);

      await trackFileLocked(testFile);

      expect(addLockedDirectory).toHaveBeenCalledWith(tempDir);
      expect(mockApiService.trackUsage).toHaveBeenCalledWith('directory_locked', {
        directoryPath: tempDir,
        totalLockedCount: 1
      });
    });

    it('should not add directory if already tracked', async () => {
      mockUserConfig.lockedDirectories = [tempDir];
      const { addLockedDirectory } = await import('../../../src/core/user-config.js');

      await trackFileLocked(testFile);

      expect(addLockedDirectory).not.toHaveBeenCalled();
      expect(mockApiService.trackUsage).not.toHaveBeenCalled();
    });

    it('should handle analytics errors gracefully', async () => {
      mockApiService.trackUsage.mockRejectedValue(new Error('Analytics failed'));
      
      await expect(trackFileLocked(testFile)).resolves.not.toThrow();
    });

    it('should log analytics errors in debug mode', async () => {
      process.env.AILOCK_DEBUG = 'true';
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation();
      mockApiService.trackUsage.mockRejectedValue(new Error('Analytics failed'));

      await trackFileLocked(testFile);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to track directory lock analytics')
      );
      
      consoleSpy.mockRestore();
    });

    it('should throw error if directory tracking fails', async () => {
      const { addLockedDirectory } = await import('../../../src/core/user-config.js');
      vi.mocked(addLockedDirectory).mockRejectedValue(new Error('Config save failed'));

      await expect(trackFileLocked(testFile)).rejects.toThrow(
        'Failed to track file lock'
      );
    });
  });

  describe('trackFileUnlocked', () => {
    beforeEach(async () => {
      // Create a .locked file to simulate locked file presence
      await writeFile(join(tempDir, 'test.locked'), '');
    });

    it('should remove directory from tracking when no locked files remain', async () => {
      // Remove the .locked file
      await rm(join(tempDir, 'test.locked'));
      
      const { removeLockedDirectory, getLockedDirectoryCount } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(0);

      await trackFileUnlocked(testFile);

      expect(removeLockedDirectory).toHaveBeenCalledWith(tempDir);
      expect(mockApiService.trackUsage).toHaveBeenCalledWith('directory_unlocked', {
        directoryPath: tempDir,
        totalLockedCount: 0
      });
    });

    it('should keep directory tracking when locked files remain', async () => {
      const { removeLockedDirectory } = await import('../../../src/core/user-config.js');

      await trackFileUnlocked(testFile);

      expect(removeLockedDirectory).not.toHaveBeenCalled();
      expect(mockApiService.trackUsage).not.toHaveBeenCalled();
    });

    it('should handle missing directory gracefully', async () => {
      const nonExistentFile = join(tempDir, 'nonexistent', 'file.txt');
      
      await expect(trackFileUnlocked(nonExistentFile)).resolves.not.toThrow();
    });

    it('should handle analytics errors gracefully', async () => {
      await rm(join(tempDir, 'test.locked')); // Remove locked file
      mockApiService.trackUsage.mockRejectedValue(new Error('Analytics failed'));
      
      await expect(trackFileUnlocked(testFile)).resolves.not.toThrow();
    });
  });

  describe('initializeUserConfig', () => {
    it('should set machine UUID if not already set', async () => {
      const { loadUserConfig, saveUserConfig } = await import('../../../src/core/user-config.js');
      const { getMachineUuid } = await import('../../../src/core/machine-id.js');

      await initializeUserConfig();

      expect(saveUserConfig).toHaveBeenCalledWith({
        ...mockUserConfig,
        machineUuid: 'test-machine-uuid'
      });
    });

    it('should not modify config if machine UUID already set', async () => {
      mockUserConfig.machineUuid = 'existing-uuid';
      const { saveUserConfig } = await import('../../../src/core/user-config.js');

      await initializeUserConfig();

      expect(saveUserConfig).not.toHaveBeenCalled();
    });
  });

  describe('getQuotaStatusSummary', () => {
    it('should return summary for no directories locked', async () => {
      const { getLockedDirectoryCount } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(0);

      const result = await getQuotaStatusSummary();

      expect(result).toBe('No directories locked yet (0/10 quota used)');
    });

    it('should return summary for directories within quota', async () => {
      const { getLockedDirectoryCount } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(3);

      const result = await getQuotaStatusSummary();

      expect(result).toBe('3/10 directories locked (7 remaining)');
    });

    it('should return summary for quota exceeded', async () => {
      const { getLockedDirectoryCount } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(12);

      const result = await getQuotaStatusSummary();

      expect(result).toBe('12/10 directories locked (quota exceeded)');
    });
  });

  describe('resetDirectoryTracking', () => {
    it('should clear all tracked directories', async () => {
      mockUserConfig.lockedDirectories = ['/path/1', '/path/2'];
      const { saveUserConfig } = await import('../../../src/core/user-config.js');

      await resetDirectoryTracking();

      expect(saveUserConfig).toHaveBeenCalledWith({
        ...mockUserConfig,
        lockedDirectories: []
      });
    });
  });

  describe('validateDirectoryTracking', () => {
    it('should return no issues for valid configuration', async () => {
      mockUserConfig.lockedDirectories = ['/absolute/path/1', '/absolute/path/2'];
      const { getLockedDirectoryCount } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(2);

      const issues = await validateDirectoryTracking();

      expect(issues).toEqual([]);
    });

    it('should detect duplicate directories', async () => {
      mockUserConfig.lockedDirectories = ['/path/1', '/path/2', '/path/1'];

      const issues = await validateDirectoryTracking();

      expect(issues).toContain('Duplicate directories found in tracking list');
    });

    it('should detect quota exceeded', async () => {
      const { getLockedDirectoryCount } = await import('../../../src/core/user-config.js');
      vi.mocked(getLockedDirectoryCount).mockResolvedValue(15);

      const issues = await validateDirectoryTracking();

      expect(issues).toContain('Directory usage (15) exceeds quota (10)');
    });

    it('should detect empty directory paths', async () => {
      mockUserConfig.lockedDirectories = ['/valid/path', '', '   '];

      const issues = await validateDirectoryTracking();

      expect(issues).toContain('Empty directory path found in tracking list');
    });

    it('should detect invalid directory paths', async () => {
      mockUserConfig.lockedDirectories = ['../relative/path', 'relative'];

      const issues = await validateDirectoryTracking();

      expect(issues).toContain('Invalid directory path found: ../relative/path');
    });
  });

  describe('repairDirectoryTracking', () => {
    it('should remove duplicate directories', async () => {
      mockUserConfig.lockedDirectories = ['/path/1', '/path/2', '/path/1'];
      const { saveUserConfig } = await import('../../../src/core/user-config.js');

      const result = await repairDirectoryTracking();

      expect(result.repaired).toBe(true);
      expect(result.issuesFixed).toContain('Removed duplicate directory entries');
      expect(saveUserConfig).toHaveBeenCalledWith({
        ...mockUserConfig,
        lockedDirectories: ['/path/1', '/path/2']
      });
    });

    it('should remove invalid paths', async () => {
      mockUserConfig.lockedDirectories = ['/valid/path', '', '../invalid'];
      const { saveUserConfig } = await import('../../../src/core/user-config.js');

      const result = await repairDirectoryTracking();

      expect(result.repaired).toBe(true);
      expect(result.issuesFixed).toContain('Removed 2 invalid directory path(s)');
    });

    it('should remove non-existent directories', async () => {
      const existingPath = tempDir;
      const nonExistentPath = '/non/existent/path';
      mockUserConfig.lockedDirectories = [existingPath, nonExistentPath];
      const { saveUserConfig } = await import('../../../src/core/user-config.js');

      const result = await repairDirectoryTracking();

      expect(result.repaired).toBe(true);
      expect(result.issuesFixed).toContain('Removed 1 non-existent directory path(s)');
      expect(saveUserConfig).toHaveBeenCalledWith({
        ...mockUserConfig,
        lockedDirectories: [existingPath]
      });
    });

    it('should handle repair errors', async () => {
      const { loadUserConfig } = await import('../../../src/core/user-config.js');
      vi.mocked(loadUserConfig).mockRejectedValue(new Error('Config load failed'));

      const result = await repairDirectoryTracking();

      expect(result.repaired).toBe(false);
      expect(result.issuesRemaining).toContain('Failed to repair directory tracking');
    });
  });

  describe('safeQuotaOperation', () => {
    it('should return successful result when operation succeeds', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await safeQuotaOperation(operation, 'test operation');

      expect(result).toEqual({
        success: true,
        result: 'success'
      });
    });

    it('should return error when operation fails', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Operation failed'));
      
      const result = await safeQuotaOperation(operation, 'test operation');

      expect(result).toEqual({
        success: false,
        error: 'test operation failed: Operation failed'
      });
    });

    it('should return fallback value when provided', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Operation failed'));
      
      const result = await safeQuotaOperation(operation, 'test operation', 'fallback');

      expect(result).toEqual({
        success: false,
        error: 'test operation failed: Operation failed',
        result: 'fallback'
      });
    });

    it('should log debug information when enabled', async () => {
      process.env.AILOCK_DEBUG = 'true';
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation();
      const operation = vi.fn().mockRejectedValue(new Error('Operation failed'));
      
      await safeQuotaOperation(operation, 'test operation');

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('test operation failed')
      );
      
      consoleSpy.mockRestore();
    });
  });
});