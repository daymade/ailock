import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { mkdir, writeFile, rm, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import {
  getGit,
  isGitRepository,
  getRepoRoot,
  hasStagedChanges,
  getHookInfo,
  getRepoStatus,
  generatePreCommitHook,
  installPreCommitHook,
  removePreCommitHook
} from '../../src/core/git.js';
import * as configModule from '../../src/core/config.js';
import * as platformModule from '../../src/core/platform.js';

const execAsync = promisify(exec);

// Mock simple-git with proper factory function
vi.mock('simple-git', () => {
  const mockGitInstance = {
    checkIsRepo: vi.fn(),
    revparse: vi.fn(),
    status: vi.fn()
  };
  
  return {
    default: vi.fn(() => mockGitInstance),
    simpleGit: vi.fn(() => mockGitInstance),
    CheckRepoActions: {
      IS_REPO_ROOT: true
    }
  };
});

// Mock config and platform modules
vi.mock('../../src/core/config.js', () => ({
  loadConfig: vi.fn(),
  findProtectedFiles: vi.fn()
}));

vi.mock('../../src/core/platform.js', () => ({
  getPlatformAdapter: vi.fn(() => ({
    isLocked: vi.fn()
  }))
}));

describe('Git Module Tests', () => {
  describe('Unit Tests with Mocks', () => {
    let mockGit: any;
    
    beforeEach(async () => {
      // Reset all mocks
      vi.clearAllMocks();
      
      // Access the mocked simple-git instance directly
      const { simpleGit } = await import('simple-git');
      mockGit = {
        checkIsRepo: vi.fn(),
        revparse: vi.fn(),
        status: vi.fn()
      };
      
      // Cast and configure the mock
      (simpleGit as any).mockReturnValue(mockGit);
    });

    describe('isGitRepository', () => {
      it('should return true for valid git repository', async () => {
        mockGit.checkIsRepo.mockResolvedValue(true);
        
        const result = await isGitRepository('/some/path');
        
        expect(result).toBe(true);
        expect(mockGit.checkIsRepo).toHaveBeenCalledWith(true);
      });

      it('should return false when not a git repository', async () => {
        mockGit.checkIsRepo.mockRejectedValue(new Error('Not a git repository'));
        
        const result = await isGitRepository('/some/path');
        
        expect(result).toBe(false);
      });

      it('should use current working directory when no path provided', async () => {
        mockGit.checkIsRepo.mockResolvedValue(true);
        
        await isGitRepository();
        
        const { simpleGit } = await import('simple-git');
        expect(simpleGit).toHaveBeenCalledWith(process.cwd());
      });
    });

    describe('getRepoRoot', () => {
      it('should return repository root path', async () => {
        mockGit.revparse.mockResolvedValue('/repo/root\n');
        
        const result = await getRepoRoot('/some/path');
        
        expect(result).toBe('/repo/root');
        expect(mockGit.revparse).toHaveBeenCalledWith(['--show-toplevel']);
      });

      it('should return null when not in a repository', async () => {
        mockGit.revparse.mockRejectedValue(new Error('Not a git repository'));
        
        const result = await getRepoRoot('/some/path');
        
        expect(result).toBeNull();
      });
    });

    describe('hasStagedChanges', () => {
      it('should detect staged files', async () => {
        mockGit.status.mockResolvedValue({
          staged: ['file1.txt', 'src/file2.js'],
          modified: ['file3.txt'],
          created: ['newfile.txt'],
          renamed: [{ from: 'old.txt', to: 'new.txt' }]
        });
        
        const files = [
          '/workspace/file1.txt',
          '/workspace/src/file2.js',
          '/workspace/other.txt'
        ];
        
        // Mock process.cwd() instead of actually changing directories
        const originalCwd = process.cwd();
        const mockCwd = '/workspace';
        vi.spyOn(process, 'cwd').mockReturnValue(mockCwd);
        
        try {
          const result = await hasStagedChanges(files);
          
          expect(result).toContain('/workspace/file1.txt');
          expect(result).toContain('/workspace/src/file2.js');
          expect(result).not.toContain('/workspace/other.txt');
        } finally {
          vi.restoreAll();
        }
      });

      it('should detect modified files', async () => {
        mockGit.status.mockResolvedValue({
          staged: [],
          modified: ['config.json'],
          created: [],
          renamed: []
        });
        
        const files = ['/workspace/config.json'];
        vi.spyOn(process, 'cwd').mockReturnValue('/workspace');
        
        try {
          const result = await hasStagedChanges(files);
          expect(result).toContain('/workspace/config.json');
        } finally {
          vi.restoreAll();
        }
      });

      it('should handle renamed files', async () => {
        mockGit.status.mockResolvedValue({
          staged: [],
          modified: [],
          created: [],
          renamed: [{ from: 'old.txt', to: 'new.txt' }]
        });
        
        const files = ['/workspace/new.txt'];
        vi.spyOn(process, 'cwd').mockReturnValue('/workspace');
        
        try {
          const result = await hasStagedChanges(files);
          expect(result).toContain('/workspace/new.txt');
        } finally {
          vi.restoreAll();
        }
      });

      it('should return empty array on error', async () => {
        mockGit.status.mockRejectedValue(new Error('Git error'));
        
        const result = await hasStagedChanges(['file.txt']);
        
        expect(result).toEqual([]);
      });
    });

    describe('getRepoStatus', () => {
      it('should return non-repo status when not in git repository', async () => {
        mockGit.checkIsRepo.mockRejectedValue(new Error('Not a git repository'));
        
        const result = await getRepoStatus('/some/path');
        
        expect(result).toEqual({
          isGitRepo: false,
          hasAilockHook: false,
          protectedFiles: [],
          lockedFiles: []
        });
      });

      it('should return full repo status for git repository', async () => {
        mockGit.checkIsRepo.mockResolvedValue(true);
        mockGit.revparse.mockResolvedValue('/repo/root\n');
        
        // Mock config
        const loadConfigMock = vi.mocked(configModule.loadConfig);
        const findProtectedFilesMock = vi.mocked(configModule.findProtectedFiles);
        
        loadConfigMock.mockResolvedValue({
          patterns: ['.env', '*.key'],
          useGitignore: true,
          configPath: '.ailock'
        });
        findProtectedFilesMock.mockResolvedValue([
          '/repo/root/.env',
          '/repo/root/secret.key'
        ]);
        
        // Mock platform adapter
        const mockAdapter = {
          isLocked: vi.fn()
            .mockResolvedValueOnce(true)  // .env is locked
            .mockResolvedValueOnce(false) // secret.key is not locked
        };
        const getPlatformAdapterMock = vi.mocked(platformModule.getPlatformAdapter);
        getPlatformAdapterMock.mockReturnValue(mockAdapter as any);
        
        // Mock getHookInfo
        const getHookInfoSpy = vi.spyOn(await import('../../src/core/git.js'), 'getHookInfo');
        getHookInfoSpy.mockReturnValue({
          hookPath: '/repo/root/.git/hooks/pre-commit',
          exists: true,
          isAilockManaged: true,
          content: '# ailock-managed\n#!/bin/sh'
        });
        
        const result = await getRepoStatus('/repo/root');
        
        expect(result).toMatchObject({
          isGitRepo: true,
          hasAilockHook: true,
          protectedFiles: ['/repo/root/.env', '/repo/root/secret.key'],
          lockedFiles: ['/repo/root/.env']
        });
        
        getHookInfoSpy.mockRestore();
      });

      it('should handle errors when checking locked status', async () => {
        mockGit.checkIsRepo.mockResolvedValue(true);
        mockGit.revparse.mockResolvedValue('/repo/root\n');
        
        const findProtectedFilesMock = vi.mocked(configModule.findProtectedFiles);
        findProtectedFilesMock.mockResolvedValue(['/repo/root/.env']);
        
        // Mock adapter to throw error
        const mockAdapter = {
          isLocked: vi.fn().mockRejectedValue(new Error('Permission denied'))
        };
        const getPlatformAdapterMock = vi.mocked(platformModule.getPlatformAdapter);
        getPlatformAdapterMock.mockReturnValue(mockAdapter as any);
        
        const result = await getRepoStatus('/repo/root');
        
        // Should not include file in lockedFiles due to error
        expect(result.lockedFiles).toEqual([]);
      });
    });

    describe('generatePreCommitHook', () => {
      it('should generate valid pre-commit hook script', () => {
        const hook = generatePreCommitHook();
        
        expect(hook).toContain('#!/bin/sh');
        expect(hook).toContain('# ailock-managed');
        expect(hook).toContain('ailock pre-commit-check');
        expect(hook).toContain('git diff --cached --name-only');
      });

      it('should include helpful error messages', () => {
        const hook = generatePreCommitHook();
        
        expect(hook).toContain('ailock unlock <filename>');
        expect(hook).toContain('Commit blocked: Attempted to modify locked files');
      });

      it('should handle missing ailock command gracefully', () => {
        const hook = generatePreCommitHook();
        
        expect(hook).toContain('command -v ailock');
        expect(hook).toContain('Warning: ailock not found in PATH');
      });
    });

    describe('getHookInfo', () => {
      it('should detect ailock-managed hooks', async () => {
        const fs = vi.mocked(await import('fs'));
        fs.existsSync = vi.fn().mockReturnValue(true);
        fs.readFileSync = vi.fn().mockReturnValue('#!/bin/sh\n# ailock-managed\necho test');
        
        const info = getHookInfo('/repo/root');
        
        expect(info).toMatchObject({
          hookPath: '/repo/root/.git/hooks/pre-commit',
          exists: true,
          isAilockManaged: true,
          content: expect.stringContaining('ailock-managed')
        });
      });

      it('should detect non-ailock hooks', async () => {
        const fs = vi.mocked(await import('fs'));
        fs.existsSync = vi.fn().mockReturnValue(true);
        fs.readFileSync = vi.fn().mockReturnValue('#!/bin/sh\n# Custom hook\necho test');
        
        const info = getHookInfo('/repo/root');
        
        expect(info.isAilockManaged).toBe(false);
      });

      it('should handle non-existent hooks', async () => {
        const fs = vi.mocked(await import('fs'));
        fs.existsSync = vi.fn().mockReturnValue(false);
        
        const info = getHookInfo('/repo/root');
        
        expect(info).toMatchObject({
          exists: false,
          isAilockManaged: false,
          content: undefined
        });
      });
    });
  });

  describe('Integration Tests with Real Git Repository', () => {
    let tempDir: string;
    let repoDir: string;

    beforeEach(async () => {
      // Create temporary directory
      tempDir = join(tmpdir(), `ailock-git-test-${Date.now()}`);
      await mkdir(tempDir, { recursive: true });
      
      // Initialize git repository
      repoDir = join(tempDir, 'test-repo');
      await mkdir(repoDir, { recursive: true });
      
      const originalCwd = process.cwd();
      process.chdir(repoDir);
      
      try {
        await execAsync('git init');
        await execAsync('git config user.email "test@example.com"');
        await execAsync('git config user.name "Test User"');
        await execAsync('git config commit.gpgsign false'); // Disable GPG signing for tests
      } finally {
        process.chdir(originalCwd);
      }
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it('should correctly identify git repository', async () => {
      const isRepo = await isGitRepository(repoDir);
      expect(isRepo).toBe(true);
      
      const notRepo = await isGitRepository(tempDir);
      expect(notRepo).toBe(false);
    });

    it('should get repository root correctly', async () => {
      const subDir = join(repoDir, 'src', 'components');
      await mkdir(subDir, { recursive: true });
      
      const root = await getRepoRoot(subDir);
      expect(root).toBe(repoDir);
    });

    it('should install and detect pre-commit hook', async () => {
      await installPreCommitHook(repoDir);
      
      // Verify hook was created
      const hookPath = join(repoDir, '.git', 'hooks', 'pre-commit');
      await expect(access(hookPath)).resolves.not.toThrow();
      
      // Verify hook is executable
      const { stdout } = await execAsync(`ls -la "${hookPath}"`);
      expect(stdout).toMatch(/^-rwx/); // Should have execute permissions
      
      // Verify hook content
      const content = await readFile(hookPath, 'utf-8');
      expect(content).toContain('# ailock-managed');
      expect(content).toContain('ailock pre-commit-check');
      
      // Verify getHookInfo detects it correctly
      const info = getHookInfo(repoDir);
      expect(info.exists).toBe(true);
      expect(info.isAilockManaged).toBe(true);
    });

    it('should not overwrite existing non-ailock hooks without force', async () => {
      // Create custom pre-commit hook
      const hooksDir = join(repoDir, '.git', 'hooks');
      await mkdir(hooksDir, { recursive: true });
      
      const hookPath = join(hooksDir, 'pre-commit');
      await writeFile(hookPath, '#!/bin/sh\n# Custom hook\necho "custom"', { mode: 0o755 });
      
      // Should throw when trying to install without force
      await expect(installPreCommitHook(repoDir)).rejects.toThrow(/already exists/);
      
      // Should succeed with force
      await expect(installPreCommitHook(repoDir, true)).resolves.not.toThrow();
      
      // Verify it was overwritten
      const content = await readFile(hookPath, 'utf-8');
      expect(content).toContain('# ailock-managed');
    });

    it('should remove ailock-managed hooks', async () => {
      // First install a hook
      await installPreCommitHook(repoDir);
      
      // Then remove it
      removePreCommitHook(repoDir);
      
      // Verify it's gone
      const hookPath = join(repoDir, '.git', 'hooks', 'pre-commit');
      await expect(access(hookPath)).rejects.toThrow();
    });

    it('should not remove non-ailock hooks', async () => {
      // Create custom hook
      const hookPath = join(repoDir, '.git', 'hooks', 'pre-commit');
      await mkdir(join(repoDir, '.git', 'hooks'), { recursive: true });
      await writeFile(hookPath, '#!/bin/sh\n# Custom hook\necho "custom"', { mode: 0o755 });
      
      // Should throw when trying to remove
      expect(() => removePreCommitHook(repoDir)).toThrow(/not managed by ailock/);
      
      // Verify hook still exists
      await expect(access(hookPath)).resolves.not.toThrow();
    });

    it('should detect staged changes correctly', async () => {
      const originalCwd = process.cwd();
      process.chdir(repoDir);
      
      try {
        // Create and stage files
        await writeFile('file1.txt', 'content1');
        await writeFile('file2.txt', 'content2');
        await writeFile('file3.txt', 'content3');
        
        await execAsync('git add file1.txt file2.txt');
        
        const files = [
          join(repoDir, 'file1.txt'),
          join(repoDir, 'file2.txt'),
          join(repoDir, 'file3.txt')
        ];
        
        const staged = await hasStagedChanges(files, repoDir);
        
        expect(staged).toHaveLength(2);
        expect(staged).toContain(join(repoDir, 'file1.txt'));
        expect(staged).toContain(join(repoDir, 'file2.txt'));
        expect(staged).not.toContain(join(repoDir, 'file3.txt'));
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should get complete repository status', async () => {
      // Setup repository with ailock
      await writeFile(join(repoDir, '.ailock'), '.env\n*.key');
      await writeFile(join(repoDir, '.env'), 'SECRET=value');
      await writeFile(join(repoDir, 'app.key'), 'key-content');
      
      // Install hook
      await installPreCommitHook(repoDir);
      
      // Reset mocks to use real implementations
      vi.unmock('../../src/core/config.js');
      vi.unmock('../../src/core/platform.js');
      
      const status = await getRepoStatus(repoDir);
      
      expect(status).toMatchObject({
        isGitRepo: true,
        hasAilockHook: true,
        protectedFiles: expect.arrayContaining([
          expect.stringContaining('.env'),
          expect.stringContaining('app.key')
        ])
      });
      
      expect(status.hookInfo).toMatchObject({
        exists: true,
        isAilockManaged: true
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle missing git command gracefully', async () => {
      // This test would require mocking the entire simple-git module to simulate missing git
      // For now, we'll test that errors are handled properly
      const mockGit = {
        checkIsRepo: vi.fn().mockRejectedValue(new Error('git: command not found'))
      };
      
      const { simpleGit } = await import('simple-git');
      (simpleGit as any).mockReturnValue(mockGit);
      
      const result = await isGitRepository();
      expect(result).toBe(false);
    });

    it('should throw when trying to remove non-existent hook', async () => {
      const fs = vi.mocked(await import('fs'));
      fs.existsSync = vi.fn().mockReturnValue(false);
      
      expect(() => removePreCommitHook('/fake/repo')).toThrow(/No pre-commit hook found/);
    });
  });
});