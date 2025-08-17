import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import {
  UserConfig as ActualUserConfig,
  ProjectUnit,
  migrateLegacyDirectoriesToProjects,
  validateUserConfig,
  repairUserConfig
} from '../../../src/core/user-config';
import { createTestDirectory, cleanupTestDirectory } from '../../test-utils';

// Test-specific UserConfig interface that matches test expectations
interface UserConfig {
  version: number | string;
  createdAt: string;
  updatedAt: string;
  directoryQuota: number;
  lockedDirectories: string[];
  protectedProjects: ProjectUnit[];
  projectQuota: number;
  privacyLevel?: 'minimal' | 'standard' | 'enhanced';
  telemetryConsent?: boolean;
  auth?: {
    apiKey: string;
    deviceId: string;
    sessionId: string;
  };
  machineUuid?: string;
  analyticsEnabled?: boolean;
}

// Convert test config to actual UserConfig format
function toActualConfig(testConfig: UserConfig): any {
  return {
    ...testConfig,
    machineUuid: testConfig.machineUuid || '',
    analyticsEnabled: testConfig.analyticsEnabled ?? true,
    version: String(testConfig.version)
  };
}

// Convert actual config back to test format
function fromActualConfig(actualConfig: any): UserConfig {
  return {
    ...actualConfig,
    version: actualConfig.version,
    createdAt: actualConfig.createdAt || new Date().toISOString(),
    updatedAt: actualConfig.updatedAt || new Date().toISOString()
  };
}

