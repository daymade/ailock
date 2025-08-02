import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { getRepoStatus, RepoStatus } from '../core/git.js';

/**
 * Check if we're in an interactive terminal environment
 */
function isInteractiveTerminal(): boolean {
  return process.stdout.isTTY && !process.env.CI && !process.env.NON_INTERACTIVE;
}

/**
 * Show simple status for scripts/CI environments
 */
function showSimpleStatus(status: RepoStatus): void {
  const totalProtected = status.protectedFiles.length;
  const totalLocked = status.lockedFiles.length;
  
  console.log(`Protected: ${totalProtected}, Locked: ${totalLocked}, Git: ${status.isGitRepo ? 'Yes' : 'No'}, Hooks: ${status.hasAilockHook ? 'Yes' : 'No'}`);
  
  if (totalProtected > 0) {
    const currentDir = process.cwd();
    for (const file of status.protectedFiles) {
      const relativePath = path.relative(currentDir, file);
      const isLocked = status.lockedFiles.includes(file);
      console.log(`${isLocked ? 'LOCKED' : 'UNLOCKED'}: ${relativePath}`);
    }
  }
}

/**
 * Show detailed interactive status
 */
function showDetailedStatus(status: RepoStatus): void {
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
    console.log(chalk.gray('   💡 Create .ailock file or run: ailock lock'));
  }
  
  // Show file listing when there are protected files
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
  
  // Quick action suggestions
  console.log('\n' + chalk.blue.bold('🚀 Quick Actions:'));
  if (unlockedCount > 0) {
    console.log(chalk.yellow('   ailock lock                    # Lock all unprotected files'));
  }
  if (totalLocked > 0) {
    console.log(chalk.gray('   ailock unlock [file]           # Unlock files for editing'));
  }
  if (totalProtected === 0) {
    console.log(chalk.cyan('   ailock lock --dry-run          # See what files would be protected'));
  }
  if (!status.hasAilockHook && status.isGitRepo) {
    console.log(chalk.yellow('   ailock install-hooks           # Install Git protection'));
  }
}

export const statusCommand = new Command('status')
  .description('Show current ailock protection status')
  .option('-v, --verbose', 'Show detailed information')
  .option('--simple', 'Force simple non-interactive output')
  .option('--json', 'Output status as JSON')
  .action(async (options) => {
    try {
      const status = await getRepoStatus();
      
      if (options.json) {
        console.log(JSON.stringify(status, null, 2));
        return;
      }
      
      // Smart output detection: use detailed view in interactive terminals unless --simple is specified
      const useDetailedOutput = (isInteractiveTerminal() && !options.simple) || options.verbose;
      
      if (useDetailedOutput) {
        // Rich interactive output
        showDetailedStatus(status);
      } else {
        // Simple output for scripts/CI
        showSimpleStatus(status);
      }
      
    } catch (error) {
      console.error(chalk.red('Error getting status:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });