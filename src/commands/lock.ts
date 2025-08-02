import { Command } from 'commander';
import chalk from 'chalk';
import { loadConfig, findProtectedFiles, LoadConfigOptions } from '../core/config.js';
import { getPlatformAdapter } from '../core/platform.js';

export const lockCommand = new Command('lock')
  .description('Lock files to prevent accidental modifications')
  .argument('[patterns...]', 'Specific file patterns to lock (if not provided, uses .ailock config)')
  .option('-v, --verbose', 'Show verbose output')
  .option('-d, --dry-run', 'Show what would be locked without actually locking')
  .option('--include-gitignored', 'Include sensitive files from .gitignore')
  .action(async (patterns: string[], options) => {
    try {
      const adapter = getPlatformAdapter();
      let filesToLock: string[];

      if (patterns && patterns.length > 0) {
        // Use command line patterns
        const { default: glob } = await import('fast-glob');
        filesToLock = await glob(patterns, {
          absolute: true,
          onlyFiles: true,
          followSymbolicLinks: false,
          ignore: ['node_modules/**', '.git/**']
        });
      } else {
        // Use .ailock configuration
        const configOptions: LoadConfigOptions = {
          includeGitignored: options.includeGitignored
        };
        const config = await loadConfig(undefined, configOptions);
        filesToLock = await findProtectedFiles(config);
        
        if (options.verbose) {
          console.log(chalk.blue('Using patterns from .ailock:'), config.patterns.join(', '));
          if (config.includeGitignored && config.gitIgnorePatterns && config.gitIgnorePatterns.length > 0) {
            console.log(chalk.blue('Sensitive patterns from .gitignore:'), config.gitIgnorePatterns.join(', '));
          }
        }
      }

      if (filesToLock.length === 0) {
        console.log(chalk.yellow('No files found to lock.'));
        return;
      }

      console.log(chalk.blue(`Found ${filesToLock.length} file(s) to lock:`));
      
      let lockedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const file of filesToLock) {
        try {
          const isAlreadyLocked = await adapter.isLocked(file);
          
          if (isAlreadyLocked) {
            if (options.verbose) {
              console.log(chalk.gray(`  🔒 ${file} (already locked)`));
            }
            skippedCount++;
            continue;
          }

          if (options.dryRun) {
            console.log(chalk.cyan(`  🔐 ${file} (would be locked)`));
            continue;
          }

          await adapter.lockFile(file);
          console.log(chalk.green(`  🔒 ${file}`));
          lockedCount++;
        } catch (error) {
          console.error(chalk.red(`  ❌ ${file}: ${error instanceof Error ? error.message : String(error)}`));
          errorCount++;
        }
      }

      // Summary
      if (options.dryRun) {
        console.log(chalk.blue(`\nDry run completed. ${filesToLock.length} file(s) would be processed.`));
      } else {
        console.log(chalk.green(`\n✅ Locked ${lockedCount} file(s)`));
        if (skippedCount > 0) {
          console.log(chalk.gray(`   Skipped ${skippedCount} already locked file(s)`));
        }
        if (errorCount > 0) {
          console.log(chalk.red(`   Failed to lock ${errorCount} file(s)`));
          process.exit(1);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });