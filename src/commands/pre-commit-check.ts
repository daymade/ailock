import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { loadConfig, findProtectedFiles } from '../core/config.js';
import { getPlatformAdapter } from '../core/platform.js';
import { hasStagedChanges } from '../core/git.js';

export const preCommitCheckCommand = new Command('pre-commit-check')
  .description('Check if any staged files are locked (used by Git hooks)')
  .argument('[files...]', 'Files to check (if not provided, checks all staged files)')
  .option('--staged-only', 'Only check files that are staged for commit')
  .action(async (files: string[], options) => {
    try {
      const config = await loadConfig();
      const protectedFiles = await findProtectedFiles(config);
      
      if (protectedFiles.length === 0) {
        // No protected files configured, allow commit
        process.exit(0);
      }
      
      const adapter = getPlatformAdapter();
      const currentDir = process.cwd();
      
      // Determine which files to check
      let filesToCheck: string[];
      
      if (files && files.length > 0) {
        // Use provided files (from Git hook)
        filesToCheck = files.map(f => path.resolve(currentDir, f));
      } else if (options.stagedOnly) {
        // Check only staged files
        filesToCheck = await hasStagedChanges(protectedFiles);
      } else {
        // Check all protected files
        filesToCheck = protectedFiles;
      }
      
      // Check which protected files are being modified and are locked
      const lockedFilesBeingModified: string[] = [];
      const problemFiles: { file: string; relativePath: string; reason: string }[] = [];
      
      for (const file of filesToCheck) {
        // Check if this file is in our protected list
        const isProtected = protectedFiles.some(pf => path.resolve(pf) === path.resolve(file));
        
        if (isProtected) {
          try {
            const isLocked = await adapter.isLocked(file);
            if (isLocked) {
              const relativePath = path.relative(currentDir, file);
              lockedFilesBeingModified.push(file);
              problemFiles.push({
                file,
                relativePath,
                reason: 'File is locked'
              });
            }
          } catch (error) {
            // If we can't check lock status, assume it's a problem
            const relativePath = path.relative(currentDir, file);
            problemFiles.push({
              file,
              relativePath,
              reason: `Cannot check lock status: ${error instanceof Error ? error.message : String(error)}`
            });
          }
        }
      }
      
      if (problemFiles.length === 0) {
        // All clear - no locked files being modified
        if (process.env.AILOCK_VERBOSE) {
          console.log(chalk.green('✅ No locked files being modified'));
        }
        process.exit(0);
      }
      
      // We have locked files being modified - block the commit
      console.error(chalk.red.bold('🔒 Commit blocked: Locked files would be modified\n'));
      
      console.error(chalk.yellow('The following protected files are locked and cannot be committed:'));
      
      for (const problem of problemFiles) {
        console.error(chalk.red(`   ❌ ${problem.relativePath}`));
        if (problem.reason !== 'File is locked') {
          console.error(chalk.gray(`      ${problem.reason}`));
        }
      }
      
      console.error('\n' + chalk.blue.bold('💡 To resolve this:'));
      console.error(chalk.gray('   1. Unlock the files you want to modify:'));
      
      for (const problem of problemFiles) {
        console.error(chalk.gray(`      ailock unlock "${problem.relativePath}"`));
      }
      
      console.error(chalk.gray('   2. Make your changes'));
      console.error(chalk.gray('   3. Lock the files again:'));
      
      for (const problem of problemFiles) {
        console.error(chalk.gray(`      ailock lock "${problem.relativePath}"`));
      }
      
      console.error(chalk.gray('   4. Commit your changes'));
      
      console.error('\n' + chalk.blue('Alternative:'));
      console.error(chalk.gray('   • Unlock all protected files: ailock unlock'));
      console.error(chalk.gray('   • Make changes and commit'));
      console.error(chalk.gray('   • Lock all files again: ailock lock'));
      
      // Exit with error code to block the commit
      process.exit(1);
      
    } catch (error) {
      console.error(chalk.red('Error during pre-commit check:'), error instanceof Error ? error.message : String(error));
      // On error, allow commit to proceed (fail-open for availability)
      console.error(chalk.yellow('⚠️  Allowing commit to proceed due to check error'));
      process.exit(0);
    }
  });