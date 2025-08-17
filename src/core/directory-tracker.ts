import { resolve, dirname, isAbsolute } from 'path';
import chalk from 'chalk';
import { 
  loadUserConfig, 
  saveUserConfig, 
  addLockedDirectory, 
  removeLockedDirectory,
  getLockedDirectoryCount,
  getUserQuota,
  isWithinQuota,
  setAnalyticsEnabled,
  setPrivacyLevel,
  // New project-based functions
  ProjectUnit,
  getProtectedProjects,
  getProtectedProjectCount,
  getProjectQuota,
  isWithinProjectQuota,
  addProtectedProject,
  removeProtectedProject,
  findProtectedProject,
  updateProjectProtectedPaths
} from './user-config.js';
import { 
  createProjectFromPath,
  findProjectRoot,
  findMatchingProject,
  getProjectDisplayPath,
  getProjectStats,
  consolidateProjects,
  isValidProjectRoot
} from './project-utils.js';
import { getApiService } from '../services/CliApiService.js';

/**
 * Show first-run privacy prompt and collect user consent
 */
async function showFirstRunPrivacyPrompt(): Promise<void> {
  // Skip privacy prompt during testing
  if (process.env.NODE_ENV === 'test' || process.env.VITEST === 'true') {
    return;
  }
  
  console.log(chalk.blue('\n🔒 Privacy & Analytics Settings'));
  console.log(chalk.gray('━'.repeat(50)));
  
  console.log(chalk.white('\nAilock collects basic usage analytics to improve the tool.'));
  console.log(chalk.gray('This includes:'));
  console.log(chalk.gray('  • Command usage (anonymous)'));
  console.log(chalk.gray('  • Error frequency (no sensitive data)'));
  console.log(chalk.gray('  • Feature adoption metrics'));
  
  console.log(chalk.gray('\nWe do NOT collect:'));
  console.log(chalk.gray('  • File names, paths, or content'));
  console.log(chalk.gray('  • Personal information'));
  console.log(chalk.gray('  • Auth tokens or credentials'));
  
  console.log(chalk.cyan('\n📊 Analytics are enabled by default.'));
  console.log(chalk.gray('You can change this anytime with:'));
  console.log(chalk.white('  ailock quota config --analytics false'));
  console.log(chalk.white('  ailock quota config --privacy enhanced'));
  
  console.log(chalk.green('\n✅ Privacy settings configured!'));
  console.log(chalk.gray('Continuing with your command...\n'));
}

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
  return config.lockedDirectories?.includes(directory) ?? false;
}

/**
 * Get all currently tracked directories (legacy compatibility)
 */
export async function getTrackedDirectories(): Promise<string[]> {
  const config = await loadUserConfig();
  
  // If using new project system, return root paths of projects
  if (config.protectedProjects && config.protectedProjects.length > 0) {
    return config.protectedProjects.map(p => p.rootPath);
  }
  
  // Fallback to legacy directories
  return [...(config.lockedDirectories || [])]; // Return copy to prevent mutation
}

/**
 * Get all currently protected projects
 */
export async function getProtectedProjectsList(): Promise<ProjectUnit[]> {
  return await getProtectedProjects();
}

/**
 * Get current directory quota usage information (legacy compatibility)
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
 * Get current project quota usage information
 */
export async function getProjectQuotaUsage(): Promise<{
  used: number;
  quota: number;
  available: number;
  withinQuota: boolean;
  projects: ProjectUnit[];
  stats: ReturnType<typeof getProjectStats>;
}> {
  const [used, quota, projects] = await Promise.all([
    getProtectedProjectCount(),
    getProjectQuota(),
    getProtectedProjects()
  ]);

  const stats = getProjectStats(projects);

  return {
    used,
    quota,
    available: Math.max(0, quota - used),
    withinQuota: used < quota,
    projects,
    stats
  };
}

/**
 * Check if locking a file would exceed the directory quota (legacy compatibility)
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
 * Check if locking a file would exceed the project quota
 * Returns true if within quota or file belongs to existing project
 */
export async function canLockProject(filePath: string): Promise<{
  canLock: boolean;
  reason?: string;
  project?: ProjectUnit;
  quotaUsage: Awaited<ReturnType<typeof getProjectQuotaUsage>>;
}> {
  const quotaUsage = await getProjectQuotaUsage();
  const existingProject = await findMatchingProject(filePath, quotaUsage.projects);

  // If file belongs to an existing project, we can always lock it
  if (existingProject) {
    return { canLock: true, project: existingProject, quotaUsage };
  }

  // Check if we have quota available for a new project
  if (quotaUsage.withinQuota) {
    // Create a new project for this file
    const newProject = await createProjectFromPath(filePath);
    
    // Validate that this is a legitimate project (not temp directory)
    if (!isValidProjectRoot(newProject.rootPath)) {
      return {
        canLock: false,
        reason: 'Cannot protect files in temporary or system directories',
        quotaUsage
      };
    }
    
    return { canLock: true, project: newProject, quotaUsage };
  }

  return {
    canLock: false,
    reason: `Project quota exceeded (${quotaUsage.used}/${quotaUsage.quota} projects). Get auth codes to protect more projects.`,
    quotaUsage
  };
}

/**
 * Track a file being locked (legacy directory-based tracking)
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
 * Track a file being locked (project-based tracking)
 */
