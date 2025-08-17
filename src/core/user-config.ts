import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getAilockConfigDir, getMachineFingerprint, isValidMachineUuid, sanitizeForLogging } from './machine-id.js';

/**
 * Project unit types for the new quota system
 */
export type ProjectType = 'git' | 'directory';

/**
 * A protected project unit (Git repository or standalone directory)
 */
export interface ProjectUnit {
  id: string;              // Unique identifier for the project
  rootPath: string;        // Absolute path to project root
  type: ProjectType;       // Git repository or standalone directory
  name: string;            // Display name for the project
  protectedPaths: string[]; // Files/directories protected within this project
  createdAt: Date;         // When this project was first protected
  lastAccessedAt?: Date;   // Last time files in this project were accessed
}

/**
 * User configuration interface for growth system integration
 */
export interface UserConfig {
  machineUuid: string;
  authToken?: string;
  // New project-based quota system
  projectQuota: number;          // Number of projects user can protect
  protectedProjects: ProjectUnit[]; // List of protected projects
  // Legacy fields (for migration compatibility)
  directoryQuota?: number;       // Legacy: will be migrated to projectQuota
  lockedDirectories?: string[];  // Legacy: will be migrated to protectedProjects
  // Other settings
  lastSyncAt?: Date;
  apiEndpoint?: string;
  offlineMode?: boolean;
  analyticsEnabled: boolean;
  version: string; // For config migrations
  machineFingerprint?: string; // Security validation
  privacyLevel?: 'minimal' | 'standard' | 'enhanced'; // Privacy controls
  telemetryOptOut?: boolean; // Opt-out from telemetry
  hasAcceptedPrivacyPolicy?: boolean; // First-run privacy consent
}

/**
 * Default user configuration
 */
export const DEFAULT_USER_CONFIG: UserConfig = {
  machineUuid: '',
  projectQuota: 2, // Default free tier: 2 projects
  protectedProjects: [],
  // Legacy compatibility
  directoryQuota: 2, 
  lockedDirectories: [],
  analyticsEnabled: true,
  offlineMode: false,
  version: '2.0.0', // Bumped for project-based quota system
  privacyLevel: 'standard',
  telemetryOptOut: false,
  hasAcceptedPrivacyPolicy: false
};

/**
 * Get the user config file path
 */
export function getUserConfigPath(): string {
  return join(getAilockConfigDir(), 'user-config.json');
}

/**
 * Load user configuration from disk
 * Creates default config if file doesn't exist
 */
export async function loadUserConfig(): Promise<UserConfig> {
  const configPath = getUserConfigPath();
  const configDir = getAilockConfigDir();

  try {
    // Create config directory if it doesn't exist
    if (!existsSync(configDir)) {
      await mkdir(configDir, { recursive: true });
    }

    // Load existing config if available
    if (existsSync(configPath)) {
      const configContent = await readFile(configPath, 'utf-8');
      const config = JSON.parse(configContent) as UserConfig;
      
      // Merge with defaults to handle version upgrades
      const mergedConfig = { ...DEFAULT_USER_CONFIG, ...config };
      
      // Convert date strings back to Date objects
      if (config.lastSyncAt && typeof config.lastSyncAt === 'string') {
        mergedConfig.lastSyncAt = new Date(config.lastSyncAt);
      }

      // Handle migration from old directory-based to project-based quota system
      const needsMigration = !config.protectedProjects || config.protectedProjects.length === 0;
      const hasLegacyData = config.lockedDirectories && config.lockedDirectories.length > 0;
      
      if (needsMigration && hasLegacyData) {
        await migrateLegacyDirectoriesToProjects(mergedConfig);
      }

      // Handle date conversion for projects
      if (mergedConfig.protectedProjects) {
        mergedConfig.protectedProjects = mergedConfig.protectedProjects.map(project => ({
          ...project,
          createdAt: typeof project.createdAt === 'string' ? new Date(project.createdAt) : project.createdAt,
          lastAccessedAt: project.lastAccessedAt && typeof project.lastAccessedAt === 'string' 
            ? new Date(project.lastAccessedAt) 
            : project.lastAccessedAt
        }));
      }

      return mergedConfig;
    }

    // Return default config if file doesn't exist
    return { ...DEFAULT_USER_CONFIG };
  } catch (error) {
    console.warn('Warning: Could not load user config, using defaults:', sanitizeForLogging(error instanceof Error ? error.message : String(error)));
    return { ...DEFAULT_USER_CONFIG };
  }
}

