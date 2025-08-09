import { Command } from 'commander';
import chalk from 'chalk';
import { FileOperationService } from '../services/FileOperationService.js';

export const unlockCommand = new Command('unlock')
  .description('Unlock files to allow modifications')
  .argument('[patterns...]', 'Files or patterns to unlock')
  .option('-a, --all', 'Unlock all currently locked files')
  .option('-v, --verbose', 'Show detailed output')
  .option('--dry-run', 'Preview what would be unlocked without making changes')
  .option('--no-gitignore', 'Include files that are gitignored')
  .action(async (patterns: string[], options) => {
    try {
      const service = new FileOperationService();
      
      const result = await service.processFiles('unlock', {
        patterns,
        all: options.all,
        dryRun: options.dryRun,
        verbose: options.verbose,
        includeGitignored: !options.gitignore
      });

      service.displaySummary('unlock', result, {
        dryRun: options.dryRun,
        verbose: options.verbose
      });

      // Exit with error if any operations failed
      if (result.failed.length > 0 && !options.dryRun) {
        process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });