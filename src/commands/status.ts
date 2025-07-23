import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { getRepoStatus } from '../core/git.js';

export const statusCommand = new Command('status')
  .description('Show current ailock protection status')
  .option('-v, --verbose', 'Show detailed information')
  .option('--json', 'Output status as JSON')
  .action(async (options) => {
    try {
      const status = await getRepoStatus();
      
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      
      // Header
      console.log(chalk.blue.bold('🔒 AI-Proof File Guard Status\n'));
      
      // Git repository status
      if (status.isGitRepo) {
        console.log(chalk.green('📁 Git Repository: ✅ Detected'));
        
        if (status.hasAilockHook) {
          console.log(chalk.green('🪝 Pre-commit Hook: ✅ Installed'));
        } else {
          console.log(chalk.yellow('🪝 Pre-commit Hook: ⚠️  Not installed'));
          console.log(chalk.gray('   💡 Run: ailock install-hooks'));
        }
      } else {
        console.log(chalk.gray('📁 Git Repository: ❌ Not detected'));
        console.log(chalk.gray('   ℹ️  Git hooks are not available'));
      }
      
      console.log(''); // Empty line
      
      // Protected files summary
      const totalProtected = status.protectedFiles.length;
      const totalLocked = status.lockedFiles.length;
      const unlockedCount = totalProtected - totalLocked;
      
      console.log(chalk.blue.bold('📋 File Protection Summary'));
      console.log(chalk.green(`   🔒 Locked files: ${totalLocked}`));
      
      if (unlockedCount > 0) {
        console.log(chalk.yellow(`   🔓 Unlocked files: ${unlockedCount}`));
      }
      
      if (totalProtected === 0) {
        console.log(chalk.gray('   ℹ️  No protected files found'));
        console.log(chalk.gray('   💡 Create .ailock file to define protection patterns'));
      }
      
      // Detailed file listing
      if (options.verbose && totalProtected > 0) {
        console.log('\n' + chalk.blue.bold('📄 Protected Files:'));
        
        const currentDir = process.cwd();
        
        for (const file of status.protectedFiles) {
          const relativePath = path.relative(currentDir, file);
          const isLocked = status.lockedFiles.includes(file);
          
          if (isLocked) {
            console.log(chalk.green(`   🔒 ${relativePath}`));
          } else {
            console.log(chalk.yellow(`   🔓 ${relativePath}`));
          }
        }
      }
      
      // Hook details (verbose mode)
      if (options.verbose && status.hookInfo) {
        console.log('\n' + chalk.blue.bold('🪝 Git Hook Details:'));
        console.log(chalk.gray(`   Path: ${status.hookInfo.hookPath}`));
        console.log(chalk.gray(`   Exists: ${status.hookInfo.exists ? 'Yes' : 'No'}`));
        console.log(chalk.gray(`   Ailock managed: ${status.hookInfo.isAilockManaged ? 'Yes' : 'No'}`));
      }
      
      // Recommendations
      console.log('\n' + chalk.blue.bold('💡 Recommendations:'));
      
      if (!status.isGitRepo) {
        console.log(chalk.gray('   • Initialize Git repository for enhanced protection'));
      } else if (!status.hasAilockHook) {
        console.log(chalk.yellow('   • Install pre-commit hook: ailock install-hooks'));
      }
      
      if (unlockedCount > 0) {
        console.log(chalk.yellow('   • Lock unprotected files: ailock lock'));
      }
      
      if (totalProtected === 0) {
        console.log(chalk.gray('   • Create .ailock file to define protection patterns'));
      }
      
      // Success/Warning exit codes
      if (status.isGitRepo && status.hasAilockHook && unlockedCount === 0) {
        console.log('\n' + chalk.green.bold('✅ All protection mechanisms are active'));
      } else {
        console.log('\n' + chalk.yellow.bold('⚠️  Some protection mechanisms are not active'));
      }
      
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });