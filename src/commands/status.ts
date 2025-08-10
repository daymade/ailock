import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { render } from 'ink';
import React from 'react';
import { getRepoStatus, RepoStatus } from '../core/git.js';
import { getQuotaUsage, getQuotaStatusSummary, initializeUserConfig } from '../core/directory-tracker.js';
import { getApiService } from '../services/CliApiService.js';

/**
 * Check if we're in an interactive terminal environment
 */
function isInteractiveTerminal(): boolean {
  return process.stdout.isTTY && !process.env.CI && !process.env.NON_INTERACTIVE;
}

/**
 * Show simple status for scripts/CI environments
 */
async function showSimpleStatus(status: RepoStatus): Promise<void> {
  const totalProtected = status.protectedFiles.length;
  const totalLocked = status.lockedFiles.length;
  
  // Get quota information
  try {
    const quotaUsage = await getQuotaUsage();
    console.log(`Protected: ${totalProtected}, Locked: ${totalLocked}, Quota: ${quotaUsage.used}/${quotaUsage.quota}, Git: ${status.isGitRepo ? 'Yes' : 'No'}, Hooks: ${status.hasAilockHook ? 'Yes' : 'No'}`);
  } catch {
    console.log(`Protected: ${totalProtected}, Locked: ${totalLocked}, Git: ${status.isGitRepo ? 'Yes' : 'No'}, Hooks: ${status.hasAilockHook ? 'Yes' : 'No'}`);
  }
  
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
async function showDetailedStatus(status: RepoStatus): Promise<void> {
  // Header
  console.log(chalk.blue.bold('🔒 AI-Proof File Guard Status\n'));
  
  // Quota status (most important information first)
  try {
    const quotaUsage = await getQuotaUsage();
    const quotaStatusSummary = await getQuotaStatusSummary();
    
    console.log(chalk.blue.bold('📊 Directory Quota Status'));
    if (quotaUsage.withinQuota) {
      console.log(chalk.green(`   ✅ ${quotaStatusSummary}`));
    } else {
      console.log(chalk.red(`   🚫 ${quotaStatusSummary}`));
      console.log(chalk.yellow('   💡 Get auth codes to increase your quota'));
    }
    
    if (quotaUsage.used > 0) {
      console.log(chalk.gray(`   📁 Directories currently locked: ${quotaUsage.used}`));
      if (quotaUsage.available > 0) {
        console.log(chalk.gray(`   🔓 Additional directories available: ${quotaUsage.available}`));
      }
    }
  } catch (error) {
    console.log(chalk.yellow('📊 Directory Quota: Unable to load'));
    console.log(chalk.gray('   💡 Run: ailock auth --help'));
  }
  
  console.log(''); // Empty line
  
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
  
  // Quick action suggestions with quota awareness
  console.log('\n' + chalk.blue.bold('🚀 Quick Actions:'));
  
  try {
    const quotaUsage = await getQuotaUsage();
    
    if (unlockedCount > 0) {
      if (quotaUsage.withinQuota) {
        console.log(chalk.yellow('   ailock lock                    # Lock all unprotected files'));
      } else {
        console.log(chalk.red('   ailock lock                    # Lock files (quota limit reached)'));
        console.log(chalk.cyan('   ailock auth <code>             # Increase quota with auth code'));
      }
    }
    
    if (totalLocked > 0) {
      console.log(chalk.gray('   ailock unlock [file]           # Unlock files for editing'));
    }
    
    if (totalProtected === 0) {
      console.log(chalk.cyan('   ailock lock --dry-run          # See what files would be protected'));
    }
    
    if (!quotaUsage.withinQuota || quotaUsage.available <= 1) {
      console.log(chalk.blue('   Visit ailock web portal        # Get more auth codes'));
    }
  } catch {
    if (unlockedCount > 0) {
      console.log(chalk.yellow('   ailock lock                    # Lock all unprotected files'));
    }
    if (totalLocked > 0) {
      console.log(chalk.gray('   ailock unlock [file]           # Unlock files for editing'));
    }
  }
  
  if (!status.hasAilockHook && status.isGitRepo) {
    console.log(chalk.yellow('   ailock install-hooks           # Install Git protection'));
  }
}

export const statusCommand = new Command('status')
  .alias('dash')
  .description('Show current ailock protection status')
  .option('-i, --interactive', 'Show interactive status dashboard with real-time updates')
  .option('-v, --verbose', 'Show detailed information')
  .option('--simple', 'Force simple non-interactive output')
  .option('--json', 'Output status as JSON')
  .action(async (options) => {
    try {
      // Initialize user configuration if needed
      await initializeUserConfig();
      
      // Track status check analytics
      const apiService = getApiService();
      await apiService.trackUsage('status_check');
      
      // Handle interactive dashboard
      if (options.interactive) {
        const { StatusDashboard } = await import('../ui/components/StatusDashboard.js');
        const { waitUntilExit } = render(
          React.createElement(StatusDashboard, {
            verbose: options.verbose,
            onExit: () => process.exit(0)
          })
        );
        
        await waitUntilExit();
        return;
      }

      const status = await getRepoStatus();
      
      if (options.json) {
        // Include quota information in JSON output
        try {
          const quotaUsage = await getQuotaUsage();
          const statusWithQuota = {
            ...status,
            quota: quotaUsage
          };
          console.log(JSON.stringify(statusWithQuota, null, 2));
        } catch {
          console.log(JSON.stringify(status, null, 2));
        }
        return;
      }
      
      // Smart output detection: use detailed view in interactive terminals unless --simple is specified
      const useDetailedOutput = (isInteractiveTerminal() && !options.simple) || options.verbose;
      
      if (useDetailedOutput) {
        // Rich interactive output
        await showDetailedStatus(status);
      } else {
        // Simple output for scripts/CI
        await showSimpleStatus(status);
      }
      
    } catch (error) {
      console.error(chalk.red('Error getting status:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });