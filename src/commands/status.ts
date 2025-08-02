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
      
      // Verbose information - show more useful details
      if (options.verbose) {
        console.log('\n' + chalk.blue.bold('📊 Detailed Information:'));
        
        // Configuration details
        if (totalProtected > 0) {
          console.log('\n' + chalk.blue.bold('⚙️  Configuration:'));
          console.log(chalk.gray(`   Protected patterns from .ailock file:`));
          // This would require loading config, let's add it
          try {
            const { loadConfig } = await import('../core/config.js');
            const config = await loadConfig();
            config.patterns.forEach(pattern => {
              console.log(chalk.gray(`     • ${pattern}`));
            });
          } catch (error) {
            console.log(chalk.gray(`     • Error loading config: ${error}`));
          }
        }

        // System information
        console.log('\n' + chalk.blue.bold('💻 System Information:'));
        console.log(chalk.gray(`   Platform: ${process.platform}`));
        console.log(chalk.gray(`   Node.js: ${process.version}`));
        console.log(chalk.gray(`   Working directory: ${process.cwd()}`));
        
        // Git hook details
        if (status.hookInfo) {
          console.log('\n' + chalk.blue.bold('🪝 Git Hook Details:'));
          console.log(chalk.gray(`   Path: ${status.hookInfo.hookPath}`));
          console.log(chalk.gray(`   Exists: ${status.hookInfo.exists ? 'Yes' : 'No'}`));
          console.log(chalk.gray(`   Ailock managed: ${status.hookInfo.isAilockManaged ? 'Yes' : 'No'}`));
          if (status.hookInfo.content && status.hookInfo.isAilockManaged) {
            const lines = status.hookInfo.content.split('\n').length;
            console.log(chalk.gray(`   Script size: ${lines} lines`));
          }
        }

        // File system statistics
        if (totalProtected > 0) {
          console.log('\n' + chalk.blue.bold('📁 File Statistics:'));
          const currentDir = process.cwd();
          let totalSize = 0;
          let oldestFile: Date | null = null;
          let newestFile: Date | null = null;
          
          try {
            const { stat } = await import('fs/promises');
            for (const file of status.protectedFiles) {
              try {
                const stats = await stat(file);
                totalSize += stats.size;
                if (!oldestFile || stats.mtime < oldestFile) oldestFile = stats.mtime;
                if (!newestFile || stats.mtime > newestFile) newestFile = stats.mtime;
              } catch {
                // Ignore errors for individual files
              }
            }
            
            console.log(chalk.gray(`   Total protected files: ${totalProtected}`));
            console.log(chalk.gray(`   Total size: ${Math.round(totalSize / 1024)} KB`));
            if (oldestFile) console.log(chalk.gray(`   Oldest file: ${oldestFile.toLocaleDateString()}`));
            if (newestFile) console.log(chalk.gray(`   Newest file: ${newestFile.toLocaleDateString()}`));
          } catch (error) {
            console.log(chalk.gray(`   File statistics unavailable: ${error}`));
          }
        }

        // Recommendations and tips
        console.log('\n' + chalk.blue.bold('💡 Advanced Tips:'));
        if (totalProtected === 0) {
          console.log(chalk.gray('   • Create .ailock with patterns like: .env, *.key, config/*.json'));
          console.log(chalk.gray('   • Use ailock init for guided setup'));
        } else {
          console.log(chalk.gray('   • Use ailock diagnose <file> to troubleshoot issues'));
          console.log(chalk.gray('   • Run ailock list to see all protected file patterns'));
        }
        
        if (status.isGitRepo) {
          console.log(chalk.gray('   • Pre-commit hooks prevent accidental commits of locked files'));
          console.log(chalk.gray('   • Use ailock status --json for machine-readable output'));
        }
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