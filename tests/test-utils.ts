import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UserConfig } from '../src/core/user-config';

let testDirCounter = 0;

/**
 * Creates a unique test directory for isolated testing
 */
export async function createTestDirectory(prefix: string = 'test'): Promise<string> {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  const dirname = `${prefix}-${timestamp}-${random}-${testDirCounter++}`;
  const testDir = path.join(os.tmpdir(), 'ailock-tests', dirname);
  
  await fs.promises.mkdir(testDir, { recursive: true });
  return testDir;
}

/**
 * Cleans up a test directory
 */
export async function cleanupTestDirectory(testDir: string): Promise<void> {
  try {
    if (testDir && testDir.includes('ailock-tests')) {
      await fs.promises.rm(testDir, { recursive: true, force: true });
    }
  } catch (error) {
    // Ignore cleanup errors
  }
}

/**
 * Creates a mock user config for testing
 */
export function createMockUserConfig(overrides?: Partial<UserConfig>): UserConfig {
  return {
    version: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    directoryQuota: 5,
    lockedDirectories: [],
    protectedProjects: [],
    projectQuota: 5,
    privacyLevel: 'standard',
    telemetryConsent: false,
    auth: {
      apiKey: 'test-api-key',
      deviceId: 'test-device-id',
      sessionId: 'test-session-id'
    },
    ...overrides
  };
}

/**
 * Creates an isolated UserConfig instance for testing
 * This prevents tests from interfering with each other's quota
 */
export class IsolatedUserConfig {
  private config: UserConfig;
  private originalGetInstance: any;
  private originalConfigPath: string | undefined;

  constructor(overrides?: Partial<UserConfig>) {
    this.config = createMockUserConfig(overrides);
  }

  /**
   * Activates the isolated config for testing
   */
  activate(): void {
    // Store original values
    const userConfigModule = require('../src/core/user-config');
    this.originalGetInstance = userConfigModule.UserConfig.getInstance;
    this.originalConfigPath = process.env.AILOCK_CONFIG_PATH;
    
    // Set test config path to prevent reading actual user config
    process.env.AILOCK_CONFIG_PATH = '/tmp/ailock-test-config-' + Date.now() + '.json';
    
    // Mock getInstance to return our isolated config
    userConfigModule.UserConfig.getInstance = () => {
      return {
        ...this.config,
        save: async () => { /* no-op in tests */ },
        reload: async () => { /* no-op in tests */ },
        getProjectQuotaUsage: () => ({
          used: this.config.protectedProjects.length,
          total: this.config.projectQuota,
          remaining: this.config.projectQuota - this.config.protectedProjects.length,
          percentage: (this.config.protectedProjects.length / this.config.projectQuota) * 100
        }),
        canLockProject: () => 
          this.config.protectedProjects.length < this.config.projectQuota,
        trackProjectFileLocked: (filePath: string, project: any) => {
          // Add project if not exists
          if (!this.config.protectedProjects.find(p => p.id === project.id)) {
            this.config.protectedProjects.push(project);
          }
        },
        trackProjectFileUnlocked: (filePath: string) => {
          // Remove file from projects
          this.config.protectedProjects = this.config.protectedProjects.map(p => ({
            ...p,
            protectedPaths: p.protectedPaths.filter(path => path !== filePath)
          })).filter(p => p.protectedPaths.length > 0);
        }
      };
    };
  }

  /**
   * Deactivates the isolated config and restores original
   */
  deactivate(): void {
    if (this.originalGetInstance) {
      const userConfigModule = require('../src/core/user-config');
      userConfigModule.UserConfig.getInstance = this.originalGetInstance;
    }
    
    if (this.originalConfigPath !== undefined) {
      process.env.AILOCK_CONFIG_PATH = this.originalConfigPath;
    } else {
      delete process.env.AILOCK_CONFIG_PATH;
    }
  }

  /**
   * Updates the isolated config
   */
  update(updates: Partial<UserConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Gets the current config
   */
  getConfig(): UserConfig {
    return this.config;
  }
}

/**
 * Creates a test Git repository
 */
export async function createTestGitRepo(baseDir: string, name: string = 'test-repo'): Promise<string> {
  const repoDir = path.join(baseDir, name);
  await fs.promises.mkdir(repoDir, { recursive: true });
  
  // Create .git directory structure
  const gitDir = path.join(repoDir, '.git');
  await fs.promises.mkdir(gitDir, { recursive: true });
  await fs.promises.mkdir(path.join(gitDir, 'refs'), { recursive: true });
  await fs.promises.mkdir(path.join(gitDir, 'objects'), { recursive: true });
  
  // Create minimal git config
  await fs.promises.writeFile(
    path.join(gitDir, 'config'),
    '[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n'
  );
  
  // Create HEAD file
  await fs.promises.writeFile(
    path.join(gitDir, 'HEAD'),
    'ref: refs/heads/main\n'
  );
  
  return repoDir;
}

/**
 * Helper to create test files
 */
export async function createTestFile(dir: string, filename: string, content: string = 'test content'): Promise<string> {
  const filePath = path.join(dir, filename);
  const fileDir = path.dirname(filePath);
  
  await fs.promises.mkdir(fileDir, { recursive: true });
  await fs.promises.writeFile(filePath, content);
  
  return filePath;
}

/**
 * Helper to check if a file is locked (read-only)
 */
export async function isFileLocked(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.W_OK);
    return false; // File is writable, not locked
  } catch {
    return true; // File is not writable, locked
  }
}

/**
 * Mock Git detection for consistent testing
 */
export function mockGitDetection(mockImplementation?: (dir: string) => Promise<string | null>): void {
  const gitModule = require('../src/core/git');
  
  if (mockImplementation) {
    gitModule.getRepoRoot = mockImplementation;
  } else {
    // Default mock: detect .git directories
    gitModule.getRepoRoot = async (dir: string): Promise<string | null> => {
      let current = dir;
      while (current !== path.dirname(current)) {
        try {
          const gitPath = path.join(current, '.git');
          const stats = await fs.promises.stat(gitPath);
          if (stats.isDirectory()) {
            return current;
          }
        } catch {
          // Continue searching
        }
        current = path.dirname(current);
      }
      return null;
    };
  }
}

/**
 * Restore original Git detection
 */
export function restoreGitDetection(): void {
  // Re-require the module to restore original implementation
  delete require.cache[require.resolve('../src/core/git')];
  require('../src/core/git');
}