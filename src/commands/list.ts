import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { loadConfig, findProtectedFiles } from '../core/config.js';
import { getPlatformAdapter } from '../core/platform.js';
import { getRepoStatus } from '../core/git.js';

export const listCommand = new Command('list')
  .description('List all protected files and their current status')
  .option('-l, --long', 'Show detailed information for each file')
  .option('--locked-only', 'Show only locked files')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const config = await loadConfig();
      const protectedFiles = await findProtectedFiles(config);
      const adapter = getPlatformAdapter();
      const currentDir = process.cwd();
      
      if (protectedFiles.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ files: [], total: 0 }));
          return;
        }
        
        console.log(chalk.yellow('📄 No protected files found'));
        console.log(chalk.gray('💡 Check your .ailock configuration or create one with: ailock init'));
        return;
      }

      // Get detailed status for each file
      const fileDetails = await Promise.all(
        protectedFiles.map(async (file) => {
          const relativePath = path.relative(currentDir, file);
          let isLocked = false;
          let error: string | null = null;
          
          try {
            isLocked = await adapter.isLocked(file);
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
          }
          
          return {
            file,
            relativePath,
            isLocked,
            error
          };
        })
      );

      // Apply filters
      let filteredFiles = fileDetails;
      
      if (options.lockedOnly) {
        filteredFiles = fileDetails.filter(f => f.isLocked);
      } else if (options.unlockedOnly) {
        filteredFiles = fileDetails.filter(f => !f.isLocked);
      }

      if (options.json) {
        const jsonOutput = {
          files: filteredFiles.map(f => ({
            path: f.relativePath,
            absolutePath: f.file,
            locked: f.isLocked,
            error: f.error
          })),
          total: filteredFiles.length,
          locked: filteredFiles.filter(f => f.isLocked).length,
          unlocked: filteredFiles.filter(f => !f.isLocked).length
        };
        
        console.log(JSON.stringify(jsonOutput, null, 2));
        return;
      }

      // Header
      console.log(chalk.blue.bold('📄 Protected Files List\n'));
      
      // Summary
      const totalFiles = filteredFiles.length;
      const lockedCount = filteredFiles.filter(f => f.isLocked).length;
      const unlockedCount = totalFiles - lockedCount;
      
      console.log(chalk.blue(`Total: ${totalFiles} files`));
      console.log(chalk.green(`🔒 Locked: ${lockedCount}`));
      console.log(chalk.yellow(`🔓 Unlocked: ${unlockedCount}`));
      
      if (filteredFiles.some(f => f.error)) {
        const errorCount = filteredFiles.filter(f => f.error).length;
        console.log(chalk.red(`❌ Errors: ${errorCount}`));
      }
      
      console.log(); // Empty line

      // File listing
      if (options.long) {
        // Detailed listing
        for (const file of filteredFiles) {
          const statusIcon = file.isLocked ? '🔒' : '🔓';
          const statusColor = file.isLocked ? 'green' : 'yellow';
          const statusText = file.isLocked ? 'LOCKED' : 'unlocked';
          
          console.log(chalk[statusColor](`${statusIcon} ${file.relativePath}`));
          
          if (options.long) {
            console.log(chalk.gray(`   Path: ${file.file}`));
            console.log(chalk.gray(`   Status: ${statusText.toUpperCase()}`));
            
            if (file.error) {
              console.log(chalk.red(`   Error: ${file.error}`));
            }
            
            console.log(); // Empty line between files
          }
        }
      } else {
        // Compact listing
        const maxPathLength = Math.max(...filteredFiles.map(f => f.relativePath.length));
        
        for (const file of filteredFiles) {
          const statusIcon = file.isLocked ? '🔒' : '🔓';
          const statusColor = file.isLocked ? 'green' : 'yellow';
          const paddedPath = file.relativePath.padEnd(maxPathLength);
          const statusText = file.isLocked ? 'LOCKED' : 'unlocked';
          
          let line = chalk[statusColor](`${statusIcon} ${paddedPath} ${statusText}`);
          
          if (file.error) {
            line += chalk.red(` (${file.error})`);
          }
          
          console.log(line);
        }
      }

      // Get Git status if in repo
      try {
        const repoStatus = await getRepoStatus();
        
        if (repoStatus.isGitRepo) {
          console.log('\n' + chalk.blue.bold('🪝 Git Protection Status'));
          
          if (repoStatus.hasAilockHook) {
            console.log(chalk.green('✅ Pre-commit hook installed'));
          } else {
            console.log(chalk.yellow('⚠️  Pre-commit hook not installed'));
            console.log(chalk.gray('   Run: ailock install-hooks'));
          }
        }
      } catch {
        // Ignore Git status errors
      }

      // Footer recommendations
      if (unlockedCount > 0) {
        console.log('\n' + chalk.yellow('💡 Recommendation: Lock unprotected files with: ailock lock'));
      }
      
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });