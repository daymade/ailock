import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { mkdir, writeFile, rm, chmod, readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Command } from 'commander';
import chalk from 'chalk';
import { lockCommand } from '../../src/commands/lock.js';
import { unlockCommand } from '../../src/commands/unlock.js';
import * as configModule from '../../src/core/config.js';
import * as platformModule from '../../src/core/platform.js';

const execAsync = promisify(exec);

// Disable chalk colors for consistent test output
chalk.level = 0;

describe('Command Integration Tests', () => {
  let tempDir: string;
  let originalCwd: string;
  let originalExit: typeof process.exit;
  let consoleLogSpy: MockedFunction<typeof console.log>;
  let consoleErrorSpy: MockedFunction<typeof console.error>;
  let exitCalled: boolean;
  let exitCode: number | undefined;

  beforeEach(async () => {
    // Create temporary directory
    tempDir = join(tmpdir(), `ailock-cmd-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    
    // Save original cwd
    originalCwd = process.cwd();
    process.chdir(tempDir);
    
    // Mock console methods
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    // Mock process.exit
    exitCalled = false;
    exitCode = undefined;
    originalExit = process.exit;
    process.exit = ((code?: number) => {
      exitCalled = true;
      exitCode = code;
      throw new Error(`Process.exit(${code})`);
    }) as any;
  });

  afterEach(async () => {
    // Restore mocks
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.exit = originalExit;
    
    // Restore cwd
    process.chdir(originalCwd);
    
    // Clean up
    await rm(tempDir, { recursive: true, force: true });
    
    // Clear all module mocks
    vi.clearAllMocks();
  });

  describe('Lock Command', () => {
    let mockAdapter: any;

    beforeEach(() => {
      // Mock platform adapter
      mockAdapter = {
        isLocked: vi.fn().mockResolvedValue(false),
        lockFile: vi.fn().mockResolvedValue(undefined),
        unlockFile: vi.fn().mockResolvedValue(undefined)
      };
      vi.spyOn(platformModule, 'getPlatformAdapter').mockReturnValue(mockAdapter);
    });

    describe('with command line patterns', () => {
      it('should lock files matching patterns', async () => {
        // Create test files
        await writeFile('test1.txt', 'content1');
        await writeFile('test2.txt', 'content2');
        await writeFile('test3.log', 'content3');
        
        // Create new command instance to avoid state issues
        const cmd = createTestCommand(lockCommand);
        
        await cmd.parseAsync(['node', 'test', '*.txt']);
        
        expect(mockAdapter.lockFile).toHaveBeenCalledTimes(2);
        expect(mockAdapter.lockFile).toHaveBeenCalledWith(join(tempDir, 'test1.txt'));
        expect(mockAdapter.lockFile).toHaveBeenCalledWith(join(tempDir, 'test2.txt'));
        
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Found 2 file(s) to lock')
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Locked 2 file(s)')
        );
      });

      it('should skip already locked files', async () => {
        await writeFile('test.txt', 'content');
        
        // Mock file as already locked
        mockAdapter.isLocked.mockResolvedValue(true);
        
        const cmd = createTestCommand(lockCommand);
        await cmd.parseAsync(['node', 'test', 'test.txt', '--verbose']);
        
        expect(mockAdapter.lockFile).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('already locked')
        );
      });

      it('should handle dry-run mode', async () => {
        await writeFile('test.txt', 'content');
        
        const cmd = createTestCommand(lockCommand);
        await cmd.parseAsync(['node', 'test', 'test.txt', '--dry-run']);
        
        expect(mockAdapter.lockFile).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('would be locked')
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Dry run completed')
        );
      });

      it('should handle errors gracefully', async () => {
        await writeFile('test.txt', 'content');
        
        mockAdapter.lockFile.mockRejectedValue(new Error('Permission denied'));
        
        const cmd = createTestCommand(lockCommand);
        
        try {
          await cmd.parseAsync(['node', 'test', 'test.txt']);
        } catch (e) {
          // Expected due to process.exit mock
        }
        
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('❌'),
          expect.stringContaining('Permission denied')
        );
        expect(exitCalled).toBe(true);
        expect(exitCode).toBe(1);
      });
    });

    describe('with .ailock configuration', () => {
      beforeEach(() => {
        // Mock config loading
        vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
          patterns: ['.env', '*.key'],
          useGitignore: true,
          configPath: '.ailock',
          gitIgnorePatterns: ['*.secret']
        });
        
        vi.spyOn(configModule, 'findProtectedFiles').mockResolvedValue([
          join(tempDir, '.env'),
          join(tempDir, 'app.key'),
          join(tempDir, 'config.secret')
        ]);
      });

      it('should lock files from config', async () => {
        const cmd = createTestCommand(lockCommand);
        await cmd.parseAsync(['node', 'test']);
        
        expect(configModule.loadConfig).toHaveBeenCalledWith(
          undefined,
          { includeGitignored: true }
        );
        
        expect(mockAdapter.lockFile).toHaveBeenCalledTimes(3);
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Locked 3 file(s)')
        );
      });

      it('should show config patterns in verbose mode', async () => {
        const cmd = createTestCommand(lockCommand);
        await cmd.parseAsync(['node', 'test', '--verbose']);
        
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Using patterns from .ailock'),
          expect.stringContaining('.env, *.key')
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Sensitive patterns from .gitignore'),
          expect.stringContaining('*.secret')
        );
      });

      it('should respect --no-gitignore flag', async () => {
        const cmd = createTestCommand(lockCommand);
        await cmd.parseAsync(['node', 'test', '--no-gitignore', '--verbose']);
        
        expect(configModule.loadConfig).toHaveBeenCalledWith(
          undefined,
          { includeGitignored: false }
        );
        
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Gitignore integration: disabled')
        );
      });

      it('should handle no files found', async () => {
        vi.mocked(configModule.findProtectedFiles).mockResolvedValue([]);
        
        const cmd = createTestCommand(lockCommand);
        await cmd.parseAsync(['node', 'test']);
        
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('No files found to lock')
        );
        expect(mockAdapter.lockFile).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should handle config loading errors', async () => {
        vi.mocked(configModule.loadConfig).mockRejectedValue(
          new Error('Config file corrupted')
        );
        
        const cmd = createTestCommand(lockCommand);
        
        try {
          await cmd.parseAsync(['node', 'test']);
        } catch (e) {
          // Expected
        }
        
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Error:'),
          expect.stringContaining('Config file corrupted')
        );
        expect(exitCalled).toBe(true);
        expect(exitCode).toBe(1);
      });

      it('should count and report errors', async () => {
        await writeFile('test1.txt', 'content1');
        await writeFile('test2.txt', 'content2');
        await writeFile('test3.txt', 'content3');
        
        // Make second file fail
        mockAdapter.lockFile
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error('Permission denied'))
          .mockResolvedValueOnce(undefined);
        
        const cmd = createTestCommand(lockCommand);
        
        try {
          await cmd.parseAsync(['node', 'test', '*.txt']);
        } catch (e) {
          // Expected
        }
        
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Locked 2 file(s)')
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Failed to lock 1 file(s)')
        );
        expect(exitCode).toBe(1);
      });
    });
  });

  describe('Unlock Command', () => {
    let mockAdapter: any;

    beforeEach(() => {
      // Mock platform adapter
      mockAdapter = {
        isLocked: vi.fn().mockResolvedValue(true),
        lockFile: vi.fn().mockResolvedValue(undefined),
        unlockFile: vi.fn().mockResolvedValue(undefined)
      };
      vi.spyOn(platformModule, 'getPlatformAdapter').mockReturnValue(mockAdapter);
    });

    describe('with command line patterns', () => {
      it('should unlock files matching patterns', async () => {
        await writeFile('test1.txt', 'content1');
        await writeFile('test2.txt', 'content2');
        
        const cmd = createTestCommand(unlockCommand);
        await cmd.parseAsync(['node', 'test', '*.txt']);
        
        expect(mockAdapter.unlockFile).toHaveBeenCalledTimes(2);
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Unlocked 2 file(s)')
        );
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Remember to lock these files again')
        );
      });

      it('should skip already unlocked files', async () => {
        await writeFile('test.txt', 'content');
        
        // Mock file as already unlocked
        mockAdapter.isLocked.mockResolvedValue(false);
        
        const cmd = createTestCommand(unlockCommand);
        await cmd.parseAsync(['node', 'test', 'test.txt', '--verbose']);
        
        expect(mockAdapter.unlockFile).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('already unlocked')
        );
      });

      it('should handle dry-run mode', async () => {
        await writeFile('test.txt', 'content');
        
        const cmd = createTestCommand(unlockCommand);
        await cmd.parseAsync(['node', 'test', 'test.txt', '--dry-run']);
        
        expect(mockAdapter.unlockFile).not.toHaveBeenCalled();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('would be unlocked')
        );
      });

      it('should not show reminder when no files unlocked', async () => {
        await writeFile('test.txt', 'content');
        
        // File is already unlocked
        mockAdapter.isLocked.mockResolvedValue(false);
        
        const cmd = createTestCommand(unlockCommand);
        await cmd.parseAsync(['node', 'test', 'test.txt']);
        
        expect(consoleLogSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('Remember to lock')
        );
      });
    });

    describe('with .ailock configuration', () => {
      beforeEach(() => {
        vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
          patterns: ['.env', '*.key'],
          useGitignore: true,
          configPath: '.ailock',
          gitIgnorePatterns: []
        });
        
        vi.spyOn(configModule, 'findProtectedFiles').mockResolvedValue([
          join(tempDir, '.env'),
          join(tempDir, 'app.key')
        ]);
      });

      it('should unlock files from config', async () => {
        const cmd = createTestCommand(unlockCommand);
        await cmd.parseAsync(['node', 'test']);
        
        expect(mockAdapter.unlockFile).toHaveBeenCalledTimes(2);
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Unlocked 2 file(s)')
        );
      });
    });
  });

  describe('Real Filesystem Integration Tests', () => {
    beforeEach(() => {
      // Restore real implementations
      vi.restoreAllMocks();
    });

    it('should actually lock and unlock files', async () => {
      // Create test file
      const testFile = join(tempDir, 'test.txt');
      await writeFile(testFile, 'test content');
      
      // Create .ailock config
      await writeFile(join(tempDir, '.ailock'), 'test.txt');
      
      // Test lock command
      const lockCmd = createTestCommand(lockCommand);
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      await lockCmd.parseAsync(['node', 'test']);
      
      // Verify file is actually locked
      await expect(writeFile(testFile, 'new content')).rejects.toThrow();
      
      // Test unlock command
      const unlockCmd = createTestCommand(unlockCommand);
      await unlockCmd.parseAsync(['node', 'test']);
      
      // Verify file is actually unlocked
      await expect(writeFile(testFile, 'new content')).resolves.not.toThrow();
      
      // Verify content was written
      const content = await readFile(testFile, 'utf-8');
      expect(content).toBe('new content');
    });

    it('should work with glob patterns', async () => {
      // Create multiple files
      await writeFile(join(tempDir, 'config.env'), 'env content');
      await writeFile(join(tempDir, 'secret.key'), 'key content');
      await writeFile(join(tempDir, 'data.json'), 'json content');
      
      // Lock only .env and .key files
      const lockCmd = createTestCommand(lockCommand);
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      await lockCmd.parseAsync(['node', 'test', '*.env', '*.key']);
      
      // Verify correct files are locked
      await expect(writeFile(join(tempDir, 'config.env'), 'new')).rejects.toThrow();
      await expect(writeFile(join(tempDir, 'secret.key'), 'new')).rejects.toThrow();
      await expect(writeFile(join(tempDir, 'data.json'), 'new json')).resolves.not.toThrow();
    });
  });
});

/**
 * Helper function to create a new command instance for testing
 * This prevents state issues between tests
 */
function createTestCommand(originalCommand: Command): Command {
  // Get the command name properly
  const commandName = (originalCommand as any)._name || 'test';
  const cmd = new Command(commandName);
  
  // Copy configuration from original command
  const desc = (originalCommand as any)._description;
  if (desc) {
    cmd.description(desc);
  }
  
  // Copy arguments
  const args = (originalCommand as any)._args || [];
  args.forEach((arg: any) => {
    const argName = arg.variadic ? `${arg.name}...` : arg.name;
    if (arg.required) {
      cmd.argument(`<${argName}>`, arg.description || '');
    } else {
      cmd.argument(`[${argName}]`, arg.description || '');
    }
  });
  
  // Copy options
  originalCommand.options.forEach((option: any) => {
    cmd.option(option.flags, option.description, option.defaultValue);
  });
  
  // Copy action
  const action = (originalCommand as any)._actionHandler;
  if (action) {
    cmd.action(action);
  }
  
  // Configure for testing
  cmd.exitOverride();
  cmd.configureOutput({
    writeOut: (str) => console.log(str),
    writeErr: (str) => console.error(str)
  });
  
  return cmd;
}