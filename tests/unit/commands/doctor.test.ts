import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import { createTestDirectory, cleanupTestDirectory } from '../../test-utils';
import { 
  loadUserConfig, 
  saveUserConfig, 
  migrateLegacyDirectoriesToProjects 
} from '../../../src/core/user-config';

describe('doctor command config cleanup', () => {
  let testDir: string;
  let originalCwd: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    testDir = await createTestDirectory('doctor-test');
    process.chdir(testDir);
    
    // Mock the user config path to use test directory
    vi.mock('../../../src/core/user-config', async (importOriginal) => {
      const actual = await importOriginal() as any;
      return {
        ...actual,
        getUserConfigPath: () => path.join(testDir, '.ailock', 'user-config.json'),
        getAilockConfigDir: () => path.join(testDir, '.ailock')
      };
    });
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await cleanupTestDirectory(testDir);
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('should detect and clean invalid paths in legacy configuration', async () => {
    // Create config directory
    const configDir = path.join(testDir, '.ailock');
    await fs.promises.mkdir(configDir, { recursive: true });
    
    // Create a valid directory for testing
    const validDir = path.join(testDir, 'valid-project');
    await fs.promises.mkdir(validDir, { recursive: true });
    
    // Create config with invalid paths
    const config = {
      version: '1',
      createdAt: new Date(),
      updatedAt: new Date(),
      directoryQuota: 5,
      projectQuota: 5,
      lockedDirectories: [
        '/home/user/project/file1.txt',  // Invalid path
        '/home/user/project/file2.txt',  // Invalid path
        validDir  // Valid path
      ],
      protectedProjects: [],
      machineUuid: 'test-uuid',
      analyticsEnabled: true
    };
    
    // Save the config
    const configPath = path.join(configDir, 'user-config.json');
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
    
    // Import the actual functions (not mocked versions)
    const userConfigModule = await import('../../../src/core/user-config');
    
    // Mock getUserConfigPath to return our test path
    const originalGetPath = userConfigModule.getUserConfigPath;
    (userConfigModule as any).getUserConfigPath = () => configPath;
    (userConfigModule as any).getAilockConfigDir = () => configDir;
    
    // Load config and verify invalid paths are present
    const loadedConfig = await userConfigModule.loadUserConfig();
    expect(loadedConfig.lockedDirectories).toBeDefined();
    
    // Filter out invalid paths (like doctor --fix would do)
    if (loadedConfig.lockedDirectories) {
      const validPaths = loadedConfig.lockedDirectories.filter(path => fs.existsSync(path));
      expect(validPaths).toHaveLength(1);
      expect(validPaths[0]).toBe(validDir);
      
      // Apply migration with only valid paths
      loadedConfig.lockedDirectories = validPaths;
      const migrated = await userConfigModule.migrateLegacyDirectoriesToProjects(loadedConfig);
      
      // Verify migration worked
      expect(migrated.version).toBe('2');
      expect(migrated.protectedProjects).toHaveLength(1);
      expect(migrated.protectedProjects[0].rootPath).toBe(validDir);
      
      // Clear legacy data and save
      migrated.lockedDirectories = [];
      await userConfigModule.saveUserConfig(migrated);
      
      // Reload and verify cleanup
      const cleanedConfig = await userConfigModule.loadUserConfig();
      expect(cleanedConfig.lockedDirectories).toHaveLength(0);
      expect(cleanedConfig.protectedProjects).toHaveLength(1);
    }
    
    // Restore original function
    (userConfigModule as any).getUserConfigPath = originalGetPath;
  });

  it('should remove invalid projects from configuration', async () => {
    // Create config directory
    const configDir = path.join(testDir, '.ailock');
    await fs.promises.mkdir(configDir, { recursive: true });
    
    // Create a valid project directory
    const validProjectDir = path.join(testDir, 'valid-project');
    await fs.promises.mkdir(validProjectDir, { recursive: true });
    
    // Create config with invalid project
    const config = {
      version: '2',
      createdAt: new Date(),
      updatedAt: new Date(),
      directoryQuota: 5,
      projectQuota: 5,
      lockedDirectories: [],
      protectedProjects: [
        {
          id: 'proj1',
          rootPath: '/invalid/project/path',  // Invalid path
          type: 'directory' as const,
          name: 'invalid-project',
          protectedPaths: ['file.txt'],
          createdAt: new Date(),
          lastAccessedAt: new Date()
        },
        {
          id: 'proj2',
          rootPath: validProjectDir,  // Valid path
          type: 'directory' as const,
          name: 'valid-project',
          protectedPaths: ['file.txt'],
          createdAt: new Date(),
          lastAccessedAt: new Date()
        }
      ],
      machineUuid: 'test-uuid',
      analyticsEnabled: true
    };
    
    // Save the config
    const configPath = path.join(configDir, 'user-config.json');
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
    
    // Import the actual functions
    const userConfigModule = await import('../../../src/core/user-config');
    
    // Mock getUserConfigPath to return our test path
    const originalGetPath = userConfigModule.getUserConfigPath;
    (userConfigModule as any).getUserConfigPath = () => configPath;
    (userConfigModule as any).getAilockConfigDir = () => configDir;
    
    // Load config
    const loadedConfig = await userConfigModule.loadUserConfig();
    
    // Filter out invalid projects (like doctor --fix would do)
    if (loadedConfig.protectedProjects) {
      const validProjects = loadedConfig.protectedProjects.filter(p => fs.existsSync(p.rootPath));
      expect(validProjects).toHaveLength(1);
      expect(validProjects[0].rootPath).toBe(validProjectDir);
      
      // Save cleaned config
      loadedConfig.protectedProjects = validProjects;
      await userConfigModule.saveUserConfig(loadedConfig);
      
      // Reload and verify cleanup
      const cleanedConfig = await userConfigModule.loadUserConfig();
      expect(cleanedConfig.protectedProjects).toHaveLength(1);
      expect(cleanedConfig.protectedProjects[0].rootPath).toBe(validProjectDir);
    }
    
    // Restore original function
    (userConfigModule as any).getUserConfigPath = originalGetPath;
  });
});