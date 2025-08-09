import { existsSync } from 'fs';
import { writeFile, mkdir, chmod, readFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Information about Claude Code installation
 */
export interface ClaudeCodeInfo {
  detected: boolean;
  projectDir?: string;
  settingsPath?: string;
  isProjectLevel?: boolean;
}

/**
 * Hook installation status
 */
export interface HookStatus {
  installed: boolean;
  location?: string;
  hookCount?: number;
  error?: string;
}

/**
 * Hook configuration for Claude Code
 */
interface HookConfig {
  hooks: {
    PreToolUse: Array<{
      matcher: string;
      hooks: Array<{
        type: string;
        command: string;
        timeout?: number;
      }>;
    }>;
  };
}

/**
 * Service for managing AI tool hooks
 * Follows Single Responsibility Principle - only manages hook operations
 */
export class HooksService {
  private readonly SUPPORTED_TOOLS = ['claude'] as const;
  private readonly HOOK_TIMEOUT = 5000;
  
  /**
   * Detect Claude Code installation
   * Open/Closed Principle - can be extended for other AI tools
   */
  public detectClaudeCode(): ClaudeCodeInfo {
    // Primary: Environment variable set automatically by Claude Code
    if (process.env.CLAUDE_PROJECT_DIR) {
      const projectSettingsPath = path.join(process.env.CLAUDE_PROJECT_DIR, '.claude/settings.json');
      return {
        detected: true,
        projectDir: process.env.CLAUDE_PROJECT_DIR,
        settingsPath: projectSettingsPath,
        isProjectLevel: existsSync(projectSettingsPath)
      };
    }
    
    // Secondary: Check for .claude directory in project
    const projectClaudeDir = '.claude';
    if (existsSync(projectClaudeDir)) {
      return {
        detected: true,
        settingsPath: path.join(projectClaudeDir, 'settings.json'),
        isProjectLevel: true
      };
    }
    
    // Tertiary: Check for user-level Claude Code
    const userClaudeDir = path.join(homedir(), '.claude');
    if (existsSync(userClaudeDir)) {
      return {
        detected: true,
        settingsPath: path.join(userClaudeDir, 'settings.json'),
        isProjectLevel: false
      };
    }
    
    return { detected: false };
  }

  /**
   * Find ailock installation path
   * DRY - reused by both init and hooks commands
   */
  public findAilockInstallation(): string {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    
    // Check if we're in the ailock development directory
    const devAilock = path.resolve(projectDir, 'dist/index.js');
    if (existsSync(devAilock)) {
      return `node ${devAilock}`;
    }
    
    // Check for local installation
    const localAilock = path.resolve(projectDir, 'node_modules/.bin/ailock');
    if (existsSync(localAilock)) {
      return localAilock;
    }
    
    // Check for global installation
    try {
      execSync('which ailock 2>/dev/null || where ailock 2>NUL', { stdio: 'pipe' });
      return 'ailock';
    } catch {
      // Fallback to npx
      return 'npx @code-is-cheap/ailock';
    }
  }

  /**
   * Get the path to the hook script
   * Dependency Inversion - returns path, doesn't depend on file existence
   */
  private getHookScriptPath(): string {
    return path.resolve(__dirname, '../../hooks/claude-ailock-hook.js');
  }

  /**
   * Create hook configuration
   * Interface Segregation - returns only what's needed for hooks
   */
  private createHookConfig(hookScriptPath: string): HookConfig {
    return {
      hooks: {
        PreToolUse: [
          {
            matcher: "Write|Edit|MultiEdit|NotebookEdit",
            hooks: [
              {
                type: "command",
                command: hookScriptPath,
                timeout: this.HOOK_TIMEOUT
              }
            ]
          }
        ]
      }
    };
  }

  /**
   * Install Claude Code hooks
   * Main installation logic, follows SRP
   */
  public async installClaudeHooks(claudeInfo: ClaudeCodeInfo): Promise<void> {
    // 1. Find hook script path
    const hookScriptPath = this.getHookScriptPath();
    
    // If hook doesn't exist in package, throw error
    if (!existsSync(hookScriptPath)) {
      throw new Error(`Claude Code hook script not found at: ${hookScriptPath}`);
    }
    
    // 2. Make hook executable
    try {
      await chmod(hookScriptPath, 0o755);
    } catch {
      // May not be necessary on all platforms
    }
    
    // 3. Prepare Claude Code settings
    const hookConfig = this.createHookConfig(hookScriptPath);
    
    // 4. Merge with existing settings or create new
    const settingsPath = claudeInfo.settingsPath || '.claude/settings.json';
    const mergedSettings = await this.mergeSettings(settingsPath, hookConfig);
    
    // 5. Write settings
    await writeFile(settingsPath, JSON.stringify(mergedSettings, null, 2));
    
    // 6. Quick verification
    if (!existsSync(settingsPath)) {
      throw new Error('Failed to write Claude Code settings');
    }
  }

  /**
   * Merge hook configuration with existing settings
   * DRY - extracted from install logic for reuse
   */
  private async mergeSettings(settingsPath: string, hookConfig: HookConfig): Promise<any> {
    let existingSettings = {};
    
    if (existsSync(settingsPath)) {
      try {
        const content = await readFile(settingsPath, 'utf-8');
        existingSettings = JSON.parse(content);
      } catch {
        // Invalid JSON, will overwrite
      }
    } else {
      // Create directory if needed
      const settingsDir = path.dirname(settingsPath);
      if (!existsSync(settingsDir)) {
        await mkdir(settingsDir, { recursive: true });
      }
    }
    
    // Merge settings (deep merge for hooks)
    const mergedSettings = {
      ...existingSettings,
      hooks: {
        ...(existingSettings as any).hooks,
        PreToolUse: [
          ...((existingSettings as any).hooks?.PreToolUse || []),
          ...hookConfig.hooks.PreToolUse
        ]
      }
    };
    
    // Remove duplicates based on command path
    if (mergedSettings.hooks.PreToolUse.length > 1) {
      const seen = new Set();
      mergedSettings.hooks.PreToolUse = mergedSettings.hooks.PreToolUse.filter((item: any) => {
        const key = item.hooks?.[0]?.command;
        if (key && seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    }
    
    return mergedSettings;
  }

  /**
   * Uninstall Claude Code hooks
   * Liskov Substitution - can be called independently
   */
  public async uninstallClaudeHooks(claudeInfo: ClaudeCodeInfo): Promise<void> {
    const settingsPath = claudeInfo.settingsPath || '.claude/settings.json';
    
    if (!existsSync(settingsPath)) {
      // No settings file, nothing to uninstall
      return;
    }
    
    try {
      const content = await readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(content);
      
      if (settings.hooks?.PreToolUse) {
        // Filter out ailock hooks
        settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter((item: any) => {
          const command = item.hooks?.[0]?.command;
          return !command || !command.includes('claude-ailock-hook');
        });
        
        // Remove empty hooks object if no hooks left
        if (settings.hooks.PreToolUse.length === 0) {
          delete settings.hooks.PreToolUse;
        }
        if (Object.keys(settings.hooks).length === 0) {
          delete settings.hooks;
        }
        
        // Write updated settings
        await writeFile(settingsPath, JSON.stringify(settings, null, 2));
      }
    } catch (error) {
      throw new Error(`Failed to uninstall hooks: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get hook installation status
   * Open for extension - can add more AI tools
   */
  public async getHookStatus(tool: string): Promise<HookStatus> {
    if (!this.SUPPORTED_TOOLS.includes(tool as any)) {
      return {
        installed: false,
        error: `Tool '${tool}' is not supported. Supported tools: ${this.SUPPORTED_TOOLS.join(', ')}`
      };
    }
    
    if (tool === 'claude') {
      const claudeInfo = this.detectClaudeCode();
      
      if (!claudeInfo.detected) {
        return {
          installed: false,
          error: 'Claude Code not detected'
        };
      }
      
      const settingsPath = claudeInfo.settingsPath || '.claude/settings.json';
      
      if (!existsSync(settingsPath)) {
        return {
          installed: false,
          location: settingsPath
        };
      }
      
      try {
        const content = await readFile(settingsPath, 'utf-8');
        const settings = JSON.parse(content);
        
        const ailockHooks = settings.hooks?.PreToolUse?.filter((item: any) => {
          const command = item.hooks?.[0]?.command;
          return command && command.includes('claude-ailock-hook');
        });
        
        return {
          installed: ailockHooks && ailockHooks.length > 0,
          location: settingsPath,
          hookCount: ailockHooks ? ailockHooks.length : 0
        };
      } catch {
        return {
          installed: false,
          location: settingsPath,
          error: 'Failed to read settings file'
        };
      }
    }
    
    return { installed: false };
  }

  /**
   * List all available AI tools
   * For future extensibility
   */
  public getSupportedTools(): readonly string[] {
    return this.SUPPORTED_TOOLS;
  }
}