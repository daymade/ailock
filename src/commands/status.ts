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
      
      // Always show file listing when there are protected files (not just in verbose mode)
      if (totalProtected > 0) {
        console.log('\n' + chalk.blue.bold('📄 Protected Files:'));
        
        const currentDir = process.cwd();
        
        for (const file of status.protectedFiles) {
          const relativePath = path.relative(currentDir, file);
          const isLocked = status.lockedFiles.includes(file);
          
          if (isLocked) {
            console.log(chalk.green(`   🔒 ${relativePath} (protected)`));
          } else {
            console.log(chalk.yellow(`   🔓 ${relativePath} (needs locking)`));
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
      
      // Detailed status and recommendations
      console.log('\n' + chalk.blue.bold('🔍 Protection Status:'));
      
      if (!status.isGitRepo) {
        console.log(chalk.red('   ❌ Git repository: Not detected'));
        console.log(chalk.gray('      💡 Initialize Git for enhanced protection: git init'));
      } else {
        console.log(chalk.green('   ✅ Git repository: Active'));
        
        if (!status.hasAilockHook) {
          console.log(chalk.red('   ❌ Pre-commit hook: Not installed'));
          console.log(chalk.gray('      💡 Install protection hook: ailock install-hooks'));
        } else {
          console.log(chalk.green('   ✅ Pre-commit hook: Active'));
        }
      }
      
      if (totalProtected === 0) {
        console.log(chalk.yellow('   ⚠️  File protection: No files configured'));
        console.log(chalk.gray('      💡 Create .ailock file to define protection patterns'));
      } else if (unlockedCount > 0) {
        console.log(chalk.yellow(`   ⚠️  File protection: ${unlockedCount} file(s) need locking`));
        const currentDir = process.cwd();
        const unlockedFiles = status.protectedFiles.filter(file => !status.lockedFiles.includes(file));
        const fileList = unlockedFiles.map(file => path.relative(currentDir, file)).join(', ');
        console.log(chalk.gray(`      📁 Files: ${fileList}`));
        console.log(chalk.gray('      💡 Lock these files: ailock lock'));
      } else {
        console.log(chalk.green('   ✅ File protection: All files locked'));
      }
      
      // Clear success/warning message
      console.log('');
      if (status.isGitRepo && status.hasAilockHook && unlockedCount === 0 && totalProtected > 0) {
        console.log(chalk.green.bold('🎉 All protection mechanisms are active!'));
      } else {
        const issues = [];
        if (!status.isGitRepo) issues.push('Git repository not detected');
        if (status.isGitRepo && !status.hasAilockHook) issues.push('Pre-commit hook not installed');
        if (unlockedCount > 0) issues.push(`${unlockedCount} file(s) need locking`);
        if (totalProtected === 0) issues.push('No files configured for protection');
        
        console.log(chalk.yellow.bold('⚠️  Protection incomplete:'));
        issues.forEach(issue => console.log(chalk.yellow(`   • ${issue}`)));
      }
      
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });