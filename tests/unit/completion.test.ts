import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';
import { completionCommand, setupCompletionCommand } from '../../src/commands/completion.js';
import { completionHelperCommand } from '../../src/commands/completion-helper.js';
import * as configModule from '../../src/core/config.js';
import * as platformModule from '../../src/core/platform.js';

// Disable chalk colors for consistent test output
chalk.level = 0;

describe('Shell Completion System Tests', () => {
  let tempDir: string;
  let originalCwd: string;
  let consoleLogSpy: MockedFunction<typeof console.log>;
  let consoleErrorSpy: MockedFunction<typeof console.error>;
  let originalExit: typeof process.exit;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `ailock-completion-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    
    originalCwd = process.cwd();
    process.chdir(tempDir);
    
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    originalExit = process.exit;
    process.exit = vi.fn() as any;
    
    originalEnv = { ...process.env };
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(tempDir, { recursive: true, force: true });
    
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.exit = originalExit;
    process.env = originalEnv;
    
    vi.clearAllMocks();
  });

  describe('Completion Command', () => {
    it('should generate bash completion script', async () => {
      const cmd = createTestCommand(completionCommand);
      await cmd.parseAsync(['node', 'test', 'bash']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('# ailock bash completion');
      expect(output).toContain('_ailock()');
      expect(output).toContain('COMPREPLY');
    });

    it('should generate zsh completion script', async () => {
      const cmd = createTestCommand(completionCommand);
      await cmd.parseAsync(['node', 'test', 'zsh']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('# ailock zsh completion');
      expect(output).toContain('#compdef ailock');
      expect(output).toContain('_ailock()');
    });

    it('should generate fish completion script', async () => {
      const cmd = createTestCommand(completionCommand);
      await cmd.parseAsync(['node', 'test', 'fish']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('# ailock fish completion');
      expect(output).toContain('complete -c ailock');
    });

    it('should generate PowerShell completion script', async () => {
      const cmd = createTestCommand(completionCommand);
      await cmd.parseAsync(['node', 'test', 'powershell']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('# ailock PowerShell completion');
      expect(output).toContain('Register-ArgumentCompleter');
    });

    it('should show installation instructions', async () => {
      const cmd = createTestCommand(completionCommand);
      await cmd.parseAsync(['node', 'test', 'bash', '--install-instructions']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Installation Instructions for bash');
      expect(output).toContain('~/.bashrc');
      expect(output).toContain('source');
    });

    it('should handle unsupported shells', async () => {
      const cmd = createTestCommand(completionCommand);
      
      try {
        await cmd.parseAsync(['node', 'test', 'unsupported-shell']);
      } catch (e) {
        // Expected due to exitOverride
      }
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported shell')
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Supported shells: bash, zsh, fish, powershell')
      );
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should handle script generation errors', async () => {
      // Mock the generator to throw
      vi.doMock('../completion/templates/bash.js', () => ({
        generateBashCompletion: () => {
          throw new Error('Template error');
        }
      }));
      
      const cmd = createTestCommand(completionCommand);
      
      try {
        await cmd.parseAsync(['node', 'test', 'bash']);
      } catch (e) {
        // Expected
      }
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error generating completion script'),
        expect.any(Error)
      );
    });
  });

  describe('Setup Completion Command', () => {
    it('should detect bash shell', async () => {
      process.env.SHELL = '/bin/bash';
      
      const cmd = createTestCommand(setupCompletionCommand);
      await cmd.parseAsync(['node', 'test']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Detected shell: bash');
      expect(output).toContain('~/.bashrc');
    });

    it('should detect zsh shell', async () => {
      process.env.SHELL = '/usr/bin/zsh';
      
      const cmd = createTestCommand(setupCompletionCommand);
      await cmd.parseAsync(['node', 'test']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Detected shell: zsh');
      expect(output).toContain('~/.zshrc');
    });

    it('should detect PowerShell on Windows', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'win32',
        configurable: true
      });
      process.env.PSModulePath = 'C:\\Modules';
      delete process.env.SHELL;
      
      const cmd = createTestCommand(setupCompletionCommand);
      await cmd.parseAsync(['node', 'test']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Detected shell: powershell');
      
      // Restore platform
      Object.defineProperty(process, 'platform', {
        value: originalCwd.includes('/') ? 'darwin' : 'win32',
        configurable: true
      });
    });

    it('should handle unknown shell', async () => {
      delete process.env.SHELL;
      delete process.env.PSModulePath;
      
      const cmd = createTestCommand(setupCompletionCommand);
      await cmd.parseAsync(['node', 'test']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Could not detect your shell');
      expect(output).toContain('ailock completion bash --install-instructions');
      expect(output).toContain('ailock completion zsh --install-instructions');
    });

    it('should show completion features', async () => {
      process.env.SHELL = '/bin/bash';
      
      const cmd = createTestCommand(setupCompletionCommand);
      await cmd.parseAsync(['node', 'test']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Features:');
      expect(output).toContain('Command completion');
      expect(output).toContain('File path completion');
      expect(output).toContain('Context-aware suggestions');
    });
  });

  describe('Completion Helper Command', () => {
    let mockAdapter: any;

    beforeEach(() => {
      // Mock platform adapter
      mockAdapter = {
        isLocked: vi.fn().mockResolvedValue(false)
      };
      vi.spyOn(platformModule, 'getPlatformAdapter').mockReturnValue(mockAdapter);

      // Mock config
      vi.spyOn(configModule, 'loadConfig').mockResolvedValue({
        patterns: ['.env', '*.key', '*.secret'],
        useGitignore: true,
        configPath: '.ailock'
      });
      
      vi.spyOn(configModule, 'findProtectedFiles').mockResolvedValue([
        join(tempDir, '.env'),
        join(tempDir, 'app.key'),
        join(tempDir, 'config.secret')
      ]);
    });

    describe('Command completions', () => {
      it('should return all commands when no partial', async () => {
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'commands']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('init');
        expect(output).toContain('lock');
        expect(output).toContain('unlock');
        expect(output).toContain('status');
        expect(output).toContain('help');
      });

      it('should filter commands by partial', async () => {
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'commands', '--partial', 'lo']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('lock');
        expect(output).not.toContain('unlock');
        expect(output).not.toContain('init');
      });

      it('should return JSON output when requested', async () => {
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'commands', '--partial', 'lo', '--json']);
        
        const output = consoleLogSpy.mock.calls[0][0];
        const response = JSON.parse(output);
        
        expect(response).toHaveProperty('suggestions');
        expect(response.suggestions).toContain('lock');
      });
    });

    describe('File completions', () => {
      beforeEach(async () => {
        // Create test files
        await writeFile(join(tempDir, '.env'), 'content');
        await writeFile(join(tempDir, 'app.key'), 'content');
        await writeFile(join(tempDir, 'config.secret'), 'content');
        await writeFile(join(tempDir, 'regular.txt'), 'content');
      });

      it('should return protected files', async () => {
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'files']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output.length).toBeGreaterThan(0);
      });

      it('should filter files by partial', async () => {
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'files', '--partial', 'app']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output.some(f => f.includes('app'))).toBe(true);
      });
    });

    describe('Locked/Unlocked file completions', () => {
      it('should return locked files', async () => {
        // Mock some files as locked
        mockAdapter.isLocked
          .mockResolvedValueOnce(true)  // .env is locked
          .mockResolvedValueOnce(false) // app.key is not locked
          .mockResolvedValueOnce(true); // config.secret is locked
        
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'locked-files']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('.env');
        expect(output).toContain('config.secret');
        expect(output).not.toContain('app.key');
      });

      it('should return unlocked files', async () => {
        // Mock all files as unlocked
        mockAdapter.isLocked.mockResolvedValue(false);
        
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'unlocked-files']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('.env');
        expect(output).toContain('app.key');
        expect(output).toContain('config.secret');
      });
    });

    describe('Pattern completions', () => {
      it('should return config patterns', async () => {
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'patterns']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('.env');
        expect(output).toContain('*.key');
        expect(output).toContain('*.secret');
      });

      it('should return common patterns on config error', async () => {
        vi.mocked(configModule.loadConfig).mockRejectedValue(new Error('No config'));
        
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'patterns']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output.some(p => p.includes('.env'))).toBe(true);
        expect(output.some(p => p.includes('.key'))).toBe(true);
      });
    });

    describe('Option completions', () => {
      it('should return options for lock command', async () => {
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'options', '--command', 'lock']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('--verbose');
        expect(output).toContain('--dry-run');
        expect(output).toContain('--no-gitignore');
      });

      it('should return options for unlock command', async () => {
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'options', '--command', 'unlock']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('--verbose');
        expect(output).toContain('--dry-run');
        expect(output).toContain('--all');
      });

      it('should filter options by partial', async () => {
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'options', '--command', 'lock', '--partial', '--v']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('--verbose');
        expect(output).not.toContain('--dry-run');
      });

      it('should return empty for unknown commands', async () => {
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'options', '--command', 'unknown']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toHaveLength(0);
      });
    });

    describe('Error handling', () => {
      it('should fail silently for non-JSON output', async () => {
        // Force an error by using invalid type
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'invalid']);
        
        // Should not output anything
        expect(consoleLogSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      });

      it('should return empty suggestions on error with JSON', async () => {
        // Force an error
        vi.mocked(configModule.loadConfig).mockRejectedValue(new Error('Config error'));
        
        const cmd = createTestCommand(completionHelperCommand);
        await cmd.parseAsync(['node', 'test', '--type', 'files', '--json']);
        
        const output = consoleLogSpy.mock.calls[0][0];
        const response = JSON.parse(output);
        
        expect(response).toEqual({ suggestions: [] });
      });
    });
  });

  describe('Integration with actual file system', () => {
    beforeEach(() => {
      // Restore real implementations
      vi.restoreAllMocks();
    });

    it('should provide real file completions', async () => {
      // Create config and files
      await writeFile(join(tempDir, '.ailock'), '.env\n*.key');
      await writeFile(join(tempDir, '.env'), 'SECRET=value');
      await writeFile(join(tempDir, 'app.key'), 'key-content');
      await writeFile(join(tempDir, 'other.txt'), 'other');
      
      const cmd = createTestCommand(completionHelperCommand);
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      await cmd.parseAsync(['node', 'test', '--type', 'files', '--cwd', tempDir]);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]);
      expect(output).toContain('.env');
      expect(output).toContain('app.key');
      expect(output).not.toContain('other.txt'); // Not in patterns
    });
  });
});

/**
 * Helper function to create a test command instance
 */
function createTestCommand(originalCommand: any): any {
  // Get the command name properly
  const commandName = originalCommand._name || 'test';
  const cmd = new originalCommand.constructor(commandName);
  
  // Copy configuration
  const desc = originalCommand._description;
  if (desc) {
    cmd.description(desc);
  }
  
  // Copy arguments and options
  const args = originalCommand._args || [];
  args.forEach((arg: any) => {
    cmd.argument(arg.argDetails || `<${arg.name}>`, arg.description);
  });
  
  originalCommand.options.forEach((opt: any) => {
    cmd.option(opt.flags, opt.description);
  });
  
  // Copy action
  if (originalCommand._actionHandler) {
    cmd.action(originalCommand._actionHandler);
  }
  
  // Configure for testing
  cmd.exitOverride();
  cmd.configureOutput({
    writeOut: (str: string) => console.log(str),
    writeErr: (str: string) => console.error(str)
  });
  
  return cmd;
}