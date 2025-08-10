import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { getAilockConfigDir, getMachineFingerprint, isValidMachineUuid, sanitizeForLogging } from './machine-id.js';

/**
 * User configuration interface for growth system integration
 */
export interface UserConfig {
  machineUuid: string;
  authToken?: string;
  directoryQuota: number;
  lockedDirectories: string[];
  lastSyncAt?: Date;
  apiEndpoint?: string;
  offlineMode?: boolean;
  analyticsEnabled: boolean;
  version: string; // For config migrations
  machineFingerprint?: string; // Security validation
  privacyLevel?: 'minimal' | 'standard' | 'enhanced'; // Privacy controls
  telemetryOptOut?: boolean; // Opt-out from telemetry
}

/**
 * Default user configuration
 */
export const DEFAULT_USER_CONFIG: UserConfig = {
  machineUuid: '',
  directoryQuota: 2, // Default free tier: 2 directories
  lockedDirectories: [],
  analyticsEnabled: true,
  offlineMode: false,
  version: '1.0.0',
  privacyLevel: 'standard',
  telemetryOptOut: false
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
 * Get current user's directory quota
 */
export async function getUserQuota(): Promise<number> {
  const config = await loadUserConfig();
  return config.directoryQuota;
}

/**
 * Get locked directories count
 */
export async function getLockedDirectoryCount(): Promise<number> {
  const config = await loadUserConfig();
  return config.lockedDirectories.length;
}

/**
 * Check if user is within their directory quota
 */
export async function isWithinQuota(): Promise<boolean> {
  const [quota, lockedCount] = await Promise.all([
    getUserQuota(),
    getLockedDirectoryCount()
  ]);
  
  return lockedCount < quota;
}

/**
 * Add a directory to the locked directories list
 */
export async function addLockedDirectory(dirPath: string): Promise<void> {
  const config = await loadUserConfig();
  
  // Add directory if not already in list
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
  config.lockedDirectories = config.lockedDirectories.filter(dir => dir !== dirPath);
  await saveUserConfig(config);
}

/**
 * Update user's directory quota (typically after auth code redemption)
 */
export async function updateDirectoryQuota(newQuota: number): Promise<void> {
  const config = await loadUserConfig();
  config.directoryQuota = Math.max(0, newQuota); // Ensure non-negative
  config.lastSyncAt = new Date();
  await saveUserConfig(config);
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

  if (config.directoryQuota < 0) {
    errors.push('Directory quota must be non-negative');
  }

  if (!Array.isArray(config.lockedDirectories)) {
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
 * Repair corrupted user configuration
 * Attempts to fix issues automatically or reset to defaults
 */
export async function repairUserConfig(): Promise<{
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
    if (config.directoryQuota < 0) {
      config.directoryQuota = DEFAULT_USER_CONFIG.directoryQuota;
      issuesFixed.push('Reset negative directory quota to default');
      configChanged = true;
      repaired = true;
    }
    
    // Fix invalid locked directories array
    if (!Array.isArray(config.lockedDirectories)) {
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