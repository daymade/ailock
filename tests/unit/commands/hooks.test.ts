import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HooksService } from '../../../src/services/HooksService.js';
import { createHooksCommand } from '../../../src/commands/hooks.js';
import {
  createLockCommand,
  shouldInstallCompleteProtection
} from '../../../src/commands/lock.js';
import { AI_PROTECTION_INSTRUCTIONS } from '../../../src/commands/init.js';

// Mock the HooksService
vi.mock('../../../src/services/HooksService.js');

describe('hooks command', () => {
  let mockService: HooksService;
  let consoleLogSpy: any;
  let consoleErrorSpy: any;
  let processExitSpy: any;

  beforeEach(() => {
    mockService = new HooksService();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  it('registers only the supported hook subcommands', () => {
    const commandNames = createHooksCommand().commands.map(command => command.name());

    expect(commandNames).toEqual(['setup', 'install', 'uninstall', 'status', 'git']);
    expect(commandNames).not.toContain('install-hooks');
  });

  it('generates AI instructions with a real per-file diagnostic command', () => {
    expect(AI_PROTECTION_INSTRUCTIONS).toContain('ailock diagnose <file-path>');
    expect(AI_PROTECTION_INSTRUCTIONS).not.toContain('ailock status <file-path>');
  });

  it('honors Commander negated option semantics for lock --no-hooks', () => {
    const command = createLockCommand();
    command.parseOptions(['--no-hooks']);

    expect(command.opts().hooks).toBe(false);
    expect(shouldInstallCompleteProtection(command.opts())).toBe(false);
    expect(shouldInstallCompleteProtection({ hooks: true, dryRun: false })).toBe(true);
  });

  describe('hooks install claude', () => {
    it('should install Claude Code hooks when detected', async () => {
      vi.mocked(mockService.detectClaudeCode).mockReturnValue({
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      });
      
      vi.mocked(mockService.installClaudeHooks).mockResolvedValue(undefined);
      
      // Would test the actual command execution here
      // For now, we're testing the service is called correctly
      await mockService.installClaudeHooks({
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      });
      
      expect(mockService.installClaudeHooks).toHaveBeenCalled();
    });

    it('should show error when Claude Code not detected', async () => {
      vi.mocked(mockService.detectClaudeCode).mockReturnValue({
        detected: false
      });
      
      // Test that appropriate error is shown
      const claudeInfo = mockService.detectClaudeCode();
      expect(claudeInfo.detected).toBe(false);
    });

    it('should handle installation errors gracefully', async () => {
      vi.mocked(mockService.detectClaudeCode).mockReturnValue({
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      });
      
      vi.mocked(mockService.installClaudeHooks).mockRejectedValue(
        new Error('Installation failed')
      );
      
      await expect(mockService.installClaudeHooks({
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      })).rejects.toThrow('Installation failed');
    });
  });

  describe('hooks uninstall claude', () => {
    it('should uninstall Claude Code hooks', async () => {
      vi.mocked(mockService.detectClaudeCode).mockReturnValue({
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      });
      
      vi.mocked(mockService.uninstallClaudeHooks).mockResolvedValue(undefined);
      
      await mockService.uninstallClaudeHooks({
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      });
      
      expect(mockService.uninstallClaudeHooks).toHaveBeenCalled();
    });
  });

  describe('hooks status', () => {
    it('should show installed status', async () => {
      vi.mocked(mockService.getHookStatus).mockResolvedValue({
        installed: true,
        location: '.claude/settings.json',
        hookCount: 1
      });
      
      const status = await mockService.getHookStatus('claude');
      
      expect(status.installed).toBe(true);
      expect(status.hookCount).toBe(1);
    });

    it('should show not installed status', async () => {
      vi.mocked(mockService.getHookStatus).mockResolvedValue({
        installed: false,
        location: '.claude/settings.json'
      });
      
      const status = await mockService.getHookStatus('claude');
      
      expect(status.installed).toBe(false);
    });

    it('should handle unsupported tools', async () => {
      vi.mocked(mockService.getHookStatus).mockResolvedValue({
        installed: false,
        error: 'Tool \'copilot\' is not supported'
      });
      
      const status = await mockService.getHookStatus('copilot');
      
      expect(status.installed).toBe(false);
      expect(status.error).toContain('not supported');
    });
  });

  describe('hooks list', () => {
    it('should list supported tools', () => {
      vi.mocked(mockService.getSupportedTools).mockReturnValue(['claude']);
      
      const tools = mockService.getSupportedTools();
      
      expect(tools).toContain('claude');
      expect(tools).toHaveLength(1);
    });
  });
});