export async function trackProjectFileLocked(filePath: string): Promise<ProjectUnit> {
  try {
    const normalizedPath = resolve(filePath);
    const projects = await getProtectedProjects();
    let project = await findMatchingProject(normalizedPath, projects);
    
    if (project) {
      // File belongs to existing project - update protected paths
      if (!project.protectedPaths.includes(normalizedPath)) {
        project.protectedPaths.push(normalizedPath);
        project.lastAccessedAt = new Date();
        await updateProjectProtectedPaths(project.rootPath, project.protectedPaths);
      }
    } else {
      // Create new project for this file
      project = await createProjectFromPath(normalizedPath);
      await addProtectedProject(project);
      
      // Track analytics event for new project protection
      try {
        const apiService = getApiService();
        await apiService.trackUsage('project_protected', {
          directoryPath: project.rootPath,
          totalLockedCount: await getProtectedProjectCount(),
          metadata: {
            projectType: project.type,
            projectName: project.name,
            projectRoot: getProjectDisplayPath(project.rootPath)
          }
        });
      } catch (analyticsError) {
        if (process.env.AILOCK_DEBUG === 'true') {
          console.log(`Debug: Failed to track project protection analytics: ${analyticsError instanceof Error ? analyticsError.message : String(analyticsError)}`);
        }
      }
    }
    
    return project;
  } catch (error) {
    throw new Error(`Failed to track project file lock for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
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
 * Track a file being unlocked (legacy directory-based tracking)
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
 * Track a file being unlocked (project-based tracking)
 */
export async function trackProjectFileUnlocked(filePath: string): Promise<void> {
  try {
    const normalizedPath = resolve(filePath);
    const projects = await getProtectedProjects();
    const project = await findMatchingProject(normalizedPath, projects);
    
    if (project) {
      // Remove the file from project's protected paths
      project.protectedPaths = project.protectedPaths.filter(path => path !== normalizedPath);
      
      if (project.protectedPaths.length === 0) {
        // No more protected files in this project - remove the project
        await removeProtectedProject(project.rootPath);
        
        // Track analytics event for project unprotection
        try {
          const apiService = getApiService();
          await apiService.trackUsage('project_unprotected', {
            directoryPath: project.rootPath,
            totalLockedCount: await getProtectedProjectCount(),
            metadata: {
              projectType: project.type,
              projectName: project.name,
              projectRoot: getProjectDisplayPath(project.rootPath)
            }
          });
        } catch (analyticsError) {
          if (process.env.AILOCK_DEBUG === 'true') {
            console.log(`Debug: Failed to track project unprotection analytics: ${analyticsError instanceof Error ? analyticsError.message : String(analyticsError)}`);
          }
        }
      } else {
        // Update the project with remaining protected paths
        project.lastAccessedAt = new Date();
        await updateProjectProtectedPaths(project.rootPath, project.protectedPaths);
      }
    }
  } catch (error) {
    throw new Error(`Failed to track project file unlock for ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Initialize user configuration with machine UUID if not already set
 */
export async function initializeUserConfig(): Promise<void> {
  const config = await loadUserConfig();
  let configChanged = false;
  
  // Set machine UUID if not already set
  if (!config.machineUuid) {
    const { getMachineUuid } = await import('./machine-id.js');
    config.machineUuid = await getMachineUuid();
    configChanged = true;
  }
  
  // Show first-run privacy prompt if not accepted
  if (!config.hasAcceptedPrivacyPolicy) {
    await showFirstRunPrivacyPrompt();
    config.hasAcceptedPrivacyPolicy = true;
    configChanged = true;
  }
  
  // Save config if any changes were made
  if (configChanged) {
    await saveUserConfig(config);
  }
}

/**
 * Get a summary of quota status for display (legacy compatibility)
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
 * Get a summary of project quota status for display
 */
export async function getProjectQuotaStatusSummary(): Promise<string> {
  const quotaUsage = await getProjectQuotaUsage();
  
  if (quotaUsage.used === 0) {
    return `No projects protected yet (0/${quotaUsage.quota} quota used)`;
  }
  
  if (quotaUsage.withinQuota) {
    return `${quotaUsage.used}/${quotaUsage.quota} projects protected (${quotaUsage.available} remaining)`;
  } else {
    return `${quotaUsage.used}/${quotaUsage.quota} projects protected (quota exceeded)`;
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
    
    // Check for duplicate directories (legacy compatibility)
    if (config.lockedDirectories) {
      const unique = new Set(config.lockedDirectories);
      if (unique.size !== config.lockedDirectories.length) {
        issues.push('Duplicate directories found in tracking list');
      }
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
    
    // Check if tracked directories contain invalid paths (legacy compatibility)
    if (config.lockedDirectories) {
      for (const directory of config.lockedDirectories) {
        if (!directory || directory.trim() === '') {
          issues.push('Empty directory path found in tracking list');
        }
        
        if (directory.includes('..') || !isAbsolute(directory)) {
          issues.push(`Invalid directory path found: ${directory}`);
        }
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
    
    // Remove duplicates (legacy compatibility)
    if (config.lockedDirectories) {
      const originalLength = config.lockedDirectories.length;
      config.lockedDirectories = [...new Set(config.lockedDirectories)];
      if (config.lockedDirectories.length !== originalLength) {
        issuesFixed.push('Removed duplicate directory entries');
        configChanged = true;
        repaired = true;
      }
    }
    
    // Remove empty or invalid paths (legacy compatibility)
    if (config.lockedDirectories) {
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