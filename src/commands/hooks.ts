import { Command } from 'commander';
import chalk from 'chalk';
import { HooksService } from '../services/HooksService.js';

/**
 * Create the hooks command with subcommands
 * Follows Open/Closed Principle - easy to add new AI tools
 */
export const hooksCommand = new Command('hooks')
  .description('Manage AI tool and Git protection hooks')
  .action(() => {
    // Show help if no subcommand provided
    hooksCommand.outputHelp();
  });

// Initialize service (Dependency Injection would be better, but keeping it simple)
const hooksService = new HooksService();

/**
 * Install subcommand
 */
const installCommand = new Command('install')
  .description('Install protection hooks for AI tools')
  .argument('<tool>', 'AI tool name (e.g., claude)')
  .option('-f, --force', 'Force reinstallation even if already installed')
  .action(async (tool: string, options: any) => {
    try {
      console.log(chalk.blue.bold(`🔧 Installing ${tool} hooks...\n`));
      
      if (tool === 'claude') {
        await installClaudeHooks(options);
      } else {
        console.error(chalk.red(`❌ Unsupported tool: ${tool}`));
        console.log(chalk.gray(`Supported tools: ${hooksService.getSupportedTools().join(', ')}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('❌ Installation failed:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Uninstall subcommand
 */
const uninstallCommand = new Command('uninstall')
  .description('Remove protection hooks for AI tools')
  .argument('<tool>', 'AI tool name (e.g., claude)')
  .action(async (tool: string) => {
    try {
      console.log(chalk.blue.bold(`🗑️  Uninstalling ${tool} hooks...\n`));
      
      if (tool === 'claude') {
        await uninstallClaudeHooks();
      } else {
        console.error(chalk.red(`❌ Unsupported tool: ${tool}`));
        console.log(chalk.gray(`Supported tools: ${hooksService.getSupportedTools().join(', ')}`));
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('❌ Uninstallation failed:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Status subcommand
 */
const statusCommand = new Command('status')
  .description('Check hook installation status')
  .argument('[tool]', 'AI tool name (optional, checks all if not specified)')
  .action(async (tool?: string) => {
    try {
      console.log(chalk.blue.bold('🔍 Hook Installation Status\n'));
      
      const tools = tool ? [tool] : hooksService.getSupportedTools();
      
      for (const t of tools) {
        const status = await hooksService.getHookStatus(t);
        
        if (status.error) {
          console.log(chalk.yellow(`${t}: ${status.error}`));
        } else if (status.installed) {
          console.log(chalk.green(`✅ ${t}: Installed`));
          if (status.location) {
            console.log(chalk.gray(`   📍 Location: ${status.location}`));
          }
          if (status.hookCount !== undefined) {
            console.log(chalk.gray(`   🔗 Hooks: ${status.hookCount}`));
          }
        } else {
          console.log(chalk.gray(`❌ ${t}: Not installed`));
          if (status.location) {
            console.log(chalk.gray(`   📍 Would install to: ${status.location}`));
          }
        }
        console.log();
      }
    } catch (error) {
      console.error(chalk.red('❌ Status check failed:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * List subcommand
 */
const listCommand = new Command('list')
  .alias('ls')
  .description('List supported AI tools')
  .action(() => {
    console.log(chalk.blue.bold('🤖 Supported AI Tools\n'));
    
    const tools = hooksService.getSupportedTools();
    tools.forEach(tool => {
      console.log(chalk.green(`  • ${tool}`));
    });
    
    console.log(chalk.gray('\n💡 More tools coming soon!'));
  });

/**
 * Git hooks subcommand (replaces old install-hooks command)
 */
const gitCommand = new Command('git')
  .description('Install Git pre-commit hooks')
  .option('-f, --force', 'Overwrite existing hooks')
  .action(async (options: any) => {
    try {
      // Import git functions
      const { isGitRepository, installPreCommitHook, getRepoRoot } = await import('../core/git.js');
      
      const isGitRepo = await isGitRepository();
      if (!isGitRepo) {
        console.log(chalk.yellow('⚠️  Not a Git repository'));
        console.log(chalk.gray('Git hooks can only be installed in Git repositories'));
        process.exit(1);
      }
      
      const repoRoot = await getRepoRoot();
      if (!repoRoot) {
        throw new Error('Could not determine Git repository root');
      }
      
      await installPreCommitHook(repoRoot, options.force);
      
      console.log(chalk.green('✅ Git pre-commit hooks installed successfully'));
      console.log(chalk.gray('Your locked files are now protected from accidental commits'));
    } catch (error) {
      console.error(chalk.red('❌ Failed to install Git hooks:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

/**
 * Claude-specific shortcut command
 */
const claudeCommand = new Command('claude')
  .description('Quick setup for Claude Code hooks')
  .option('-u, --uninstall', 'Uninstall Claude Code hooks')
  .option('-s, --status', 'Check Claude Code hook status')
  .action(async (options: any) => {
    try {
      if (options.uninstall) {
        await uninstallClaudeHooks();
      } else if (options.status) {
        const status = await hooksService.getHookStatus('claude');
        displayClaudeStatus(status);
      } else {
        await installClaudeHooks({});
      }
    } catch (error) {
      console.error(chalk.red('❌ Operation failed:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Add subcommands to main hooks command
hooksCommand.addCommand(installCommand);
hooksCommand.addCommand(uninstallCommand);
hooksCommand.addCommand(statusCommand);
hooksCommand.addCommand(listCommand);
hooksCommand.addCommand(gitCommand);
hooksCommand.addCommand(claudeCommand);

/**
 * Install Claude Code hooks
 * DRY - shared by multiple commands
 */
async function installClaudeHooks(options: any): Promise<void> {
  const claudeInfo = hooksService.detectClaudeCode();
  
  if (!claudeInfo.detected) {
    console.log(chalk.yellow('⚠️  Claude Code not detected'));
    console.log(chalk.gray('Make sure Claude Code is installed or run this command in a Claude Code session'));
    process.exit(1);
  }
  
  // Check if already installed
  if (!options.force) {
    const status = await hooksService.getHookStatus('claude');
    if (status.installed) {
      console.log(chalk.yellow('⚠️  Claude Code hooks already installed'));
      console.log(chalk.gray('Use --force to reinstall'));
      return;
    }
  }
  
  await hooksService.installClaudeHooks(claudeInfo);
  
  console.log(chalk.green('✅ Claude Code hooks installed successfully!'));
  console.log(chalk.gray(`📍 Location: ${claudeInfo.settingsPath}`));
  
  if (claudeInfo.isProjectLevel) {
    console.log(chalk.gray('📁 Scope: Project-level'));
  } else {
    console.log(chalk.gray('👤 Scope: User-level'));
  }
  
  console.log(chalk.blue.bold('\n🎉 Your files are now protected from accidental AI modifications!'));
  console.log(chalk.gray('Claude Code can read locked files but cannot modify them.'));
}

/**
 * Uninstall Claude Code hooks
 * DRY - shared by multiple commands
 */
async function uninstallClaudeHooks(): Promise<void> {
  const claudeInfo = hooksService.detectClaudeCode();
  
  if (!claudeInfo.detected) {
    console.log(chalk.yellow('⚠️  Claude Code not detected'));
    return;
  }
  
  const status = await hooksService.getHookStatus('claude');
  if (!status.installed) {
    console.log(chalk.yellow('⚠️  Claude Code hooks not installed'));
    return;
  }
  
  await hooksService.uninstallClaudeHooks(claudeInfo);
  
  console.log(chalk.green('✅ Claude Code hooks uninstalled successfully'));
  console.log(chalk.gray('AI tools can now modify all files again'));
}

/**
 * Display Claude Code status
 * DRY - shared display logic
 */
function displayClaudeStatus(status: any): void {
  console.log(chalk.blue.bold('🔍 Claude Code Hook Status\n'));
  
  if (status.error) {
    console.log(chalk.yellow(status.error));
  } else if (status.installed) {
    console.log(chalk.green('✅ Hooks installed'));
    if (status.location) {
      console.log(chalk.gray(`📍 Location: ${status.location}`));
    }
    if (status.hookCount !== undefined) {
      console.log(chalk.gray(`🔗 Active hooks: ${status.hookCount}`));
    }
  } else {
    console.log(chalk.yellow('❌ Hooks not installed'));
    if (status.location) {
      console.log(chalk.gray(`📍 Would install to: ${status.location}`));
    }
    console.log(chalk.gray('\n💡 Run: ailock hooks install claude'));
  }
}