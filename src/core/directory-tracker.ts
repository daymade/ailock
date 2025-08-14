import { resolve, dirname, isAbsolute } from 'path';
import { 
  loadUserConfig, 
  saveUserConfig, 
  addLockedDirectory, 
  removeLockedDirectory,
  getLockedDirectoryCount,
  getUserQuota,
  isWithinQuota
} from './user-config.js';
import { getApiService } from '../services/CliApiService.js';

/**
 * Normalize path for consistent storage and comparison
 */
function normalizePath(filePath: string): string {
  return resolve(filePath);
}

/**
 * Get the directory containing the file
 */
function getDirectoryForFile(filePath: string): string {
  const normalizedPath = normalizePath(filePath);
  return dirname(normalizedPath);
}

/**
 * Check if a directory is already being tracked as locked
 */
export async function isDirectoryTracked(filePath: string): Promise<boolean> {
  const config = await loadUserConfig();
  const directory = getDirectoryForFile(filePath);
  return config.lockedDirectories.includes(directory);
}

/**
 * Get all currently tracked directories
 */
export async function getTrackedDirectories(): Promise<string[]> {
  const config = await loadUserConfig();
  return [...config.lockedDirectories]; // Return copy to prevent mutation
}

/**
 * Get current directory quota usage information
 */
export async function getQuotaUsage(): Promise<{
  used: number;
  quota: number;
  available: number;
  withinQuota: boolean;
}> {
  const [used, quota] = await Promise.all([
    getLockedDirectoryCount(),
    getUserQuota()
  ]);

  return {
    used,
    quota,
    available: Math.max(0, quota - used),
    withinQuota: used < quota
  };
}

/**
 * Check if locking a file would exceed the directory quota
 * Returns true if within quota or directory already tracked
 */
export async function canLockFile(filePath: string): Promise<{
  canLock: boolean;
  reason?: string;
  quotaUsage: Awaited<ReturnType<typeof getQuotaUsage>>;
}> {
  const quotaUsage = await getQuotaUsage();
  const isAlreadyTracked = await isDirectoryTracked(filePath);

  // If directory is already tracked, we can always lock more files in it
  if (isAlreadyTracked) {
    return { canLock: true, quotaUsage };
  }

  // Check if we have quota available for a new directory
  if (quotaUsage.withinQuota) {
    return { canLock: true, quotaUsage };
  }

  return {
    canLock: false,
    reason: `Directory quota exceeded (${quotaUsage.used}/${quotaUsage.quota}). Visit the web portal to increase your quota.`,
    quotaUsage
  };
}

/**
 * Track a file being locked (adds directory to tracked list if not already present)
 */
