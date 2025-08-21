import { Command } from 'commander';
import chalk from 'chalk';
import { FileOperationService } from '../services/FileOperationService.js';
import { canLockFile, initializeUserConfig } from '../core/directory-tracker.js';
import { getApiService } from '../services/CliApiService.js';
import { HooksService } from '../services/HooksService.js';
import { isGitRepository, installPreCommitHook, getRepoRoot } from '../core/git.js';

export function createLockCommand(): Command {
  return new Command('lock')
    .description('Lock files to prevent accidental AI modifications (includes complete protection setup)')
    .argument('[patterns...]', 'Files or patterns to lock (uses .ailock if not specified)')
    .option('-a, --all', 'Lock all files defined in .ailock configuration')
    .option('-v, --verbose', 'Show detailed output')
    .option('--dry-run', 'Preview what would be locked without making changes')
    .option('--no-gitignore', 'Include files that are gitignored')
    .option('--no-hooks', 'Skip automatic hook installation')
    .option('--hooks-only', 'Only install hooks, skip file locking')
    .action(lockFileAction);
}

export function createProtectCommand(): Command {
  return new Command('protect')
    .description('Complete protection setup - lock files and install all hooks')
    .argument('[patterns...]', 'Files or patterns to protect (uses .ailock if not specified)')
    .option('-a, --all', 'Protect all files defined in .ailock configuration')
    .option('-v, --verbose', 'Show detailed output')
    .option('--dry-run', 'Preview what would be protected without making changes')
    .option('--no-gitignore', 'Include files that are gitignored')
    .action(async (patterns: string[], options) => {
      // Force enable hooks for protect command
      const protectOptions = { ...options, noHooks: false };
      await lockFileAction(patterns, protectOptions);
    });
}

async function lockFileAction(patterns: string[], options: any) {
  try {
    // Initialize user configuration if needed
    await initializeUserConfig();
    
    const service = new FileOperationService();
    const hooksService = new HooksService();
    
    // If hooks-only mode, just install hooks
    if (options.hooksOnly) {
      await installCompleteProtection(hooksService, options);
      return;
    }
    
    // Lock files first
    if (!options.dryRun) {
      console.log(chalk.blue.bold('🔒 Step 1: Locking files...\n'));
    }
    
    const result = await service.processFiles('lock', {
      patterns,
      all: options.all,
      dryRun: options.dryRun,
      verbose: options.verbose,
      includeGitignored: !options.gitignore
    });

    await service.displaySummary('lock', result, {
      dryRun: options.dryRun,
      verbose: options.verbose
    });

    // Install hooks automatically unless disabled or dry-run
    if (!options.noHooks && !options.dryRun && result.successful.length > 0) {
      console.log(chalk.blue.bold('\n🛡️  Step 2: Installing AI protection...\n'));
      await installCompleteProtection(hooksService, options);
    }

    // Exit with error if any operations failed
    if (result.failed.length > 0 && !options.dryRun) {
      process.exit(1);
    }
    
    // Show complete protection status
    if (!options.dryRun && result.successful.length > 0) {
      await showProtectionStatus(hooksService);
    }
    
  } catch (error) {
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Install complete multi-level protection
 */
async function installCompleteProtection(hooksService: HooksService, options: any): Promise<void> {
  const installations: string[] = [];
  
  // 1. Install Git hooks if in Git repository
  try {
    const isRepo = await isGitRepository();
    if (isRepo) {
      const repoRoot = await getRepoRoot();
      if (repoRoot) {
        await installPreCommitHook(repoRoot, false);
        installations.push('Git pre-commit hooks');
        if (options.verbose) {
          console.log(chalk.green('  ✅ Git hooks installed'));
        }
      }
    } else if (options.verbose) {
      console.log(chalk.gray('  ℹ️  Not a Git repository - skipping Git hooks'));
    }
  } catch (error) {
    if (options.verbose) {
      console.log(chalk.yellow('  ⚠️  Git hooks installation failed:', error instanceof Error ? error.message : String(error)));
    }
  }
  
  // 2. Install Claude Code hooks
  try {
    const claudeInfo = hooksService.detectClaudeCode();
    if (claudeInfo.detected) {
      const status = await hooksService.getHookStatus('claude');
      if (!status.installed) {
        await hooksService.installClaudeHooks(claudeInfo);
        installations.push('Claude Code hooks');
        if (options.verbose) {
          console.log(chalk.green('  ✅ Claude Code hooks installed'));
        }
      } else if (options.verbose) {
        console.log(chalk.gray('  ℹ️  Claude Code hooks already installed'));
      }
    } else if (options.verbose) {
      console.log(chalk.gray('  ℹ️  Claude Code not detected - skipping Claude hooks'));
    }
  } catch (error) {
    if (options.verbose) {
      console.log(chalk.yellow('  ⚠️  Claude hooks installation failed:', error instanceof Error ? error.message : String(error)));
    }
  }
  
  // Summary
  if (installations.length > 0) {
    console.log(chalk.green(`✅ Protection installed: ${installations.join(', ')}`));
  } else {
    console.log(chalk.yellow('⚠️  No additional protection could be installed'));
  }
}

/**
 * Show comprehensive protection status
 */
async function showProtectionStatus(hooksService: HooksService): Promise<void> {
  console.log(chalk.blue.bold('\n🛡️  Protection Status Summary:'));
  console.log(chalk.gray('─'.repeat(40)));
  
  // Check Git protection
  const isRepo = await isGitRepository();
  if (isRepo) {
    console.log(chalk.green('✅ Git Repository: Protected'));
  } else {
    console.log(chalk.gray('○ Git Repository: Not applicable'));
  }
  
  // Check Claude Code protection
  const claudeInfo = hooksService.detectClaudeCode();
  if (claudeInfo.detected) {
    const status = await hooksService.getHookStatus('claude');
    if (status.installed) {
      const scope = claudeInfo.isProjectLevel ? 'Project-level' : 'User-level';
      console.log(chalk.green(`✅ Claude Code: Protected (${scope})`));
    } else {
      console.log(chalk.yellow('⚠️  Claude Code: Not protected'));
    }
  } else {
    console.log(chalk.gray('○ Claude Code: Not detected'));
  }
  
  console.log(chalk.blue('\n🎉 Your files are now protected from accidental AI modifications!'));
}