import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { mkdir, writeFile, rm, realpath } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';
import {
  completionCommand,
  setupCompletionCommand,
  shellGenerators
} from '../../src/commands/completion.js';
import { completionHelperCommand } from '../../src/commands/completion-helper.js';
import { generateBashCompletion } from '../../src/completion/templates/bash.js';
import { generateZshCompletion } from '../../src/completion/templates/zsh.js';
import { generateFishCompletion } from '../../src/completion/templates/fish.js';
import { generatePowerShellCompletion } from '../../src/completion/templates/powershell.js';
import {
  PUBLIC_COMPLETION_SPEC,
  PUBLIC_GLOBAL_OPTION_WORDS
} from '../../src/completion/spec.js';
import { initCommand } from '../../src/commands/init.js';
import { createLockCommand, createProtectCommand } from '../../src/commands/lock.js';
import { unlockCommand } from '../../src/commands/unlock.js';
import { statusCommand } from '../../src/commands/status.js';
import { authCommand } from '../../src/commands/auth.js';
import { quotaCommand } from '../../src/commands/quota.js';
import { createEditCommand } from '../../src/commands/edit.js';
import { createEmergencyUnlockCommand } from '../../src/commands/emergency-unlock.js';
import { createDoctorCommand } from '../../src/commands/doctor.js';
import { listCommand } from '../../src/commands/list.js';
import { diagnoseCommand } from '../../src/commands/diagnose.js';
import { generateCommand } from '../../src/commands/generate.js';
import { createHooksCommand } from '../../src/commands/hooks.js';
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
    tempDir = join(tmpdir(), `tinkle_ailock-completion-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    tempDir = await realpath(tempDir);
    
    originalCwd = process.cwd();
    process.chdir(tempDir);
    
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    
    originalExit = process.exit;
    process.exit = vi.fn() as any;
    
    originalEnv = { ...process.env };
    
    // Configure commands to not exit during tests
    completionCommand.exitOverride();
    setupCompletionCommand.exitOverride();
    completionHelperCommand.exitOverride();
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
    it('keeps the completion manifest aligned with the public Commander tree', () => {
      const commands = [
        initCommand,
        createLockCommand(),
        createProtectCommand(),
        unlockCommand,
        authCommand,
        quotaCommand,
        createEditCommand(),
        createEmergencyUnlockCommand(),
        createDoctorCommand(),
        statusCommand,
        listCommand,
        diagnoseCommand,
        generateCommand,
        createHooksCommand(),
        completionCommand,
        setupCompletionCommand
      ];
      const manifestNames = Object.keys(PUBLIC_COMPLETION_SPEC).filter(name => name !== 'help');

      expect(commands.map(command => command.name()).sort()).toEqual(manifestNames.sort());

      for (const command of commands) {
        const spec = PUBLIC_COMPLETION_SPEC[command.name() as keyof typeof PUBLIC_COMPLETION_SPEC];
        expect(command.options.map(option => option.long).sort()).toEqual([...(spec.options || [])].sort());

        const expectedSubcommands = Object.keys('subcommands' in spec ? spec.subcommands || {} : {});
        expect(command.commands.map(subcommand => subcommand.name()).sort()).toEqual(expectedSubcommands.sort());

        for (const subcommand of command.commands) {
          const subcommandSpec = 'subcommands' in spec
            ? spec.subcommands?.[subcommand.name() as keyof typeof spec.subcommands]
            : undefined;
          expect(subcommand.options.map(option => option.long).sort()).toEqual(
            [...(subcommandSpec?.options || [])].sort()
          );
        }
      }
    });

    it('renders every public command, subcommand, and option in all four shells', () => {
      const scripts = [
        ['bash', generateBashCompletion()],
        ['zsh', generateZshCompletion()],
        ['fish', generateFishCompletion()],
        ['powershell', generatePowerShellCompletion()]
      ] as const;

      for (const [shell, script] of scripts) {
        for (const option of PUBLIC_GLOBAL_OPTION_WORDS) {
          const rendered = shell === 'fish' && !script.includes(option)
            ? option.startsWith('--')
              ? `-l ${option.slice(2)}`
              : `-s ${option.slice(1)}`
            : option;
          expect(script).toContain(rendered);
        }
        for (const [command, spec] of Object.entries(PUBLIC_COMPLETION_SPEC)) {
          expect(script).toContain(command);
          for (const option of 'options' in spec ? spec.options || [] : []) {
            const rendered = shell === 'fish' && !script.includes(option)
              ? `-l ${option.slice(2)}`
              : option;
            expect(script).toContain(rendered);
          }
          for (const [subcommand, subcommandSpec] of Object.entries(
            'subcommands' in spec ? spec.subcommands || {} : {}
          )) {
            expect(script).toContain(subcommand);
            for (const option of subcommandSpec.options || []) {
              const rendered = shell === 'fish' && !script.includes(option)
                ? `-l ${option.slice(2)}`
                : option;
              expect(script).toContain(rendered);
            }
          }
        }
        expect(script).toContain('github-actions');
        expect(script).not.toContain('status-interactive');
        expect(script).not.toContain('bitbucket');
        expect(script).not.toContain('jenkins');
        expect(script).not.toContain('circleci');
      }
    });

    it('should generate bash completion script', async () => {
      await completionCommand.parseAsync(['node', 'test', 'bash']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('# ailock bash completion');
      expect(output).toContain('_ailock_completion');
      expect(output).toContain('COMPREPLY');
    });

    it('should generate zsh completion script', async () => {
      await completionCommand.parseAsync(['node', 'test', 'zsh']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('# ailock zsh completion');
      expect(output).toContain('#compdef ailock');
      expect(output).toContain('_ailock');
    });

    it('should generate fish completion script', async () => {
      await completionCommand.parseAsync(['node', 'test', 'fish']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('# ailock fish completion');
      expect(output).toContain('complete -c ailock');
    });

    it('should generate PowerShell completion script', async () => {
      await completionCommand.parseAsync(['node', 'test', 'powershell']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('# ailock PowerShell completion');
      expect(output).toContain('Register-ArgumentCompleter');
    });

    it('should show installation instructions', async () => {
      await completionCommand.parseAsync(['node', 'test', 'bash', '--install-instructions']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Installation Instructions for bash');
      expect(output).toContain('~/.bashrc');
      expect(output).toContain('source');
    });

    it('should handle unsupported shells', async () => {
      try {
        await completionCommand.parseAsync(['node', 'test', 'unsupported-shell']);
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
      const originalGenerator = shellGenerators.bash;
      shellGenerators.bash = () => {
        throw new Error('Template error');
      };

      try {
        await completionCommand.parseAsync(['node', 'test', 'bash']);
      } catch (e) {
        // Expected
      } finally {
        shellGenerators.bash = originalGenerator;
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
      
      await setupCompletionCommand.parseAsync(['node', 'test']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Detected shell: bash');
      expect(output).toContain('~/.bashrc');
    });

    it('should detect zsh shell', async () => {
      process.env.SHELL = '/usr/bin/zsh';
      
      await setupCompletionCommand.parseAsync(['node', 'test']);
      
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
      
      await setupCompletionCommand.parseAsync(['node', 'test']);
      
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
      
      await setupCompletionCommand.parseAsync(['node', 'test']);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]).join('\n');
      expect(output).toContain('Could not detect your shell');
      expect(output).toContain('ailock completion bash --install-instructions');
      expect(output).toContain('ailock completion zsh --install-instructions');
    });

    it('should show completion features', async () => {
      process.env.SHELL = '/bin/bash';
      
      await setupCompletionCommand.parseAsync(['node', 'test']);
      
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
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'commands']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('init');
        expect(output).toContain('lock');
        expect(output).toContain('unlock');
        expect(output).toContain('status');
        expect(output).toContain('doctor');
        expect(output).toContain('hooks');
        expect(output).toContain('setup-completion');
        expect(output).toContain('help');
      });

      it('should filter commands by partial', async () => {
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'commands', '--partial', 'lo']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('lock');
        expect(output).not.toContain('unlock');
        expect(output).not.toContain('init');
      });

      it('should return JSON output when requested', async () => {
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'commands', '--partial', 'lo', '--json']);
        
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
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'files']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output.length).toBeGreaterThan(0);
      });

      it('should filter files by partial', async () => {
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'files', '--partial', 'app']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output.some(f => f.includes('app'))).toBe(true);
      });
    });

    describe('Locked/Unlocked file completions', () => {
      beforeEach(async () => {
        // Create test files
        await writeFile(join(tempDir, '.env'), 'content');
        await writeFile(join(tempDir, 'app.key'), 'content');
        await writeFile(join(tempDir, 'config.secret'), 'content');
      });

      it('should return locked files', async () => {
        // Mock some files as locked
        mockAdapter.isLocked
          .mockResolvedValueOnce(true)  // .env is locked
          .mockResolvedValueOnce(false) // app.key is not locked
          .mockResolvedValueOnce(true); // config.secret is locked
        
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'locked-files']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('.env');
        expect(output).toContain('config.secret');
        expect(output).not.toContain('app.key');
      });

      it('should return unlocked files', async () => {
        // Mock all files as unlocked
        mockAdapter.isLocked.mockResolvedValue(false);
        
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'unlocked-files']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('.env');
        expect(output).toContain('app.key');
        expect(output).toContain('config.secret');
      });
    });

    describe('Pattern completions', () => {
      it('should return config patterns', async () => {
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'patterns']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('.env');
        expect(output).toContain('*.key');
        expect(output).toContain('*.secret');
      });

      it('should return common patterns on config error', async () => {
        vi.mocked(configModule.loadConfig).mockRejectedValue(new Error('No config'));
        
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'patterns']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output.some(p => p.includes('.env'))).toBe(true);
        expect(output.some(p => p.includes('.key'))).toBe(true);
      });
    });

    describe('Option completions', () => {
      it('should return options for lock command', async () => {
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'options', '--command', 'lock']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('--verbose');
        expect(output).toContain('--dry-run');
        expect(output).toContain('--no-gitignore');
      });

      it('should return options for unlock command', async () => {
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'options', '--command', 'unlock']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('--verbose');
        expect(output).toContain('--dry-run');
        expect(output).toContain('--all');
      });

      it('should filter options by partial', async () => {
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'options', '--command', 'lock', '--partial', '--v']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toContain('--verbose');
        expect(output).not.toContain('--dry-run');
      });

      it('should return empty for unknown commands', async () => {
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'options', '--command', 'unknown']);
        
        const output = consoleLogSpy.mock.calls.map(call => call[0]);
        expect(output).toHaveLength(0);
      });
    });

    describe('Error handling', () => {
      it('should fail silently for non-JSON output', async () => {
        // Force an error by using invalid type
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'invalid']);
        
        // Should not output anything
        expect(consoleLogSpy).not.toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
      });

      it('should return empty suggestions on error with JSON', async () => {
        // Force an error
        vi.mocked(configModule.loadConfig).mockRejectedValue(new Error('Config error'));
        
        // const cmd = completionHelperCommand;
        await completionHelperCommand.parseAsync(['node', 'test', '--type', 'files', '--json']);
        
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
      
      // const cmd = completionHelperCommand;
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      await completionHelperCommand.parseAsync(['node', 'test', '--type', 'files', '--cwd', tempDir]);
      
      const output = consoleLogSpy.mock.calls.map(call => call[0]);
      expect(output).toContain('.env');
      expect(output).toContain('app.key');
      expect(output).not.toContain('other.txt'); // Not in patterns
    });
  });
});