/**
 * Save user configuration to disk
 */
export async function saveUserConfig(config: UserConfig): Promise<void> {
  const configPath = getUserConfigPath();
  const configDir = getAilockConfigDir();

  try {
    // Ensure config directory exists
    if (!existsSync(configDir)) {
      await mkdir(configDir, { recursive: true });
    }

    // Write config with secure permissions
    await writeFile(configPath, JSON.stringify(config, null, 2), {
      encoding: 'utf-8',
      mode: 0o600 // Read/write for owner only
    });
  } catch (error) {
    throw new Error(`Failed to save user config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Get current user's directory quota (legacy compatibility)
 */
export async function getUserQuota(): Promise<number> {
  const config = await loadUserConfig();
  return config.directoryQuota ?? config.projectQuota;
}

/**
 * Get current user's project quota
 */
export async function getProjectQuota(): Promise<number> {
  const config = await loadUserConfig();
  return config.projectQuota;
}

/**
 * Get locked directories count (legacy compatibility)
 */
export async function getLockedDirectoryCount(): Promise<number> {
  const config = await loadUserConfig();
  return (config.lockedDirectories?.length ?? 0) || config.protectedProjects.length;
}

/**
 * Get protected projects count
 */
export async function getProtectedProjectCount(): Promise<number> {
  const config = await loadUserConfig();
  return config.protectedProjects.length;
}

/**
 * Get all protected projects
 */
export async function getProtectedProjects(): Promise<ProjectUnit[]> {
  const config = await loadUserConfig();
  return [...config.protectedProjects]; // Return copy to prevent mutation
}

/**
 * Check if user is within their directory quota (legacy compatibility)
 */
export async function isWithinQuota(): Promise<boolean> {
  const [quota, lockedCount] = await Promise.all([
    getUserQuota(),
    getLockedDirectoryCount()
  ]);
  
  return lockedCount < quota;
}

/**
 * Check if user is within their project quota
 */
export async function isWithinProjectQuota(): Promise<boolean> {
  const [quota, projectCount] = await Promise.all([
    getProjectQuota(),
    getProtectedProjectCount()
  ]);
  
  return projectCount < quota;
}

/**
 * Add a directory to the locked directories list
 */
export async function addLockedDirectory(dirPath: string): Promise<void> {
  const config = await loadUserConfig();
  
  // Add directory if not already in list (legacy compatibility)
  if (!config.lockedDirectories) {
    config.lockedDirectories = [];
  }
  if (!config.lockedDirectories.includes(dirPath)) {
    config.lockedDirectories.push(dirPath);
    await saveUserConfig(config);
  }
}

/**
 * Remove a directory from the locked directories list
 */
export async function removeLockedDirectory(dirPath: string): Promise<void> {
  const config = await loadUserConfig();
  
  // Remove directory from list
  if (config.lockedDirectories) {
    config.lockedDirectories = config.lockedDirectories.filter(dir => dir !== dirPath);
  }
  await saveUserConfig(config);
}

/**
 * Update user's directory quota (legacy compatibility)
 */
export async function updateDirectoryQuota(newQuota: number): Promise<void> {
  const config = await loadUserConfig();
  const validQuota = Math.max(0, newQuota); // Ensure non-negative
  config.directoryQuota = validQuota;
  config.projectQuota = validQuota; // Also update project quota
  config.lastSyncAt = new Date();
  await saveUserConfig(config);
}

/**
 * Update user's project quota (typically after auth code redemption)
 */
export async function updateProjectQuota(newQuota: number): Promise<void> {
  const config = await loadUserConfig();
  const validQuota = Math.max(0, newQuota); // Ensure non-negative
  config.projectQuota = validQuota;
  config.directoryQuota = validQuota; // Keep legacy in sync
  config.lastSyncAt = new Date();
  await saveUserConfig(config);
}

/**
 * Add a protected project
 */
export async function addProtectedProject(project: ProjectUnit): Promise<void> {
  const config = await loadUserConfig();
  
  // Check if project already exists (by rootPath)
  const existingIndex = config.protectedProjects.findIndex(p => p.rootPath === project.rootPath);
  if (existingIndex >= 0) {
    // Update existing project
    config.protectedProjects[existingIndex] = { ...project };
  } else {
    // Add new project
    config.protectedProjects.push(project);
  }
  
  await saveUserConfig(config);
}

/**
 * Remove a protected project by root path
 */
export async function removeProtectedProject(rootPath: string): Promise<void> {
  const config = await loadUserConfig();
  config.protectedProjects = config.protectedProjects.filter(p => p.rootPath !== rootPath);
  await saveUserConfig(config);
}

/**
 * Find a protected project by root path
 */
export async function findProtectedProject(rootPath: string): Promise<ProjectUnit | null> {
  const config = await loadUserConfig();
  return config.protectedProjects.find(p => p.rootPath === rootPath) || null;
}

/**
 * Update protected paths for a project
 */
export async function updateProjectProtectedPaths(rootPath: string, protectedPaths: string[]): Promise<void> {
  const config = await loadUserConfig();
  const project = config.protectedProjects.find(p => p.rootPath === rootPath);
  if (project) {
    project.protectedPaths = [...protectedPaths];
    project.lastAccessedAt = new Date();
    await saveUserConfig(config);
  }
}

/**
 * Set user's auth token
 */
export async function setAuthToken(token: string): Promise<void> {
  const config = await loadUserConfig();
  config.authToken = token;
  config.lastSyncAt = new Date();
  await saveUserConfig(config);
}

/**
 * Clear user's auth token
 */
export async function clearAuthToken(): Promise<void> {
  const config = await loadUserConfig();
  delete config.authToken;
  config.lastSyncAt = new Date();
  await saveUserConfig(config);
}

/**
 * Update user's machine UUID in config
 */
export async function updateMachineUuid(uuid: string): Promise<void> {
  const config = await loadUserConfig();
  config.machineUuid = uuid;
  await saveUserConfig(config);
}

/**
 * Set analytics preference
 */
export async function setAnalyticsEnabled(enabled: boolean): Promise<void> {
  const config = await loadUserConfig();
  config.analyticsEnabled = enabled;
  await saveUserConfig(config);
}

/**
 * Get analytics preference
 */
export async function getAnalyticsEnabled(): Promise<boolean> {
  const config = await loadUserConfig();
  return config.analyticsEnabled;
}

/**
 * Set offline mode
 */
export async function setOfflineMode(offline: boolean): Promise<void> {
  const config = await loadUserConfig();
  config.offlineMode = offline;
  await saveUserConfig(config);
}

/**
 * Get offline mode status
 */
export async function getOfflineMode(): Promise<boolean> {
  const config = await loadUserConfig();
  return config.offlineMode || false;
}

/**
 * Set privacy level
 */
export async function setPrivacyLevel(level: 'minimal' | 'standard' | 'enhanced'): Promise<void> {
  const config = await loadUserConfig();
  config.privacyLevel = level;
  
  // Adjust other settings based on privacy level
  switch (level) {
    case 'minimal':
      // Most permissive
      config.analyticsEnabled = true;
      config.telemetryOptOut = false;
      break;
    case 'standard':
      // Default settings
      config.analyticsEnabled = true;
      config.telemetryOptOut = false;
      break;
    case 'enhanced':
      // Most private
      config.analyticsEnabled = false;
      config.telemetryOptOut = true;
      break;
  }
  
  await saveUserConfig(config);
}

/**
 * Get privacy level
 */
export async function getPrivacyLevel(): Promise<'minimal' | 'standard' | 'enhanced'> {
  const config = await loadUserConfig();
  return config.privacyLevel || 'standard';
}

/**
 * Set telemetry opt-out
 */
export async function setTelemetryOptOut(optOut: boolean): Promise<void> {
  const config = await loadUserConfig();
  config.telemetryOptOut = optOut;
  await saveUserConfig(config);
}

/**
 * Get telemetry opt-out status
 */
export async function getTelemetryOptOut(): Promise<boolean> {
  const config = await loadUserConfig();
  return config.telemetryOptOut || false;
}

/**
 * Validate machine fingerprint for security
 * Returns true if the configuration appears to be on the same machine
 */
export async function validateMachineFingerprint(): Promise<boolean> {
  const config = await loadUserConfig();
  
  if (!config.machineFingerprint) {
    // First time - set the fingerprint
    config.machineFingerprint = getMachineFingerprint();
    await saveUserConfig(config);
    return true;
  }
  
  const currentFingerprint = getMachineFingerprint();
  return config.machineFingerprint === currentFingerprint;
}

/**
 * Check if analytics should be collected based on privacy settings
 */
export async function shouldCollectAnalytics(): Promise<boolean> {
  const config = await loadUserConfig();
  
  // Check telemetry opt-out first
  if (config.telemetryOptOut) {
    return false;
  }
  
  // Check analytics enabled
  if (!config.analyticsEnabled) {
    return false;
  }
  
  // Check privacy level
  const privacyLevel = config.privacyLevel || 'standard';
  if (privacyLevel === 'enhanced') {
    return false;
  }
  
  return true;
}

/**
 * Sanitize user config for safe logging/transmission
 */
export function sanitizeUserConfig(config: UserConfig): Partial<UserConfig> {
  const sanitized: Partial<UserConfig> = {
    directoryQuota: config.directoryQuota,
    analyticsEnabled: config.analyticsEnabled,
    offlineMode: config.offlineMode,
    version: config.version,
    privacyLevel: config.privacyLevel,
    telemetryOptOut: config.telemetryOptOut
  };
  
  // Only include machine UUID if it's valid format and user allows analytics
  if (isValidMachineUuid(config.machineUuid) && config.analyticsEnabled && !config.telemetryOptOut) {
    sanitized.machineUuid = config.machineUuid;
  }
  
  // Don't include sensitive information
  // authToken, lockedDirectories, machineFingerprint are excluded
  
  return sanitized;
}

/**
 * Get user configuration for debugging
 */
export async function getUserConfigDebugInfo(): Promise<Omit<UserConfig, 'authToken'>> {
  const config = await loadUserConfig();
  // Remove sensitive information for debug output
  const { authToken, ...debugConfig } = config;
  return debugConfig;
}

/**
 * Reset user configuration to defaults (useful for testing)
 */
export async function resetUserConfig(): Promise<void> {
  const config = { ...DEFAULT_USER_CONFIG };
  await saveUserConfig(config);
}

/**
 * Validate user configuration integrity
 */
export function validateUserConfig(config: UserConfig): string[] {
  const errors: string[] = [];

  if (!config.machineUuid) {
    errors.push('Machine UUID is required');
  }

  // Validate project quota
  if (config.projectQuota < 0) {
    errors.push('Project quota must be non-negative');
  }

  // Validate protected projects array
  if (!Array.isArray(config.protectedProjects)) {
    errors.push('Protected projects must be an array');
  } else {
    // Validate each project
    config.protectedProjects.forEach((project, index) => {
      if (!project.id || typeof project.id !== 'string') {
        errors.push(`Protected project ${index}: ID is required and must be a string`);
      }
      if (!project.rootPath || typeof project.rootPath !== 'string') {
        errors.push(`Protected project ${index}: Root path is required and must be a string`);
      }
      if (!project.type || !['git', 'directory'].includes(project.type)) {
        errors.push(`Protected project ${index}: Type must be 'git' or 'directory'`);
      }
      if (!project.name || typeof project.name !== 'string') {
        errors.push(`Protected project ${index}: Name is required and must be a string`);
      }
      if (!Array.isArray(project.protectedPaths)) {
        errors.push(`Protected project ${index}: Protected paths must be an array`);
      }
      if (!project.createdAt || !(project.createdAt instanceof Date)) {
        errors.push(`Protected project ${index}: Created date is required and must be a Date`);
      }
    });
  }

  // Legacy compatibility validation
  if (config.directoryQuota !== undefined && config.directoryQuota < 0) {
    errors.push('Directory quota must be non-negative');
  }

  if (config.lockedDirectories !== undefined && !Array.isArray(config.lockedDirectories)) {
    errors.push('Locked directories must be an array');
  }

  if (typeof config.analyticsEnabled !== 'boolean') {
    errors.push('Analytics enabled must be a boolean');
  }

  if (config.authToken && typeof config.authToken !== 'string') {
    errors.push('Auth token must be a string if provided');
  }

  if (!config.version) {
    errors.push('Configuration version is required');
  }

  return errors;
}

/**
 * Create backup of user configuration
 */
export async function backupUserConfig(): Promise<string> {
  try {
    const config = await loadUserConfig();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(getAilockConfigDir(), `user-config-backup-${timestamp}.json`);
    
    await writeFile(backupPath, JSON.stringify(config, null, 2), {
      encoding: 'utf-8',
      mode: 0o600
    });
    
    return backupPath;
  } catch (error) {
    throw new Error(`Failed to backup user config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Restore user configuration from backup
 */
export async function restoreUserConfig(backupPath: string): Promise<void> {
  try {
    const backupContent = await readFile(backupPath, 'utf-8');
    const backupConfig = JSON.parse(backupContent) as UserConfig;
    
    // Validate backup before restoring
    const validationErrors = validateUserConfig(backupConfig);
    if (validationErrors.length > 0) {
      throw new Error(`Invalid backup configuration: ${validationErrors.join(', ')}`);
    }
    
    await saveUserConfig(backupConfig);
  } catch (error) {
    throw new Error(`Failed to restore user config: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Repair a user config object (synchronous version for testing)
 */
export function repairUserConfig(config: UserConfig): UserConfig {
  const repaired = { ...config };
  
  // Fix version
  if (!repaired.version || typeof repaired.version !== 'string' || !['1', '2', '2.0.0'].includes(repaired.version)) {
    repaired.version = '2';
  }
  
  // Fix machine UUID
  if (!repaired.machineUuid) {
    repaired.machineUuid = '';
  }
  
  // Fix quotas
  if (typeof repaired.projectQuota !== 'number' || repaired.projectQuota < 0) {
    repaired.projectQuota = 5;
  }
  if (repaired.directoryQuota !== undefined && (typeof repaired.directoryQuota !== 'number' || repaired.directoryQuota < 0)) {
    repaired.directoryQuota = 5;
  }
  
  // Fix arrays
  if (!Array.isArray(repaired.protectedProjects)) {
    repaired.protectedProjects = [];
  } else {
    // Filter out invalid projects and remove duplicates
    const seenIds = new Set<string>();
    const seenPaths = new Set<string>();
    repaired.protectedProjects = repaired.protectedProjects.filter(project => {
      if (!project || typeof project !== 'object') return false;
      if (!project.id || !project.rootPath || !project.type || !project.name) return false;
      if (!['git', 'directory'].includes(project.type)) return false;
      
      // Remove duplicates by ID
      if (seenIds.has(project.id)) return false;
      
      // Consolidate duplicates by path - keep first occurrence
      if (seenPaths.has(project.rootPath)) return false;
      
      seenIds.add(project.id);
      seenPaths.add(project.rootPath);
      
      // Fix protected paths
      if (!Array.isArray(project.protectedPaths)) {
        project.protectedPaths = [];
      }
      
      return true;
    });
  }
  
  if (!Array.isArray(repaired.lockedDirectories)) {
    repaired.lockedDirectories = [];
  } else {
    repaired.lockedDirectories = repaired.lockedDirectories.filter(dir => 
      dir && typeof dir === 'string'
    );
  }
  
  // Fix booleans
  if (typeof repaired.analyticsEnabled !== 'boolean') {
    repaired.analyticsEnabled = false;
  }
  
  if (repaired.telemetryOptOut !== undefined && typeof repaired.telemetryOptOut !== 'boolean') {
    repaired.telemetryOptOut = false;
  }
  
  // Fix privacy level
  if (repaired.privacyLevel && !['minimal', 'standard', 'enhanced'].includes(repaired.privacyLevel)) {
    repaired.privacyLevel = 'standard';
  }
  
  // Fix dates
  if (repaired.lastSyncAt && !(repaired.lastSyncAt instanceof Date)) {
    if (typeof repaired.lastSyncAt === 'string') {
      try {
        repaired.lastSyncAt = new Date(repaired.lastSyncAt);
      } catch {
        delete repaired.lastSyncAt;
      }
    } else {
      delete repaired.lastSyncAt;
    }
  }
  
  // Fix auth token type
  if (repaired.authToken !== undefined && typeof repaired.authToken !== 'string') {
    delete repaired.authToken;
  }
  
  return repaired;
}

/**
 * Repair corrupted user configuration (async version)
 * Attempts to fix issues automatically or reset to defaults
 */
export async function repairUserConfigAsync(): Promise<{
  repaired: boolean;
  issuesFixed: string[];
  hadToReset: boolean;
}> {
  const issuesFixed: string[] = [];
  let repaired = false;
  let hadToReset = false;
  
  try {
    // Try to load the config first
    let config: UserConfig;
    try {
      config = await loadUserConfig();
    } catch (loadError) {
      // If config can't be loaded at all, create a backup of the corrupted file and reset
      const configPath = getUserConfigPath();
      if (existsSync(configPath)) {
        try {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const corruptedBackupPath = join(getAilockConfigDir(), `corrupted-config-${timestamp}.json`);
          await writeFile(corruptedBackupPath, await readFile(configPath, 'utf-8'));
          issuesFixed.push(`Backed up corrupted config to ${corruptedBackupPath}`);
        } catch {
          // Ignore backup errors
        }
      }
      
      config = { ...DEFAULT_USER_CONFIG };
      await saveUserConfig(config);
      issuesFixed.push('Reset to default configuration due to corruption');
      hadToReset = true;
      repaired = true;
      
      return { repaired, issuesFixed, hadToReset };
    }
    
    // Validate the loaded config
    const validationErrors = validateUserConfig(config);
    if (validationErrors.length === 0) {
      return { repaired: false, issuesFixed: [], hadToReset: false };
    }
    
    // Attempt to fix validation errors
    let configChanged = false;
    
    // Fix missing machine UUID
    if (!config.machineUuid) {
      const { getMachineUuid } = await import('./machine-id.js');
      config.machineUuid = await getMachineUuid();
      issuesFixed.push('Generated missing machine UUID');
      configChanged = true;
      repaired = true;
    }
    
    // Fix negative quota
    if (config.directoryQuota !== undefined && config.directoryQuota < 0) {
      config.directoryQuota = DEFAULT_USER_CONFIG.directoryQuota ?? 2;
      issuesFixed.push('Reset negative directory quota to default');
      configChanged = true;
      repaired = true;
    }
    
    // Fix invalid locked directories array
    if (config.lockedDirectories !== undefined && !Array.isArray(config.lockedDirectories)) {
      config.lockedDirectories = [];
      issuesFixed.push('Reset invalid locked directories array');
      configChanged = true;
      repaired = true;
    }
    
    // Fix invalid analytics setting
    if (typeof config.analyticsEnabled !== 'boolean') {
      config.analyticsEnabled = DEFAULT_USER_CONFIG.analyticsEnabled;
      issuesFixed.push('Reset invalid analytics setting');
      configChanged = true;
      repaired = true;
    }
    
    // Fix missing version
    if (!config.version) {
      config.version = DEFAULT_USER_CONFIG.version;
      issuesFixed.push('Added missing configuration version');
      configChanged = true;
      repaired = true;
    }
    
    // Save repaired configuration
    if (configChanged) {
      await saveUserConfig(config);
    }
    
    return { repaired, issuesFixed, hadToReset };
    
  } catch (error) {
    // If repair fails, try to reset to defaults as last resort
    try {
      await resetUserConfig();
      return {
        repaired: true,
        issuesFixed: [`Failed to repair config, reset to defaults: ${error instanceof Error ? error.message : String(error)}`],
        hadToReset: true
      };
    } catch (resetError) {
      throw new Error(`Critical error: Cannot repair or reset user config: ${resetError instanceof Error ? resetError.message : String(resetError)}`);
    }
  }
}

/**
 * Migrate legacy lockedDirectories to protectedProjects
 */
export async function migrateLegacyDirectoriesToProjects(config: UserConfig): Promise<UserConfig> {
  // Clone config to avoid mutations
  const migratedConfig = { ...config };
  
  // Update version
  migratedConfig.version = '2';
  
  // If no legacy directories, just return with updated version
  if (!config.lockedDirectories || config.lockedDirectories.length === 0) {
    return migratedConfig;
  }

  // Import dependencies dynamically to avoid circular dependencies
  const { getRepoRoot } = await import('./git.js');
  const { existsSync, statSync } = await import('fs');
  const { basename, dirname, resolve, relative } = await import('path');
  const crypto = await import('crypto');
  const { filterTempDirectories, isValidProjectRoot } = await import('./project-utils.js');

  // Filter out temp directories
  const validPaths = filterTempDirectories(config.lockedDirectories);
  
  // Start with existing projects or empty array
  const projectsMap = new Map<string, ProjectUnit>();
  
  // Add existing projects to map
  if (config.protectedProjects) {
    for (const project of config.protectedProjects) {
      projectsMap.set(project.rootPath, project);
    }
  }

  // Process each legacy path
  for (const filePath of validPaths) {
    // Skip invalid paths
    if (!filePath || typeof filePath !== 'string') {
      continue;
    }

    try {
      // Determine if this is a file or directory
      let targetPath = filePath;
      let relativePath = '.';
      
      if (existsSync(filePath)) {
        const stats = statSync(filePath);
        if (stats.isFile()) {
          // For files, get the parent directory as the project root
          targetPath = dirname(filePath);
          relativePath = basename(filePath);
        }
      } else {
        // If path doesn't exist, assume it's a file and get parent directory
        targetPath = dirname(filePath);
        relativePath = basename(filePath);
      }
      
      // Skip invalid project roots
      if (!isValidProjectRoot(targetPath)) {
        continue;
      }

      // Check if this path is part of a Git repository
      const repoRoot = await getRepoRoot(targetPath);
      const projectRoot = repoRoot || targetPath;
      const projectType: ProjectType = repoRoot ? 'git' : 'directory';
      
      // Check if we already have a project for this root
      if (projectsMap.has(projectRoot)) {
        const existingProject = projectsMap.get(projectRoot)!;
        
        // Calculate relative path from project root
        const relPath = repoRoot 
          ? relative(repoRoot, filePath)
          : relativePath;
        
        // Add to protected paths if not already there
        if (!existingProject.protectedPaths.includes(relPath)) {
          existingProject.protectedPaths.push(relPath);
        }
        
        // Update last accessed time
        existingProject.lastAccessedAt = new Date();
      } else {
        // Create new project
        const projectId = crypto.randomUUID();
        const projectName = basename(projectRoot) || 'project';
        
        // Calculate relative path from project root
        const relPath = repoRoot 
          ? relative(repoRoot, filePath)
          : relativePath;
        
        const newProject: ProjectUnit = {
          id: projectId,
          rootPath: projectRoot,
          type: projectType,
          name: projectName,
          protectedPaths: [relPath],
          createdAt: new Date(),
          lastAccessedAt: new Date()
        };
        
        projectsMap.set(projectRoot, newProject);
      }
    } catch (error) {
      // Log error but continue with other paths
      if (process.env.AILOCK_DEBUG === 'true') {
        console.log(`Debug: Failed to process path ${filePath} during migration: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  // Convert map to array
  migratedConfig.protectedProjects = Array.from(projectsMap.values());
  
  // Update project quota if not set
  if (!migratedConfig.projectQuota) {
    migratedConfig.projectQuota = migratedConfig.directoryQuota || 5;
  }
  
  if (process.env.AILOCK_DEBUG === 'true') {
    console.log(`Debug: Migrated ${config.lockedDirectories.length} paths to ${migratedConfig.protectedProjects.length} projects`);
  }
  
  // Note: We don't save here as this is a pure function for testing
  // The caller should save if needed
  return migratedConfig;
}

/**
 * Safe configuration operation wrapper
 */
export async function safeConfigOperation<T>(
  operation: () => Promise<T>,
  operationName: string,
  fallbackValue?: T
): Promise<{ success: boolean; result?: T; error?: string }> {
  try {
    const result = await operation();
    return { success: true, result };
  } catch (error) {
    const errorMessage = `Config operation '${operationName}' failed: ${error instanceof Error ? error.message : String(error)}`;
    
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