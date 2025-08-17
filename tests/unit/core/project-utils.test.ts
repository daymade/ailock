import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
  detectGitRepository,
  generateProjectName,
  createProjectFromPath,
  findProjectRoot,
  findMatchingProject,
  belongsToSameProject,
  filterTempDirectories,
  isValidProjectRoot,
  consolidateProjects,
  getProjectDisplayPath,
  getProjectStats
} from '../../../src/core/project-utils';
import { ProjectUnit, ProjectType } from '../../../src/core/user-config';
import { createTestDirectory, cleanupTestDirectory } from '../../test-utils';

// Mock the git module before importing
vi.mock('../../../src/core/git', () => ({
  getRepoRoot: vi.fn()
}));

describe('project-utils', () => {
  let testDir: string;
  let gitRepoDir: string;
  let normalDir: string;

  beforeEach(async () => {
    testDir = await createTestDirectory('project-utils-test');
    gitRepoDir = path.join(testDir, 'git-repo');
    normalDir = path.join(testDir, 'normal-dir');
    
    // Create test directories
    await fs.promises.mkdir(gitRepoDir, { recursive: true });
    await fs.promises.mkdir(normalDir, { recursive: true });
    
    // Create a git repository
    await fs.promises.mkdir(path.join(gitRepoDir, '.git'), { recursive: true });
    await fs.promises.writeFile(path.join(gitRepoDir, '.git', 'config'), '[core]\nrepositoryformatversion = 0\n');
    
    // Create some test files
    await fs.promises.writeFile(path.join(gitRepoDir, 'file1.txt'), 'content1');
    await fs.promises.writeFile(path.join(normalDir, 'file2.txt'), 'content2');
    
    // Mock git detection
    const { getRepoRoot } = await import('../../../src/core/git');
    vi.mocked(getRepoRoot).mockImplementation(async (dir: string) => {
      // If the path is within our gitRepoDir, return it as the repo root
      if (dir && (dir === gitRepoDir || dir.startsWith(gitRepoDir + '/'))) {
        // Check for nested repos first
        const nestedRepoPath = path.join(gitRepoDir, 'nested');
        if (dir.startsWith(nestedRepoPath + '/') || dir === nestedRepoPath) {
          return nestedRepoPath;
        }
        return gitRepoDir;
      }
      return null;
    });
  });

  afterEach(async () => {
    await cleanupTestDirectory(testDir);
    vi.clearAllMocks();
  });

  describe('detectGitRepository', () => {
    it('should detect a git repository', async () => {
      const result = await detectGitRepository(path.join(gitRepoDir, 'file1.txt'));
      expect(result.isGitRepo).toBe(true);
      expect(result.repoRoot).toBe(gitRepoDir);
    });

    it('should not detect git repository for normal directory', async () => {
      const result = await detectGitRepository(path.join(normalDir, 'file2.txt'));
      expect(result.isGitRepo).toBe(false);
      expect(result.repoRoot).toBeNull();
    });

    it('should handle nested git repositories', async () => {
      const nestedRepo = path.join(gitRepoDir, 'nested');
      await fs.promises.mkdir(nestedRepo, { recursive: true });
      await fs.promises.mkdir(path.join(nestedRepo, '.git'), { recursive: true });
      await fs.promises.writeFile(path.join(nestedRepo, 'nested-file.txt'), 'nested content');
      
      const result = await detectGitRepository(path.join(nestedRepo, 'nested-file.txt'));
      expect(result.isGitRepo).toBe(true);
      expect(result.repoRoot).toBe(nestedRepo);
    });

    it('should handle non-existent paths', async () => {
      const result = await detectGitRepository(path.join(testDir, 'non-existent'));
      expect(result.isGitRepo).toBe(false);
      expect(result.repoRoot).toBeNull();
    });
  });

  describe('generateProjectName', () => {
    it('should generate name from git repository', () => {
      const name = generateProjectName(gitRepoDir, 'git');
      expect(name).toBe('git-repo');
    });

    it('should generate name from directory', () => {
      const name = generateProjectName(normalDir, 'directory');
      expect(name).toBe('normal-dir');
    });

    it('should handle root directory', () => {
      const name = generateProjectName('/', 'directory');
      expect(name).toBe('root');
    });

    it('should handle home directory', () => {
      const homeDir = os.homedir();
      const name = generateProjectName(homeDir, 'directory');
      expect(name).toBe('home');
    });

    it('should sanitize special characters', () => {
      const specialDir = path.join(testDir, 'special@#$%dir');
      const name = generateProjectName(specialDir, 'directory');
      expect(name).toBe('special-dir');
    });
  });

  describe('createProjectFromPath', () => {
    it('should create git project', async () => {
      const project = await createProjectFromPath(path.join(gitRepoDir, 'file1.txt'));
      expect(project.type).toBe('git');
      expect(project.rootPath).toBe(gitRepoDir);
      expect(project.name).toBe('git-repo');
      expect(project.protectedPaths).toContain('file1.txt');
      expect(project.id).toBeDefined();
      expect(project.createdAt).toBeDefined();
      expect(project.lastAccessedAt).toBeDefined();
    });

    it('should create directory project', async () => {
      const project = await createProjectFromPath(path.join(normalDir, 'file2.txt'));
      expect(project.type).toBe('directory');
      expect(project.rootPath).toBe(normalDir);
      expect(project.name).toBe('normal-dir');
      expect(project.protectedPaths).toContain('file2.txt');
    });

    it('should handle directory as input', async () => {
      const project = await createProjectFromPath(normalDir);
      expect(project.type).toBe('directory');
      expect(project.rootPath).toBe(normalDir);
      expect(project.protectedPaths).toContain('.');
    });

    it('should use existing project ID if provided', async () => {
      const existingProject: ProjectUnit = {
        id: 'existing-id',
        rootPath: gitRepoDir,
        type: 'git',
        name: 'old-name',
        protectedPaths: ['old-file.txt'],
        createdAt: new Date('2023-01-01').toISOString(),
        lastAccessedAt: new Date('2023-01-01').toISOString()
      };

      const project = await createProjectFromPath(
        path.join(gitRepoDir, 'file1.txt'),
        existingProject
      );
      expect(project.id).toBe('existing-id');
      expect(project.protectedPaths).toContain('file1.txt');
      expect(project.protectedPaths).toContain('old-file.txt');
    });
  });

  describe('findProjectRoot', () => {
    it('should find git repository root', async () => {
      const root = await findProjectRoot(path.join(gitRepoDir, 'subdir', 'file.txt'));
      expect(root).toBe(gitRepoDir);
    });

    it('should return directory for non-git paths', async () => {
      const filePath = path.join(normalDir, 'file2.txt');
      const root = await findProjectRoot(filePath);
      expect(root).toBe(normalDir);
    });

    it('should return directory itself if it is a directory', async () => {
      const root = await findProjectRoot(normalDir);
      expect(root).toBe(normalDir);
    });
  });

  describe('findMatchingProject', () => {
    let projects: ProjectUnit[];

    beforeEach(() => {
      projects = [
        {
          id: 'proj1',
          rootPath: gitRepoDir,
          type: 'git',
          name: 'git-repo',
          protectedPaths: ['file1.txt'],
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString()
        },
        {
          id: 'proj2',
          rootPath: normalDir,
          type: 'directory',
          name: 'normal-dir',
          protectedPaths: ['file2.txt'],
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString()
        }
      ];
    });

    it('should find matching git project', async () => {
      const project = await findMatchingProject(
        path.join(gitRepoDir, 'another-file.txt'),
        projects
      );
      expect(project).toBeDefined();
      expect(project?.id).toBe('proj1');
    });

    it('should find matching directory project', async () => {
      const project = await findMatchingProject(
        path.join(normalDir, 'another-file.txt'),
        projects
      );
      expect(project).toBeDefined();
      expect(project?.id).toBe('proj2');
    });

    it('should return null for non-matching path', async () => {
      const project = await findMatchingProject(
        path.join(testDir, 'unrelated', 'file.txt'),
        projects
      );
      expect(project).toBeNull();
    });
  });

  describe('belongsToSameProject', () => {
    it('should identify files in same git repository', async () => {
      const file1 = path.join(gitRepoDir, 'file1.txt');
      const file2 = path.join(gitRepoDir, 'subdir', 'file2.txt');
      const result = await belongsToSameProject(file1, file2);
      expect(result).toBe(true);
    });

    it('should identify files in different projects', async () => {
      const file1 = path.join(gitRepoDir, 'file1.txt');
      const file2 = path.join(normalDir, 'file2.txt');
      const result = await belongsToSameProject(file1, file2);
      expect(result).toBe(false);
    });

    it('should handle same directory files', async () => {
      const file1 = path.join(normalDir, 'file1.txt');
      const file2 = path.join(normalDir, 'file2.txt');
      const result = await belongsToSameProject(file1, file2);
      expect(result).toBe(true);
    });
  });

  describe('filterTempDirectories', () => {
    it('should filter out temp directories', () => {
      const paths = [
        '/home/user/project/file.txt',
        '/tmp/temp-file.txt',
        '/var/folders/xyz/temp.txt',
        '/home/user/node_modules/package/file.js',
        '/home/user/.cache/data.txt',
        '/home/user/project/test/file.test.ts'
      ];

      const filtered = filterTempDirectories(paths);
      expect(filtered).toEqual([
        '/home/user/project/file.txt',
        '/home/user/project/test/file.test.ts'
      ]);
    });

    it('should handle empty array', () => {
      const filtered = filterTempDirectories([]);
      expect(filtered).toEqual([]);
    });

    it('should handle Windows paths', () => {
      const paths = [
        'C:\\Users\\User\\project\\file.txt',
        'C:\\Windows\\Temp\\temp.txt',
        'C:\\Users\\User\\AppData\\Local\\Temp\\file.txt'
      ];

      const filtered = filterTempDirectories(paths);
      expect(filtered).toEqual(['C:\\Users\\User\\project\\file.txt']);
    });
  });

  describe('isValidProjectRoot', () => {
    it('should accept valid project roots', () => {
      // Use test directories that actually exist
      expect(isValidProjectRoot(gitRepoDir)).toBe(true);
      expect(isValidProjectRoot(normalDir)).toBe(true);
      expect(isValidProjectRoot(testDir)).toBe(true);
    });

    it('should reject system directories', () => {
      expect(isValidProjectRoot('/')).toBe(false);
      expect(isValidProjectRoot('/etc')).toBe(false);
      expect(isValidProjectRoot('/usr')).toBe(false);
      expect(isValidProjectRoot('/bin')).toBe(false);
      expect(isValidProjectRoot('C:\\')).toBe(false);
      expect(isValidProjectRoot('C:\\Windows')).toBe(false);
      expect(isValidProjectRoot('C:\\Program Files')).toBe(false);
    });

    it('should reject temp directories', () => {
      expect(isValidProjectRoot('/tmp')).toBe(false);
      expect(isValidProjectRoot('/var/tmp')).toBe(false);
      expect(isValidProjectRoot('/home/user/.cache')).toBe(false);
    });
  });

  describe('consolidateProjects', () => {
    it('should merge duplicate projects', () => {
      const projects: ProjectUnit[] = [
        {
          id: 'proj1',
          rootPath: gitRepoDir,
          type: 'git',
          name: 'project',
          protectedPaths: ['file1.txt'],
          createdAt: new Date('2023-01-01').toISOString(),
          lastAccessedAt: new Date('2023-01-02').toISOString()
        },
        {
          id: 'proj2',
          rootPath: gitRepoDir,
          type: 'git',
          name: 'project',
          protectedPaths: ['file2.txt'],
          createdAt: new Date('2023-01-03').toISOString(),
          lastAccessedAt: new Date('2023-01-04').toISOString()
        }
      ];

      const consolidated = consolidateProjects(projects);
      expect(consolidated).toHaveLength(1);
      expect(consolidated[0].id).toBe('proj1'); // Keeps first ID
      expect(consolidated[0].protectedPaths).toContain('file1.txt');
      expect(consolidated[0].protectedPaths).toContain('file2.txt');
      expect(consolidated[0].createdAt).toBe(new Date('2023-01-01').toISOString()); // Keeps earliest
      expect(consolidated[0].lastAccessedAt).toBe(new Date('2023-01-04').toISOString()); // Keeps latest
    });

    it('should handle empty array', () => {
      const consolidated = consolidateProjects([]);
      expect(consolidated).toEqual([]);
    });

    it('should preserve unique projects', () => {
      const projects: ProjectUnit[] = [
        {
          id: 'proj1',
          rootPath: gitRepoDir,
          type: 'git',
          name: 'project1',
          protectedPaths: ['file1.txt'],
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString()
        },
        {
          id: 'proj2',
          rootPath: normalDir,
          type: 'directory',
          name: 'project2',
          protectedPaths: ['file2.txt'],
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString()
        }
      ];

      const consolidated = consolidateProjects(projects);
      expect(consolidated).toHaveLength(2);
    });

    it('should deduplicate protected paths', () => {
      const projects: ProjectUnit[] = [
        {
          id: 'proj1',
          rootPath: gitRepoDir,
          type: 'git',
          name: 'project',
          protectedPaths: ['file1.txt', 'file2.txt'],
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString()
        },
        {
          id: 'proj2',
          rootPath: gitRepoDir,
          type: 'git',
          name: 'project',
          protectedPaths: ['file2.txt', 'file3.txt'],
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString()
        }
      ];

      const consolidated = consolidateProjects(projects);
      expect(consolidated).toHaveLength(1);
      expect(consolidated[0].protectedPaths).toHaveLength(3);
      expect(consolidated[0].protectedPaths).toContain('file1.txt');
      expect(consolidated[0].protectedPaths).toContain('file2.txt');
      expect(consolidated[0].protectedPaths).toContain('file3.txt');
    });
  });

  describe('getProjectDisplayPath', () => {
    it('should return relative path for home directory', () => {
      const homeDir = os.homedir();
      const projectPath = path.join(homeDir, 'Documents', 'project');
      const display = getProjectDisplayPath(projectPath);
      expect(display).toBe('~/Documents/project');
    });

    it('should return absolute path for non-home paths', () => {
      const display = getProjectDisplayPath('/usr/local/project');
      expect(display).toBe('/usr/local/project');
    });

    it('should handle Windows paths', () => {
      const display = getProjectDisplayPath('C:\\Users\\User\\project');
      // Should not modify Windows paths
      expect(display).toMatch(/^(~[\\\/]project|C:\\Users\\User\\project)$/);
    });
  });

  describe('getProjectStats', () => {
    it('should calculate project statistics', () => {
      const projects: ProjectUnit[] = [
        {
          id: 'proj1',
          rootPath: '/home/user/git-project',
          type: 'git',
          name: 'git-project',
          protectedPaths: ['file1.txt', 'file2.txt'],
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString()
        },
        {
          id: 'proj2',
          rootPath: '/home/user/dir-project',
          type: 'directory',
          name: 'dir-project',
          protectedPaths: ['file3.txt'],
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString()
        },
        {
          id: 'proj3',
          rootPath: '/home/user/another-git',
          type: 'git',
          name: 'another-git',
          protectedPaths: ['file4.txt'],
          createdAt: new Date().toISOString(),
          lastAccessedAt: new Date().toISOString()
        }
      ];

      const stats = getProjectStats(projects);
      expect(stats.total).toBe(3);
      expect(stats.gitProjects).toBe(2);
      expect(stats.directoryProjects).toBe(1);
      expect(stats.totalProtectedPaths).toBe(4);
    });

    it('should handle empty projects', () => {
      const stats = getProjectStats([]);
      expect(stats.total).toBe(0);
      expect(stats.gitProjects).toBe(0);
      expect(stats.directoryProjects).toBe(0);
      expect(stats.totalProtectedPaths).toBe(0);
    });
  });
});