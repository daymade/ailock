import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HooksService } from '../../../src/services/HooksService.js';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';

// Mock fs module
vi.mock('fs');
vi.mock('fs/promises');

describe('HooksService', () => {
  let service: HooksService;

  beforeEach(() => {
    service = new HooksService();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('detectClaudeCode', () => {
    it('should detect Claude Code via environment variable', () => {
      process.env.CLAUDE_PROJECT_DIR = '/test/project';
      vol.mkdirSync('/test/project/.claude', { recursive: true });
      
      const result = service.detectClaudeCode();
      
      expect(result.detected).toBe(true);
      expect(result.projectDir).toBe('/test/project');
      expect(result.isProjectLevel).toBe(true);
      
      delete process.env.CLAUDE_PROJECT_DIR;
    });

    it('should detect project-level Claude Code directory', () => {
      vol.mkdirSync('.claude', { recursive: true });
      
      const result = service.detectClaudeCode();
      
      expect(result.detected).toBe(true);
      expect(result.isProjectLevel).toBe(true);
    });

    it('should detect user-level Claude Code directory', () => {
      const homeDir = process.env.HOME || process.env.USERPROFILE || '/home/user';
      vol.mkdirSync(path.join(homeDir, '.claude'), { recursive: true });
      
      const result = service.detectClaudeCode();
      
      expect(result.detected).toBe(true);
      expect(result.isProjectLevel).toBe(false);
    });

    it('should return not detected when Claude Code is not found', () => {
      const result = service.detectClaudeCode();
      
      expect(result.detected).toBe(false);
    });
  });

  describe('installClaudeHooks', () => {
    it('should install hooks for project-level Claude Code', async () => {
      const mockInfo = {
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      };

      // Mock hook script exists
      vol.fromJSON({
        '/test/hooks/claude-ailock-hook.js': 'hook content',
        '.claude/settings.json': JSON.stringify({ model: 'opus' })
      });

      await service.installClaudeHooks(mockInfo);

      // Verify settings were updated
      const settings = JSON.parse(vol.readFileSync('.claude/settings.json', 'utf-8') as string);
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.PreToolUse).toBeDefined();
    });

    it('should merge with existing settings', async () => {
      const mockInfo = {
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      };

      const existingSettings = {
        model: 'opus',
        hooks: {
          PreToolUse: [
            {
              matcher: 'OtherTool',
              hooks: [{ type: 'command', command: 'other.js' }]
            }
          ]
        }
      };

      vol.fromJSON({
        '/test/hooks/claude-ailock-hook.js': 'hook content',
        '.claude/settings.json': JSON.stringify(existingSettings)
      });

      await service.installClaudeHooks(mockInfo);

      const settings = JSON.parse(vol.readFileSync('.claude/settings.json', 'utf-8') as string);
      expect(settings.hooks.PreToolUse).toHaveLength(2);
    });

    it('should throw error if hook script not found', async () => {
      const mockInfo = {
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      };

      await expect(service.installClaudeHooks(mockInfo)).rejects.toThrow();
    });

    it('should remove duplicate hooks', async () => {
      const mockInfo = {
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      };

      const hookPath = '/test/hooks/claude-ailock-hook.js';
      const existingSettings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [{ type: 'command', command: hookPath }]
            }
          ]
        }
      };

      vol.fromJSON({
        [hookPath]: 'hook content',
        '.claude/settings.json': JSON.stringify(existingSettings)
      });

      await service.installClaudeHooks(mockInfo);

      const settings = JSON.parse(vol.readFileSync('.claude/settings.json', 'utf-8') as string);
      expect(settings.hooks.PreToolUse).toHaveLength(1);
    });
  });

  describe('uninstallClaudeHooks', () => {
    it('should remove ailock hooks from settings', async () => {
      const mockInfo = {
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      };

      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [{ 
                type: 'command', 
                command: '/test/hooks/claude-ailock-hook.js' 
              }]
            },
            {
              matcher: 'OtherTool',
              hooks: [{ type: 'command', command: 'other.js' }]
            }
          ]
        }
      };

      vol.fromJSON({
        '.claude/settings.json': JSON.stringify(settings)
      });

      await service.uninstallClaudeHooks(mockInfo);

      const updatedSettings = JSON.parse(vol.readFileSync('.claude/settings.json', 'utf-8') as string);
      expect(updatedSettings.hooks.PreToolUse).toHaveLength(1);
      expect(updatedSettings.hooks.PreToolUse[0].matcher).toBe('OtherTool');
    });

    it('should handle missing settings file gracefully', async () => {
      const mockInfo = {
        detected: true,
        settingsPath: '.claude/settings.json',
        isProjectLevel: true
      };

      await expect(service.uninstallClaudeHooks(mockInfo)).resolves.not.toThrow();
    });
  });

  describe('getHookStatus', () => {
    it('should return installed status when hooks are present', async () => {
      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [{ 
                type: 'command', 
                command: '/test/hooks/claude-ailock-hook.js' 
              }]
            }
          ]
        }
      };

      vol.fromJSON({
        '.claude/settings.json': JSON.stringify(settings)
      });

      const status = await service.getHookStatus('claude');
      
      expect(status.installed).toBe(true);
      expect(status.location).toBe('.claude/settings.json');
      expect(status.hookCount).toBe(1);
    });

    it('should return not installed when no hooks found', async () => {
      vol.fromJSON({
        '.claude/settings.json': JSON.stringify({ model: 'opus' })
      });

      const status = await service.getHookStatus('claude');
      
      expect(status.installed).toBe(false);
    });

    it('should handle unsupported AI tools', async () => {
      const status = await service.getHookStatus('copilot');
      
      expect(status.installed).toBe(false);
      expect(status.error).toContain('not supported');
    });
  });
});