export async function trackFileLocked(filePath: string): Promise<void> {
  try {
    const directory = getDirectoryForFile(filePath);
    const isAlreadyTracked = await isDirectoryTracked(filePath);
    
    if (!isAlreadyTracked) {
      await addLockedDirectory(directory);
      
      // Track analytics event for new directory lock (non-blocking)
      try {
        const apiService = getApiService();
        await apiService.trackUsage('directory_locked', {
          directoryPath: directory,
          totalLockedCount: await getLockedDirectoryCount()
        });
      } catch (analyticsError) {
        // Don't fail the main operation if analytics fail
        if (process.env.AILOCK_DEBUG === 'true') {
          console.log(`Debug: Failed to track directory lock analytics: ${analyticsError instanceof Error ? analyticsError.message : String(analyticsError)}`);
        }
      }
    }
  } catch (error) {
    throw new Error(`Failed to track file lock for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check if a directory still has locked files
 * Scans the directory for .locked files to determine if tracking should continue
 */
async function hasLockedFilesInDirectory(directory: string): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    const { existsSync } = await import('fs');
    
    if (!existsSync(directory)) {
      return false; // Directory doesn't exist, no locked files
    }
    
    const files = await fs.readdir(directory);
    
    // Check if any files in the directory have corresponding .locked files
    for (const file of files) {
      if (file.endsWith('.locked')) {
        return true; // Found at least one locked file
      }
    }
    
    return false; // No locked files found
  } catch (error) {
    // If we can't scan the directory, assume it still has locked files to be safe
    if (process.env.AILOCK_DEBUG === 'true') {
      console.log(`Debug: Cannot scan directory ${directory}: ${error instanceof Error ? error.message : String(error)}`);
    }
    return true;
  }
}

/**
 * Track a file being unlocked (removes directory from tracked list if no more locked files)
 */
export async function trackFileUnlocked(filePath: string): Promise<void> {
  try {
    const directory = getDirectoryForFile(filePath);
    
    // Check if this directory still has locked files
    const stillHasLockedFiles = await hasLockedFilesInDirectory(directory);
    
    if (!stillHasLockedFiles) {
      await removeLockedDirectory(directory);
      
      // Track analytics event for directory unlock (non-blocking)
      try {
        const apiService = getApiService();
        await apiService.trackUsage('directory_unlocked', {
          directoryPath: directory,
          totalLockedCount: await getLockedDirectoryCount()
        });
      } catch (analyticsError) {
        // Don't fail the main operation if analytics fail
        if (process.env.AILOCK_DEBUG === 'true') {
          console.log(`Debug: Failed to track directory unlock analytics: ${analyticsError instanceof Error ? analyticsError.message : String(analyticsError)}`);
        }
      }
    }
  } catch (error) {
    throw new Error(`Failed to track file unlock for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Initialize user configuration with machine UUID if not already set
 */
export async function initializeUserConfig(): Promise<void> {
  const config = await loadUserConfig();
  
  // Set machine UUID if not already set
  if (!config.machineUuid) {
    const { getMachineUuid } = await import('./machine-id.js');
    config.machineUuid = await getMachineUuid();
    await saveUserConfig(config);
  }
}

/**
 * Get a summary of quota status for display
 */
export async function getQuotaStatusSummary(): Promise<string> {
  const quotaUsage = await getQuotaUsage();
  
  if (quotaUsage.used === 0) {
    return `No directories locked yet (0/${quotaUsage.quota} quota used)`;
  }
  
  if (quotaUsage.withinQuota) {
    return `${quotaUsage.used}/${quotaUsage.quota} directories locked (${quotaUsage.available} remaining)`;
  } else {
    return `${quotaUsage.used}/${quotaUsage.quota} directories locked (quota exceeded)`;
  }
}

/**
 * Reset directory tracking (useful for testing)
 */
export async function resetDirectoryTracking(): Promise<void> {
  const config = await loadUserConfig();
  config.lockedDirectories = [];
  await saveUserConfig(config);
}

/**
 * Validate directory tracking consistency
 * Returns array of issues found
 */
export async function validateDirectoryTracking(): Promise<string[]> {
  const issues: string[] = [];
  
  try {
    const config = await loadUserConfig();
    
    // Check for duplicate directories
    const unique = new Set(config.lockedDirectories);
    if (unique.size !== config.lockedDirectories.length) {
      issues.push('Duplicate directories found in tracking list');
    }
    
    // Check for quota consistency
    try {
      const quotaUsage = await getQuotaUsage();
      if (quotaUsage.used > quotaUsage.quota) {
        issues.push(`Directory usage (${quotaUsage.used}) exceeds quota (${quotaUsage.quota})`);
      }
    } catch (quotaError) {
      issues.push(`Failed to validate quota consistency: ${quotaError instanceof Error ? quotaError.message : String(quotaError)}`);
    }
    
    // Check if tracked directories contain invalid paths
    for (const directory of config.lockedDirectories) {
      if (!directory || directory.trim() === '') {
        issues.push('Empty directory path found in tracking list');
      }
      
      if (directory.includes('..') || !isAbsolute(directory)) {
        issues.push(`Invalid directory path found: ${directory}`);
      }
    }
    
  } catch (error) {
    issues.push(`Failed to validate directory tracking: ${error instanceof Error ? error.message : String(error)}`);
  }
  
  return issues;
}

/**
 * Repair directory tracking issues
 * Attempts to fix common problems automatically
 */
export async function repairDirectoryTracking(): Promise<{
  repaired: boolean;
  issuesFixed: string[];
  issuesRemaining: string[];
}> {
  const issuesFixed: string[] = [];
  let repaired = false;
  
  try {
    const config = await loadUserConfig();
    const { existsSync } = await import('fs');
    let configChanged = false;
    
    // Remove duplicates
    const originalLength = config.lockedDirectories.length;
    config.lockedDirectories = [...new Set(config.lockedDirectories)];
    if (config.lockedDirectories.length !== originalLength) {
      issuesFixed.push('Removed duplicate directory entries');
      configChanged = true;
      repaired = true;
    }
    
    // Remove empty or invalid paths
    const invalidPaths: string[] = [];
    config.lockedDirectories = config.lockedDirectories.filter(directory => {
      if (!directory || directory.trim() === '') {
        invalidPaths.push('empty path');
        return false;
      }
      
      if (directory.includes('..') || !isAbsolute(directory)) {
        invalidPaths.push(directory);
        return false;
      }
      
      return true;
    });
    
    if (invalidPaths.length > 0) {
      issuesFixed.push(`Removed ${invalidPaths.length} invalid directory path(s)`);
      configChanged = true;
      repaired = true;
    }
    
    // Remove non-existent directories
    const nonExistentPaths: string[] = [];
    config.lockedDirectories = config.lockedDirectories.filter(directory => {
      if (!existsSync(directory)) {
        nonExistentPaths.push(directory);
        return false;
      }
      return true;
    });
    
    if (nonExistentPaths.length > 0) {
      issuesFixed.push(`Removed ${nonExistentPaths.length} non-existent directory path(s)`);
      if (process.env.AILOCK_DEBUG === 'true') {
        console.log('Debug: Removed non-existent directories:', nonExistentPaths);
      }
      configChanged = true;
      repaired = true;
    }
    
    // Save configuration if changes were made
    if (configChanged) {
      await saveUserConfig(config);
    }
    
    // Check what issues remain
    const issuesRemaining = await validateDirectoryTracking();
    
    return {
      repaired,
      issuesFixed,
      issuesRemaining
    };
    
  } catch (error) {
    return {
      repaired: false,
      issuesFixed: [],
      issuesRemaining: [`Failed to repair directory tracking: ${error instanceof Error ? error.message : String(error)}`]
    };
  }
}

/**
 * Safe quota operation wrapper
 * Handles common error scenarios gracefully
 */
export async function safeQuotaOperation<T>(
  operation: () => Promise<T>,
  operationName: string,
  fallbackValue?: T
): Promise<{ success: boolean; result?: T; error?: string }> {
  try {
    const result = await operation();
    return { success: true, result };
  } catch (error) {
    const errorMessage = `${operationName} failed: ${error instanceof Error ? error.message : String(error)}`;
    
    if (process.env.AILOCK_DEBUG === 'true') {
      console.log(`Debug: ${errorMessage}`);
    }
    
    return {
      success: false,
      error: errorMessage,
      result: fallbackValue
    };
  }
}