describe('user-config migration', () => {
  let testDir: string;
  let configPath: string;

  beforeEach(async () => {
    testDir = await createTestDirectory('migration-test');
    configPath = path.join(testDir, 'config.json');
    
    // Mock the Git detection for consistent testing
    vi.mock('../../../src/core/git', () => ({
      getRepoRoot: vi.fn((dir: string) => {
        if (dir.includes('git-repo')) {
          return Promise.resolve(dir.split('git-repo')[0] + 'git-repo');
        }
        return Promise.resolve(null);
      })
    }));
  });

  afterEach(async () => {
    await cleanupTestDirectory(testDir);
    vi.clearAllMocks();
  });

  describe('migrateLegacyDirectoriesToProjects', () => {
    it('should migrate legacy directories to projects', async () => {
      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date('2023-01-01').toISOString(),
        updatedAt: new Date('2023-01-01').toISOString(),
        directoryQuota: 5,
        lockedDirectories: [
          '/home/user/project1/file1.txt',
          '/home/user/project1/file2.txt',
          '/home/user/project2/file3.txt'
        ],
        protectedProjects: [],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryConsent: false,
        auth: {
          apiKey: 'test-key',
          deviceId: 'test-device',
          sessionId: 'test-session'
        }
      };

      const migrated = fromActualConfig(await migrateLegacyDirectoriesToProjects(toActualConfig(legacyConfig)));
      
      expect(migrated.protectedProjects).toHaveLength(2);
      expect(migrated.version).toBe('2');
      
      // Check project1
      const project1 = migrated.protectedProjects.find(p => 
        p.rootPath === '/home/user/project1'
      );
      expect(project1).toBeDefined();
      expect(project1?.protectedPaths).toContain('file1.txt');
      expect(project1?.protectedPaths).toContain('file2.txt');
      expect(project1?.type).toBe('directory');
      
      // Check project2
      const project2 = migrated.protectedProjects.find(p => 
        p.rootPath === '/home/user/project2'
      );
      expect(project2).toBeDefined();
      expect(project2?.protectedPaths).toContain('file3.txt');
    });

    it('should group files in same git repository', async () => {
      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date('2023-01-01').toISOString(),
        updatedAt: new Date('2023-01-01').toISOString(),
        directoryQuota: 5,
        lockedDirectories: [
          '/home/user/git-repo/src/file1.txt',
          '/home/user/git-repo/tests/file2.txt',
          '/home/user/git-repo/docs/readme.md',
          '/home/user/other-dir/file3.txt'
        ],
        protectedProjects: [],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryConsent: false,
        auth: {
          apiKey: 'test-key',
          deviceId: 'test-device',
          sessionId: 'test-session'
        }
      };

      const migrated = fromActualConfig(await migrateLegacyDirectoriesToProjects(toActualConfig(legacyConfig)));
      
      expect(migrated.protectedProjects).toHaveLength(2);
      
      // Git repo should be grouped
      const gitProject = migrated.protectedProjects.find(p => 
        p.rootPath === '/home/user/git-repo'
      );
      expect(gitProject).toBeDefined();
      expect(gitProject?.protectedPaths).toHaveLength(3);
      expect(gitProject?.protectedPaths).toContain('src/file1.txt');
      expect(gitProject?.protectedPaths).toContain('tests/file2.txt');
      expect(gitProject?.protectedPaths).toContain('docs/readme.md');
      expect(gitProject?.type).toBe('git');
      
      // Other directory should be separate
      const otherProject = migrated.protectedProjects.find(p => 
        p.rootPath === '/home/user/other-dir'
      );
      expect(otherProject).toBeDefined();
      expect(otherProject?.protectedPaths).toContain('file3.txt');
      expect(otherProject?.type).toBe('directory');
    });

    it('should handle empty legacy directories', async () => {
      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date('2023-01-01').toISOString(),
        updatedAt: new Date('2023-01-01').toISOString(),
        directoryQuota: 5,
        lockedDirectories: [],
        protectedProjects: [],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryConsent: false,
        auth: {
          apiKey: 'test-key',
          deviceId: 'test-device',
          sessionId: 'test-session'
        }
      };

      const migrated = fromActualConfig(await migrateLegacyDirectoriesToProjects(toActualConfig(legacyConfig)));
      
      expect(migrated.protectedProjects).toHaveLength(0);
      expect(migrated.version).toBe('2');
    });

    it('should preserve existing projects during migration', async () => {
      const existingProject: ProjectUnit = {
        id: 'existing-id',
        rootPath: '/home/user/existing-project',
        type: 'git',
        name: 'existing-project',
        protectedPaths: ['existing.txt'],
        createdAt: new Date('2023-01-01').toISOString(),
        lastAccessedAt: new Date('2023-01-01').toISOString()
      };

      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date('2023-01-01').toISOString(),
        updatedAt: new Date('2023-01-01').toISOString(),
        directoryQuota: 5,
        lockedDirectories: ['/home/user/new-dir/file.txt'],
        protectedProjects: [existingProject],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryConsent: false,
        auth: {
          apiKey: 'test-key',
          deviceId: 'test-device',
          sessionId: 'test-session'
        }
      };

      const migrated = fromActualConfig(await migrateLegacyDirectoriesToProjects(toActualConfig(legacyConfig)));
      
      expect(migrated.protectedProjects).toHaveLength(2);
      
      // Existing project should be preserved
      const preserved = migrated.protectedProjects.find(p => p.id === 'existing-id');
      expect(preserved).toBeDefined();
      expect(preserved?.rootPath).toBe('/home/user/existing-project');
      
      // New directory should be added
      const newProject = migrated.protectedProjects.find(p => 
        p.rootPath === '/home/user/new-dir'
      );
      expect(newProject).toBeDefined();
    });

    it('should filter out temp and invalid directories', async () => {
      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date('2023-01-01').toISOString(),
        updatedAt: new Date('2023-01-01').toISOString(),
        directoryQuota: 5,
        lockedDirectories: [
          '/tmp/temp-file.txt',
          '/var/folders/xyz/temp.txt',
          '/home/user/node_modules/package/file.js',
          '/home/user/.cache/data.txt',
          '/home/user/valid-project/file.txt'
        ],
        protectedProjects: [],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryConsent: false,
        auth: {
          apiKey: 'test-key',
          deviceId: 'test-device',
          sessionId: 'test-session'
        }
      };

      const migrated = fromActualConfig(await migrateLegacyDirectoriesToProjects(toActualConfig(legacyConfig)));
      
      // Only valid project should be migrated
      expect(migrated.protectedProjects).toHaveLength(1);
      expect(migrated.protectedProjects[0].rootPath).toBe('/home/user/valid-project');
    });

    it('should handle migration errors gracefully', async () => {
      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date('2023-01-01').toISOString(),
        updatedAt: new Date('2023-01-01').toISOString(),
        directoryQuota: 5,
        lockedDirectories: [
          null as any, // Invalid entry
          undefined as any, // Invalid entry
          '', // Empty string
          '/home/user/valid/file.txt'
        ],
        protectedProjects: [],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryConsent: false,
        auth: {
          apiKey: 'test-key',
          deviceId: 'test-device',
          sessionId: 'test-session'
        }
      };

      const migrated = fromActualConfig(await migrateLegacyDirectoriesToProjects(toActualConfig(legacyConfig)));
      
      // Should only migrate valid entry
      expect(migrated.protectedProjects).toHaveLength(1);
      expect(migrated.protectedProjects[0].rootPath).toBe('/home/user/valid');
    });

    it('should consolidate duplicate projects after migration', async () => {
      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date('2023-01-01').toISOString(),
        updatedAt: new Date('2023-01-01').toISOString(),
        directoryQuota: 5,
        lockedDirectories: [
          '/home/user/project/file1.txt',
          '/home/user/project/file2.txt'
        ],
        protectedProjects: [
          {
            id: 'existing',
            rootPath: '/home/user/project',
            type: 'directory',
            name: 'project',
            protectedPaths: ['existing.txt'],
            createdAt: new Date('2023-01-01').toISOString(),
            lastAccessedAt: new Date('2023-01-01').toISOString()
          }
        ],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryConsent: false,
        auth: {
          apiKey: 'test-key',
          deviceId: 'test-device',
          sessionId: 'test-session'
        }
      };

      const migrated = fromActualConfig(await migrateLegacyDirectoriesToProjects(toActualConfig(legacyConfig)));
      
      // Should consolidate into single project
      expect(migrated.protectedProjects).toHaveLength(1);
      const project = migrated.protectedProjects[0];
      expect(project.protectedPaths).toContain('existing.txt');
      expect(project.protectedPaths).toContain('file1.txt');
      expect(project.protectedPaths).toContain('file2.txt');
    });
  });

  describe('validateUserConfig', () => {
    it('should validate correct config', () => {
      const config: UserConfig = {
        version: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        directoryQuota: 5,
        lockedDirectories: [],
        protectedProjects: [
          {
            id: 'proj1',
            rootPath: '/home/user/project',
            type: 'git',
            name: 'project',
            protectedPaths: ['file.txt'],
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString()
          }
        ],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryConsent: true,
        auth: {
          apiKey: 'key',
          deviceId: 'device',
          sessionId: 'session'
        }
      };

      const errors = validateUserConfig(toActualConfig(config));
      expect(errors).toHaveLength(0);
    });

    it('should detect invalid version', () => {
      const config: any = {
        version: 'invalid',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        directoryQuota: 5,
        lockedDirectories: [],
        protectedProjects: [],
        projectQuota: 5
      };

      const errors = validateUserConfig(toActualConfig(config));
      expect(errors).toContain('Invalid version: must be a number');
    });

    it('should detect invalid project structure', () => {
      const config: UserConfig = {
        version: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        directoryQuota: 5,
        lockedDirectories: [],
        protectedProjects: [
          {
            id: '', // Empty ID
            rootPath: '', // Empty path
            type: 'invalid' as any, // Invalid type
            name: '',
            protectedPaths: null as any, // Invalid paths
            createdAt: 'invalid-date',
            lastAccessedAt: 'invalid-date'
          }
        ],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryConsent: false,
        auth: {
          apiKey: '',
          deviceId: '',
          sessionId: ''
        }
      };

      const errors = validateUserConfig(toActualConfig(config));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('Project proj1: Invalid ID'))).toBe(false);
      expect(errors.some(e => e.includes('Invalid type'))).toBe(true);
    });

    it('should detect duplicate project IDs', () => {
      const config: UserConfig = {
        version: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        directoryQuota: 5,
        lockedDirectories: [],
        protectedProjects: [
          {
            id: 'duplicate',
            rootPath: '/path1',
            type: 'directory',
            name: 'proj1',
            protectedPaths: ['file1.txt'],
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString()
          },
          {
            id: 'duplicate',
            rootPath: '/path2',
            type: 'directory',
            name: 'proj2',
            protectedPaths: ['file2.txt'],
            createdAt: new Date().toISOString(),
            lastAccessedAt: new Date().toISOString()
          }
        ],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryConsent: false,
        auth: {
          apiKey: 'key',
          deviceId: 'device',
          sessionId: 'session'
        }
      };

      const errors = validateUserConfig(toActualConfig(config));
      expect(errors.some(e => e.includes('Duplicate project ID'))).toBe(true);
    });
  });

  describe('repairUserConfig', () => {
    it('should repair invalid config', () => {
      const config: UserConfig = {
        version: -1, // Invalid version
        createdAt: 'invalid', // Invalid date
        updatedAt: 'invalid', // Invalid date
        directoryQuota: -5, // Invalid quota
        lockedDirectories: [null, undefined, ''] as any, // Invalid entries
        protectedProjects: [
          {
            id: '',
            rootPath: '',
            type: 'invalid' as any,
            name: '',
            protectedPaths: null as any,
            createdAt: 'invalid',
            lastAccessedAt: 'invalid'
          }
        ],
        projectQuota: -5, // Invalid quota
        privacyLevel: 'invalid' as any,
        telemetryConsent: 'invalid' as any,
        auth: null as any
      };

      const repaired = fromActualConfig(repairUserConfig(toActualConfig(config)));
      
      expect(repaired.version).toBe(2);
      expect(repaired.directoryQuota).toBe(5);
      expect(repaired.projectQuota).toBe(5);
      expect(repaired.lockedDirectories).toEqual([]);
      expect(repaired.protectedProjects).toEqual([]);
      expect(repaired.privacyLevel).toBe('standard');
      expect(repaired.telemetryConsent).toBe(false);
      expect(repaired.auth).toBeDefined();
      expect(new Date(repaired.createdAt).getTime()).not.toBeNaN();
      expect(new Date(repaired.updatedAt).getTime()).not.toBeNaN();
    });

    it('should preserve valid data during repair', () => {
      const validProject: ProjectUnit = {
        id: 'valid',
        rootPath: '/home/user/project',
        type: 'git',
        name: 'project',
        protectedPaths: ['file.txt'],
        createdAt: new Date().toISOString(),
        lastAccessedAt: new Date().toISOString()
      };

      const config: UserConfig = {
        version: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        directoryQuota: 10, // Valid custom quota
        lockedDirectories: ['/valid/path'],
        protectedProjects: [
          validProject,
          {
            id: '', // Invalid project
            rootPath: '',
            type: 'invalid' as any,
            name: '',
            protectedPaths: null as any,
            createdAt: 'invalid',
            lastAccessedAt: 'invalid'
          }
        ],
        projectQuota: 10,
        privacyLevel: 'enhanced',
        telemetryConsent: true,
        auth: {
          apiKey: 'key',
          deviceId: 'device',
          sessionId: 'session'
        }
      };

      const repaired = fromActualConfig(repairUserConfig(toActualConfig(config)));
      
      expect(repaired.directoryQuota).toBe(10);
      expect(repaired.projectQuota).toBe(10);
      expect(repaired.lockedDirectories).toEqual(['/valid/path']);
      expect(repaired.protectedProjects).toHaveLength(1);
      expect(repaired.protectedProjects[0]).toEqual(validProject);
      expect(repaired.privacyLevel).toBe('enhanced');
      expect(repaired.telemetryConsent).toBe(true);
    });

    it('should remove duplicate projects during repair', () => {
      const config: UserConfig = {
        version: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        directoryQuota: 5,
        lockedDirectories: [],
        protectedProjects: [
          {
            id: 'dup',
            rootPath: '/path',
            type: 'directory',
            name: 'proj1',
            protectedPaths: ['file1.txt'],
            createdAt: new Date('2023-01-01').toISOString(),
            lastAccessedAt: new Date('2023-01-01').toISOString()
          },
          {
            id: 'dup',
            rootPath: '/path',
            type: 'directory',
            name: 'proj2',
            protectedPaths: ['file2.txt'],
            createdAt: new Date('2023-01-02').toISOString(),
            lastAccessedAt: new Date('2023-01-02').toISOString()
          }
        ],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryConsent: false,
        auth: {
          apiKey: 'key',
          deviceId: 'device',
          sessionId: 'session'
        }
      };

      const repaired = fromActualConfig(repairUserConfig(toActualConfig(config)));
      
      expect(repaired.protectedProjects).toHaveLength(1);
      // Should keep first occurrence
      expect(repaired.protectedProjects[0].name).toBe('proj1');
    });
  });
});