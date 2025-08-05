import { Command } from 'commander';
import { loadConfig, findProtectedFiles } from '../core/config.js';
import { getPlatformAdapter } from '../core/platform.js';
import fastGlob from 'fast-glob';
import path from 'path';

interface CompletionRequest {
  type: 'commands' | 'files' | 'options' | 'locked-files' | 'unlocked-files' | 'patterns';
  partial?: string;
  command?: string;
  cwd?: string;
}

interface CompletionResponse {
  suggestions: string[];
}

/**
 * Hidden command that provides dynamic completions for shell scripts
 */
export const completionHelperCommand = new Command('completion-helper')
  .description('Internal command for shell completion (hidden)')
  .option('--type <type>', 'Type of completion needed')
  .option('--partial <partial>', 'Partial input to complete')
  .option('--command <command>', 'Current command context')
  .option('--cwd <cwd>', 'Current working directory')
  .option('--json', 'Output in JSON format')
  .action(async (options) => {
    try {
      const request: CompletionRequest = {
        type: options.type || 'commands',
        partial: options.partial || '',
        command: options.command,
        cwd: options.cwd || process.cwd()
      };

      const suggestions = await getCompletions(request);
      
      if (options.json) {
        const response: CompletionResponse = { suggestions };
        console.log(JSON.stringify(response));
      } else {
        suggestions.forEach(s => console.log(s));
      }
    } catch (error) {
      // Silent fail for completion to avoid breaking shell
      if (!options.json) {
        process.exit(0);
      }
      console.log(JSON.stringify({ suggestions: [] }));
    }
  });

async function getCompletions(request: CompletionRequest): Promise<string[]> {
  const { type, partial = '', command, cwd = process.cwd() } = request;

  switch (type) {
    case 'commands':
      return getCommandCompletions(partial);
    
    case 'files':
      return getFileCompletions(partial, cwd);
    
    case 'locked-files':
      return getLockedFileCompletions(partial, cwd);
    
    case 'unlocked-files':
      return getUnlockedFileCompletions(partial, cwd);
    
    case 'patterns':
      return getPatternCompletions(partial, cwd);
    
    case 'options':
      return getOptionCompletions(command || '', partial);
    
    default:
      return [];
  }
}

function getCommandCompletions(partial: string): string[] {
  const commands = [
    'init',
    'lock',
    'unlock',
    'status',
    'status-interactive',
    'list',
    'ls',
    'diagnose',
    'generate',
    'install-hooks',
    'completion',
    'help'
  ];
  
  return commands.filter(cmd => cmd.startsWith(partial));
}

async function getFileCompletions(partial: string, cwd: string): Promise<string[]> {
  try {
    // Get config patterns if available
    const config = await loadConfig(cwd);
    const patterns = config?.patterns || ['**/*'];
    
    // Find matching files
    const files = await fastGlob(patterns, {
      cwd,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'coverage/**'],
      onlyFiles: true,
      dot: true
    });
    
    // Filter by partial and limit results
    return files
      .filter(file => file.startsWith(partial))
      .slice(0, 50); // Limit to prevent slow completions
  } catch {
    // Fallback to common patterns
    return [];
  }
}

async function getLockedFileCompletions(partial: string, cwd: string): Promise<string[]> {
  try {
    const config = await loadConfig(cwd);
    const protectedFiles = await findProtectedFiles(config);
    const adapter = getPlatformAdapter();
    
    const lockedFiles: string[] = [];
    for (const file of protectedFiles) {
      try {
        const relativePath = path.relative(cwd, file);
        if (relativePath.startsWith(partial) && await adapter.isLocked(file)) {
          lockedFiles.push(relativePath);
        }
      } catch {
        // Skip files that can't be checked
      }
    }
    
    return lockedFiles.slice(0, 50);
  } catch {
    return [];
  }
}

async function getUnlockedFileCompletions(partial: string, cwd: string): Promise<string[]> {
  try {
    const config = await loadConfig(cwd);
    const protectedFiles = await findProtectedFiles(config);
    const adapter = getPlatformAdapter();
    
    const unlockedFiles: string[] = [];
    for (const file of protectedFiles) {
      try {
        const relativePath = path.relative(cwd, file);
        if (relativePath.startsWith(partial) && !(await adapter.isLocked(file))) {
          unlockedFiles.push(relativePath);
        }
      } catch {
        // Skip files that can't be checked
      }
    }
    
    return unlockedFiles.slice(0, 50);
  } catch {
    return [];
  }
}

async function getPatternCompletions(partial: string, cwd: string): Promise<string[]> {
  try {
    const config = await loadConfig(cwd);
    if (!config?.patterns) return [];
    
    return config.patterns
      .filter(pattern => pattern.startsWith(partial))
      .slice(0, 20);
  } catch {
    // Suggest common patterns
    return [
      '*.env',
      '*.key',
      '*.pem',
      '*.secret',
      '.env*',
      'config/*.json',
      'secrets/**/*',
      '**/*.key',
      '**/*.pem'
    ].filter(pattern => pattern.startsWith(partial));
  }
}

function getOptionCompletions(command: string, partial: string): string[] {
  const optionsByCommand: Record<string, string[]> = {
    init: ['--force', '--interactive', '--config-only'],
    lock: ['--verbose', '--dry-run', '--no-gitignore'],
    unlock: ['--verbose', '--dry-run', '--all', '--no-gitignore'],
    status: ['--verbose', '--simple', '--json'],
    list: ['--all', '--long', '--locked-only', '--unlocked-only', '--json'],
    diagnose: ['--verbose'],
    'install-hooks': ['--force', '--yes'],
    generate: ['github', 'gitlab', 'bitbucket', 'jenkins', 'circleci', 'docker', 'devcontainer']
  };
  
  const options = optionsByCommand[command] || [];
  return options.filter(opt => opt.startsWith(partial));
}