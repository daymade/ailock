import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, findProtectedFiles, LoadConfigOptions } from '../core/config.js';
import { getPlatformAdapter } from '../core/platform.js';

export const unlockCommand = new Command('unlock')
  .description('Unlock files to allow modifications')
  .argument('[patterns...]', 'Specific file patterns to unlock (if not provided, uses .ailock config)')
  .option('-v, --verbose', 'Show verbose output')
  .option('-d, --dry-run', 'Show what would be unlocked without actually unlocking')
  .option('-a, --all', 'Unlock all files, even those not in configuration')
  .option('--no-gitignore', 'Exclude sensitive files from .gitignore (gitignore integration is enabled by default)')
  .action(async (patterns: string[], options) => {
    try {
      const adapter = getPlatformAdapter();
      let filesToUnlock: string[];

      if (patterns && patterns.length > 0) {
        // Use command line patterns
        const { default: glob } = await import('fast-glob');
        filesToUnlock = await glob(patterns, {
          absolute: true,
          onlyFiles: true,
          followSymbolicLinks: false,
          ignore: ['node_modules/**', '.git/**']
        });
      } else {
        // Use .ailock configuration
        // Default: include gitignore unless explicitly disabled with --no-gitignore
        const configOptions: LoadConfigOptions = {
          includeGitignored: options.gitignore !== false
        };
        const config = await loadConfig(undefined, configOptions);
        filesToUnlock = await findProtectedFiles(config);
        
        if (options.verbose) {
          console.log(chalk.blue('Using patterns from .ailock:'), config.patterns.join(', '));
          if (configOptions.includeGitignored && config.gitIgnorePatterns && config.gitIgnorePatterns.length > 0) {
            console.log(chalk.blue('Sensitive patterns from .gitignore:'), config.gitIgnorePatterns.join(', '));
          } else if (!configOptions.includeGitignored) {
            console.log(chalk.gray('Gitignore integration: disabled (--no-gitignore)'));
          }
        }
      }

      if (filesToUnlock.length === 0) {
        console.log(chalk.yellow('No files found to unlock.'));
        return;
      }

      console.log(chalk.blue(`Found ${filesToUnlock.length} file(s) to unlock:`));
      
      let unlockedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const file of filesToUnlock) {
        try {
          const isLocked = await adapter.isLocked(file);
          
          if (!isLocked) {
            if (options.verbose) {
              console.log(chalk.gray(`  🔓 ${file} (already unlocked)`));
            }
            skippedCount++;
            continue;
          }

          if (options.dryRun) {
            console.log(chalk.cyan(`  🔐 ${file} (would be unlocked)`));
            continue;
          }

          await adapter.unlockFile(file);
          console.log(chalk.green(`  🔓 ${file}`));
          unlockedCount++;
        } catch (error) {
          console.error(chalk.red(`  ❌ ${file}: ${error instanceof Error ? error.message : String(error)}`));
          errorCount++;
        }
      }

      // Summary
      if (options.dryRun) {
        console.log(chalk.blue(`\nDry run completed. ${filesToUnlock.length} file(s) would be processed.`));
      } else {
        console.log(chalk.green(`\n✅ Unlocked ${unlockedCount} file(s)`));
        if (skippedCount > 0) {
          console.log(chalk.gray(`   Skipped ${skippedCount} already unlocked file(s)`));
        }
        if (errorCount > 0) {
          console.log(chalk.red(`   Failed to unlock ${errorCount} file(s)`));
          process.exit(1);
        }
        
        if (unlockedCount > 0) {
          console.log(chalk.yellow('\n⚠️  Remember to lock these files again after editing!'));
          console.log(chalk.gray('   Run: ailock lock'));
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });