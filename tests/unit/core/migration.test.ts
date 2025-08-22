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
  telemetryOptOut?: boolean; // Fixed field name
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
    machineUuid: testConfig.machineUuid || 'test-machine-uuid',
    analyticsEnabled: testConfig.analyticsEnabled ?? true,
    version: String(testConfig.version),
    createdAt: testConfig.createdAt ? new Date(testConfig.createdAt) : new Date(),
    updatedAt: testConfig.updatedAt ? new Date(testConfig.updatedAt) : new Date(),
    protectedProjects: testConfig.protectedProjects?.map(project => ({
      ...project,
      createdAt: new Date(project.createdAt),
      lastAccessedAt: new Date(project.lastAccessedAt)
    })) || []
  };
}

// Convert actual config back to test format
function fromActualConfig(actualConfig: any): UserConfig {
  return {
    ...actualConfig,
    version: actualConfig.version,
    createdAt: actualConfig.createdAt instanceof Date ? 
      (isNaN(actualConfig.createdAt.getTime()) ? new Date().toISOString() : actualConfig.createdAt.toISOString()) : 
      actualConfig.createdAt || new Date().toISOString(),
    updatedAt: actualConfig.updatedAt instanceof Date ? 
      (isNaN(actualConfig.updatedAt.getTime()) ? new Date().toISOString() : actualConfig.updatedAt.toISOString()) : 
      actualConfig.updatedAt || new Date().toISOString(),
    protectedProjects: actualConfig.protectedProjects?.map((project: any) => ({
      ...project,
      createdAt: project.createdAt instanceof Date ? 
        (isNaN(project.createdAt.getTime()) ? new Date().toISOString() : project.createdAt.toISOString()) : 
        project.createdAt,
      lastAccessedAt: project.lastAccessedAt instanceof Date ? 
        (isNaN(project.lastAccessedAt.getTime()) ? new Date().toISOString() : project.lastAccessedAt.toISOString()) : 
        project.lastAccessedAt
    })) || []
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
      // Create real test directories
      const project1Dir = path.join(testDir, 'project1');
      const project2Dir = path.join(testDir, 'project2');
      await fs.promises.mkdir(project1Dir, { recursive: true });
      await fs.promises.mkdir(project2Dir, { recursive: true });
      await fs.promises.writeFile(path.join(project1Dir, 'file1.txt'), 'content1');
      await fs.promises.writeFile(path.join(project1Dir, 'file2.txt'), 'content2');
      await fs.promises.writeFile(path.join(project2Dir, 'file3.txt'), 'content3');

      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date('2023-01-01').toISOString(),
        updatedAt: new Date('2023-01-01').toISOString(),
        directoryQuota: 5,
        lockedDirectories: [
          path.join(project1Dir, 'file1.txt'),
          path.join(project1Dir, 'file2.txt'),
          path.join(project2Dir, 'file3.txt')
        ],
        protectedProjects: [],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryOptOut: false,
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
        p.rootPath === project1Dir
      );
      expect(project1).toBeDefined();
      expect(project1?.protectedPaths).toContain('file1.txt');
      expect(project1?.protectedPaths).toContain('file2.txt');
      expect(project1?.type).toBe('directory');
      
      // Check project2
      const project2 = migrated.protectedProjects.find(p => 
        p.rootPath === project2Dir
      );
      expect(project2).toBeDefined();
      expect(project2?.protectedPaths).toContain('file3.txt');
    });

    it('should group files in same git repository', async () => {
      // Create a real git repository
      const gitRepoDir = path.join(testDir, 'git-repo');
      const otherDir = path.join(testDir, 'other-dir');
      await fs.promises.mkdir(path.join(gitRepoDir, 'src'), { recursive: true });
      await fs.promises.mkdir(path.join(gitRepoDir, 'tests'), { recursive: true });
      await fs.promises.mkdir(path.join(gitRepoDir, 'docs'), { recursive: true });
      await fs.promises.mkdir(path.join(gitRepoDir, '.git'), { recursive: true });
      await fs.promises.mkdir(otherDir, { recursive: true });
      
      await fs.promises.writeFile(path.join(gitRepoDir, 'src', 'file1.txt'), 'content1');
      await fs.promises.writeFile(path.join(gitRepoDir, 'tests', 'file2.txt'), 'content2');
      await fs.promises.writeFile(path.join(gitRepoDir, 'docs', 'readme.md'), 'readme');
      await fs.promises.writeFile(path.join(otherDir, 'file3.txt'), 'content3');

      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date('2023-01-01').toISOString(),
        updatedAt: new Date('2023-01-01').toISOString(),
        directoryQuota: 5,
        lockedDirectories: [
          path.join(gitRepoDir, 'src', 'file1.txt'),
          path.join(gitRepoDir, 'tests', 'file2.txt'),
          path.join(gitRepoDir, 'docs', 'readme.md'),
          path.join(otherDir, 'file3.txt')
        ],
        protectedProjects: [],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryOptOut: false,
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
        p.rootPath === gitRepoDir
      );
      expect(gitProject).toBeDefined();
      expect(gitProject?.protectedPaths).toHaveLength(3);
      expect(gitProject?.protectedPaths).toContain('src/file1.txt');
      expect(gitProject?.protectedPaths).toContain('tests/file2.txt');
      expect(gitProject?.protectedPaths).toContain('docs/readme.md');
      expect(gitProject?.type).toBe('git');
      
      // Other directory should be separate
      const otherProject = migrated.protectedProjects.find(p => 
        p.rootPath === otherDir
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
        telemetryOptOut: false,
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
      // Create real test directories
      const existingProjectDir = path.join(testDir, 'existing-project');
      const newDir = path.join(testDir, 'new-dir');
      await fs.promises.mkdir(existingProjectDir, { recursive: true });
      await fs.promises.mkdir(newDir, { recursive: true });
      await fs.promises.writeFile(path.join(existingProjectDir, 'existing.txt'), 'existing');
      await fs.promises.writeFile(path.join(newDir, 'file.txt'), 'new');

      const existingProject: ProjectUnit = {
        id: 'existing-id',
        rootPath: existingProjectDir,
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
        lockedDirectories: [path.join(newDir, 'file.txt')],
        protectedProjects: [existingProject],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryOptOut: false,
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
      expect(preserved?.rootPath).toBe(existingProjectDir);
      
      // New directory should be added
      const newProject = migrated.protectedProjects.find(p => 
        p.rootPath === newDir
      );
      expect(newProject).toBeDefined();
    });

    it('should filter out temp and invalid directories', async () => {
      // Create a real valid project directory
      const validProjectDir = path.join(testDir, 'valid-project');
      await fs.promises.mkdir(validProjectDir, { recursive: true });
      await fs.promises.writeFile(path.join(validProjectDir, 'file.txt'), 'content');

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
          path.join(validProjectDir, 'file.txt') // Use real test directory
        ],
        protectedProjects: [],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryOptOut: false,
        auth: {
          apiKey: 'test-key',
          deviceId: 'test-device',
          sessionId: 'test-session'
        }
      };

      const migrated = fromActualConfig(await migrateLegacyDirectoriesToProjects(toActualConfig(legacyConfig)));
      
      // Only valid project should be migrated
      expect(migrated.protectedProjects).toHaveLength(1);
      expect(migrated.protectedProjects[0].rootPath).toBe(validProjectDir);
    });

    it('should handle migration errors gracefully', async () => {
      // Create a real valid directory
      const validDir = path.join(testDir, 'valid');
      await fs.promises.mkdir(validDir, { recursive: true });
      await fs.promises.writeFile(path.join(validDir, 'file.txt'), 'content');

      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date('2023-01-01').toISOString(),
        updatedAt: new Date('2023-01-01').toISOString(),
        directoryQuota: 5,
        lockedDirectories: [
          null as any, // Invalid entry
          undefined as any, // Invalid entry
          '', // Empty string
          path.join(validDir, 'file.txt') // Use real test directory
        ],
        protectedProjects: [],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryOptOut: false,
        auth: {
          apiKey: 'test-key',
          deviceId: 'test-device',
          sessionId: 'test-session'
        }
      };

      const migrated = fromActualConfig(await migrateLegacyDirectoriesToProjects(toActualConfig(legacyConfig)));
      
      // Should only migrate valid entry
      expect(migrated.protectedProjects).toHaveLength(1);
      expect(migrated.protectedProjects[0].rootPath).toBe(validDir);
    });

    it('should skip non-existent paths during migration', async () => {
      // Create only one valid directory
      const validDir = path.join(testDir, 'valid-project');
      await fs.promises.mkdir(validDir, { recursive: true });
      await fs.promises.writeFile(path.join(validDir, 'file.txt'), 'content');

      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        directoryQuota: 5,
        lockedDirectories: [
          '/home/user/project/file1.txt',  // Non-existent path
          '/home/user/project/file2.txt',  // Non-existent path  
          '/invalid/path/that/does/not/exist',  // Non-existent path
          path.join(validDir, 'file.txt')  // Valid path
        ],
        protectedProjects: [],
        projectQuota: 5
      };

      const migrated = fromActualConfig(await migrateLegacyDirectoriesToProjects(toActualConfig(legacyConfig)));

      // Should only migrate the valid path
      expect(migrated.version).toBe('2');
      expect(migrated.protectedProjects).toHaveLength(1);
      expect(migrated.protectedProjects[0].rootPath).toBe(validDir);
      expect(migrated.protectedProjects[0].protectedPaths).toContain('file.txt');
    });

    it('should consolidate duplicate projects after migration', async () => {
      // Create a real project directory
      const projectDir = path.join(testDir, 'project');
      await fs.promises.mkdir(projectDir, { recursive: true });
      await fs.promises.writeFile(path.join(projectDir, 'file1.txt'), 'content1');
      await fs.promises.writeFile(path.join(projectDir, 'file2.txt'), 'content2');
      await fs.promises.writeFile(path.join(projectDir, 'existing.txt'), 'existing');

      const legacyConfig: UserConfig = {
        version: 1,
        createdAt: new Date('2023-01-01').toISOString(),
        updatedAt: new Date('2023-01-01').toISOString(),
        directoryQuota: 5,
        lockedDirectories: [
          path.join(projectDir, 'file1.txt'),
          path.join(projectDir, 'file2.txt')
        ],
        protectedProjects: [
          {
            id: 'existing',
            rootPath: projectDir,
            type: 'directory',
            name: 'project',
            protectedPaths: ['existing.txt'],
            createdAt: new Date('2023-01-01').toISOString(),
            lastAccessedAt: new Date('2023-01-01').toISOString()
          }
        ],
        projectQuota: 5,
        privacyLevel: 'standard',
        telemetryOptOut: false,
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
        telemetryOptOut: false,
        auth: {
          apiKey: 'key',
          deviceId: 'device',
          sessionId: 'session'
        }
      };

      const errors = validateUserConfig(toActualConfig(config));
      expect(errors).toHaveLength(0);
    });

    it('should detect missing machine UUID', () => {
      const config: any = {
        version: '2',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        directoryQuota: 5,
        lockedDirectories: [],
        protectedProjects: [],
        projectQuota: 5,
        analyticsEnabled: true,
        machineUuid: '' // Empty machine UUID
      };

      const errors = validateUserConfig(config);
      expect(errors).toContain('Machine UUID is required');
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
        telemetryOptOut: false,
        auth: {
          apiKey: '',
          deviceId: '',
          sessionId: ''
        },
        machineUuid: 'test-uuid',
        analyticsEnabled: true
      };

      const errors = validateUserConfig(toActualConfig(config));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.some(e => e.includes('ID is required'))).toBe(true);
      expect(errors.some(e => e.includes('Type must be'))).toBe(true);
    });

    it('should detect negative project quota', () => {
      const config: UserConfig = {
        version: 2,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        directoryQuota: 5,
        lockedDirectories: [],
        protectedProjects: [],
        projectQuota: -1, // Negative quota
        privacyLevel: 'standard',
        telemetryOptOut: false,
        auth: {
          apiKey: 'key',
          deviceId: 'device',
          sessionId: 'session'
        },
        machineUuid: 'test-uuid',
        analyticsEnabled: true
      };

      const errors = validateUserConfig(toActualConfig(config));
      expect(errors.some(e => e.includes('Project quota must be non-negative'))).toBe(true);
    });
  });

  describe('repairUserConfig', () => {
    it('should repair invalid config', () => {
      const config: UserConfig = {
        version: 'invalid' as any, // Invalid version
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
        telemetryOptOut: 'invalid' as any, // Fixed field name
        auth: null as any,
        machineUuid: '', // Will be fixed by repair
        analyticsEnabled: 'invalid' as any
      };

      const repaired = fromActualConfig(repairUserConfig(toActualConfig(config)));
      
      expect(repaired.version).toBe('2');
      expect(repaired.directoryQuota).toBe(5);
      expect(repaired.projectQuota).toBe(5);
      expect(repaired.lockedDirectories).toEqual([]);
      expect(repaired.protectedProjects).toEqual([]);
      expect(repaired.privacyLevel).toBe('standard');
      expect(repaired.telemetryOptOut).toBe(false); // Fixed field name
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
        telemetryOptOut: false,
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