import { existsSync } from 'fs';
import { writeFile, mkdir, chmod, readFile } from 'fs/promises';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { SecureCommandExecutor } from '../security/CommandExecutor.js';

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
interface PreToolUseHook {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
    timeout?: number;
  }>;
}

interface HookConfig {
  hooks: {
    PreToolUse: PreToolUseHook[];
  };
}

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateHookSettings(settings: unknown): asserts settings is Record<string, any> {
  if (!isObject(settings) || (settings.hooks !== undefined && !isObject(settings.hooks))) {
    throw new Error('Unknown settings object shape; hook installation refused');
  }
  const groups = settings.hooks?.PreToolUse;
  if (groups === undefined) return;
  if (!Array.isArray(groups) || groups.some(group =>
    !isObject(group) || !Array.isArray(group.hooks) || group.hooks.some((handler: unknown) =>
      !isObject(handler) || typeof handler.type !== 'string' ||
      (handler.type === 'command' && (typeof handler.command !== 'string' || !handler.command))))) {
    throw new Error('Unknown PreToolUse hook shape; hook installation refused');
  }
}

function parseHookSettings(content: string): Record<string, any> {
  let settings: unknown;
  try {
    settings = JSON.parse(content);
  } catch {
    throw new Error('Settings file is not valid JSON; hook change refused');
  }
  validateHookSettings(settings);
  return settings;
}

/**
 * Claude Code executes hook commands through the platform shell. Keep the
 * executable and script path as separate, quoted arguments so package install
 * prefixes containing spaces cannot turn a working hook into a silent no-op.
 */
export function createShellCommand(
  executable: string,
  args: string[],
  platform: NodeJS.Platform = process.platform
): string {
  const quote = (value: string): string => {
    if (platform === 'win32') {
      // Windows filenames cannot contain a double quote. Quoting the complete
      // argument is sufficient for the cmd.exe shell used by child_process.
      return `"${value}"`;
    }

    return `'${value.replace(/'/g, `'"'"'`)}'`;
  };

  return [executable, ...args].map(quote).join(' ');
}

/**
 * Service for managing AI tool hooks
 * Follows Single Responsibility Principle - only manages hook operations
 */
export class HooksService {
  private readonly SUPPORTED_TOOLS = ['claude'] as const;
  private readonly HOOK_TIMEOUT_SECONDS = 5;
  private readonly commandExecutor: SecureCommandExecutor;
  
  constructor() {
    this.commandExecutor = new SecureCommandExecutor(['which', 'where']);
  }
  
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
        isProjectLevel: true
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
  public async findAilockInstallation(): Promise<string> {
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
    
    // Check for global installation. A missing binary is a configuration
    // error: hooks must never silently download and execute a package.
    try {
      const lookupCommand = process.platform === 'win32' ? 'where' : 'which';
      const result = await this.commandExecutor.executeCommand(lookupCommand, ['ailock']);
      if (result.exitCode === 0 && result.stdout.trim()) {
        return 'ailock';
      }
    } catch {
      // The actionable error below is shared by lookup failures and misses.
    }

    throw new Error('Ailock executable not found; install ailock before configuring hooks');
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
                command: createShellCommand(process.execPath, [hookScriptPath]),
                timeout: this.HOOK_TIMEOUT_SECONDS
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
  private async mergeSettings(settingsPath: string, hookConfig: HookConfig): Promise<HookConfig> {
    let existingSettings: Record<string, any> = {};
    
    if (existsSync(settingsPath)) {
      existingSettings = parseHookSettings(await readFile(settingsPath, 'utf-8'));
    } else {
      // Create directory if needed
      const settingsDir = path.dirname(settingsPath);
      if (!existsSync(settingsDir)) {
        await mkdir(settingsDir, { recursive: true });
      }
    }
    
    validateHookSettings(existingSettings);
    const hooks = existingSettings.hooks ?? {};
    const groups = hooks.PreToolUse ?? [];
    const owned = hookConfig.hooks.PreToolUse[0].hooks[0];
    let found = false;
    // Update only this installation's exact command. Retain mixed groups,
    // custom matchers/metadata and unrelated duplicate commands as authored.
    const updated = groups.map((group: PreToolUseHook) => ({
      ...group,
      hooks: group.hooks.map(handler => {
        if (handler.type !== 'command' || handler.command !== owned.command) return handler;
        found = true;
        return { ...handler, timeout: owned.timeout };
      }),
    }));
    if (!found) updated.push(...hookConfig.hooks.PreToolUse);
    return {
      ...existingSettings,
      hooks: {
        ...hooks,
        PreToolUse: updated,
      }
    };
    
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
      const settings = parseHookSettings(content);
      
      if (settings.hooks?.PreToolUse) {
        const command = this.createHookConfig(this.getHookScriptPath()).hooks.PreToolUse[0].hooks[0].command;
        let removed = false;
        settings.hooks.PreToolUse = settings.hooks.PreToolUse.map((group: PreToolUseHook) => ({
          ...group,
          hooks: group.hooks.filter(handler => {
            if (handler.type !== 'command' || handler.command !== command) return true;
            removed = true;
            return false;
          }),
        }));
        if (!removed) return;
        
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
    if (!this.SUPPORTED_TOOLS.includes(tool as typeof this.SUPPORTED_TOOLS[number])) {
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
        const settings = parseHookSettings(content);
        
        const command = this.createHookConfig(this.getHookScriptPath()).hooks.PreToolUse[0].hooks[0].command;
        const ailockHooks = settings.hooks?.PreToolUse?.flatMap((group: PreToolUseHook) =>
          group.hooks.filter(handler => handler.type === 'command' && handler.command === command));
        
        return {
          installed: Boolean(ailockHooks?.length),
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
