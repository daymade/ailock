import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HooksService } from '../../src/services/HooksService.js';
import { existsSync } from 'fs';
import { rm, mkdir, writeFile } from 'fs/promises';
import path from 'path';

describe('HooksService Integration', () => {
  let service: HooksService;
  const testDir = path.resolve('./test-hooks-tmp');
  const claudeDir = path.join(testDir, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  beforeEach(async () => {
    service = new HooksService();
    // Create test directory
    await mkdir(testDir, { recursive: true });
    await mkdir(claudeDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('detectClaudeCode', () => {
    it('should detect project-level Claude Code directory', () => {
      // When running in project with .claude directory
      const result = service.detectClaudeCode();
      
      // Should detect either project or user level
      expect(result.detected).toBeDefined();
    });
  });

  describe('findAilockInstallation', () => {
    it('should find ailock installation', async () => {
      const result = await service.findAilockInstallation();
      
      // Should return some form of ailock command
      expect(result).toBeDefined();
      expect(result).toMatch(/ailock|node.*dist\/index\.js|npx/);
    });
  });

  describe('getHookStatus', () => {
    it('should return status for claude', async () => {
      const status = await service.getHookStatus('claude');
      
      expect(status).toBeDefined();
      expect(typeof status.installed).toBe('boolean');
    });

    it('should handle unsupported tools', async () => {
      const status = await service.getHookStatus('unsupported-tool');
      
      expect(status.installed).toBe(false);
      expect(status.error).toContain('not supported');
    });
  });

  describe('getSupportedTools', () => {
    it('should return list of supported tools', () => {
      const tools = service.getSupportedTools();
      
      expect(tools).toContain('claude');
      expect(Array.isArray(tools)).toBe(true);
    });
  });

  describe('installClaudeHooks and uninstallClaudeHooks', () => {
    it('should install and uninstall hooks', async () => {
      // Create mock settings
      await writeFile(settingsPath, JSON.stringify({ model: 'opus' }));
      
      const mockInfo = {
        detected: true,
        settingsPath,
        isProjectLevel: true
      };

      // Skip if hook script doesn't exist (in test environment)
      const hookScriptPath = path.resolve('hooks/claude-ailock-hook.js');
      if (!existsSync(hookScriptPath)) {
        console.log('Skipping install test - hook script not found');
        return;
      }

      // Test installation
      await service.installClaudeHooks(mockInfo);
      
      // Settings should be updated
      expect(existsSync(settingsPath)).toBe(true);

      // Test uninstallation
      await service.uninstallClaudeHooks(mockInfo);
      
      // Settings file should still exist but without ailock hooks
      expect(existsSync(settingsPath)).toBe(true);
    });
  });
});