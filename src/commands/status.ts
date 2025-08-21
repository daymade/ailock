import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import { render } from 'ink';
import React from 'react';
import { getRepoStatus, RepoStatus } from '../core/git.js';
import { 
  getQuotaUsage, 
  getQuotaStatusSummary, 
  getProjectQuotaUsage, 
  getProjectQuotaStatusSummary, 
  initializeUserConfig 
} from '../core/directory-tracker.js';
import { getProjectDisplayPath } from '../core/project-utils.js';
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
  
  // Get quota information (use project quota)
  try {
    const projectQuotaUsage = await getProjectQuotaUsage();
    console.log(`Protected: ${totalProtected}, Locked: ${totalLocked}, Projects: ${projectQuotaUsage.used}/${projectQuotaUsage.quota}, Git: ${status.isGitRepo ? 'Yes' : 'No'}, Hooks: ${status.hasAilockHook ? 'Yes' : 'No'}`);
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
  try {
    const projectQuotaUsage = await getProjectQuotaUsage();
    
    // 🎯 HERO SECTION: Big visual impact, immediate understanding
    console.log(chalk.blue.bold('🛡️  AI-Lock Protection Dashboard\n'));
    
    // Visual quota meter - make it impossible to miss
    const progressBarWidth = 30;
    const usedWidth = Math.min(progressBarWidth, Math.ceil((projectQuotaUsage.used / projectQuotaUsage.quota) * progressBarWidth));
    const remainingWidth = progressBarWidth - usedWidth;
    const usedBar = '█'.repeat(usedWidth);
    const remainingBar = '░'.repeat(remainingWidth);
    
    // Big status with visual meter
    if (projectQuotaUsage.withinQuota) {
      console.log(chalk.green.bold(`✅ ${projectQuotaUsage.used}/${projectQuotaUsage.quota} PROJECTS PROTECTED`));
      console.log(chalk.green(`   [${usedBar}${chalk.gray(remainingBar)}] ${Math.round((projectQuotaUsage.used / projectQuotaUsage.quota) * 100)}% quota used\n`));
    } else {
      console.log(chalk.red.bold(`🚫 ${projectQuotaUsage.used}/${projectQuotaUsage.quota} PROJECTS (QUOTA EXCEEDED)`));
      console.log(chalk.red(`   [${usedBar}${chalk.gray(remainingBar)}] ${Math.round((projectQuotaUsage.used / projectQuotaUsage.quota) * 100)}% quota used\n`));
    }
    
    // 🎯 PROJECT SHOWCASE: Visual project cards
    if (projectQuotaUsage.projects.length > 0) {
      console.log(chalk.cyan.bold('📦 YOUR PROTECTED PROJECTS:'));
      console.log(chalk.gray('─'.repeat(50)));
      
      for (const project of projectQuotaUsage.projects) {
        const displayPath = getProjectDisplayPath(project.rootPath);
        const typeIcon = project.type === 'git' ? '📦' : '📁';
        const typeColor = project.type === 'git' ? chalk.blue : chalk.yellow;
        
        console.log(`${typeIcon} ${chalk.white.bold(project.name)} ${typeColor('(' + (project.type === 'git' ? 'Git Repository' : 'Directory') + ')')}`);
        console.log(`   ${chalk.gray('└─')} ${chalk.dim(displayPath)}`);
        
        if (project.protectedPaths.length > 1) {
          console.log(`   ${chalk.gray('└─')} ${chalk.cyan(project.protectedPaths.length + ' protected files')}`);
        }
        console.log(''); // spacing
      }
    } else {
      console.log(chalk.yellow.bold('📭 NO PROJECTS PROTECTED YET'));
      console.log(chalk.gray('   Your sensitive files are vulnerable to AI modifications!\n'));
    }
  } catch (error) {
    console.log(chalk.yellow('📊 Project Quota: Unable to load'));
    console.log(chalk.gray('   💡 Run: ailock auth --help'));
  }
  // 🎯 SYSTEM STATUS: Clean, scannable health check
  console.log(chalk.cyan.bold('🔧 SYSTEM HEALTH:'));
  console.log(chalk.gray('─'.repeat(30)));
  
  // Git status with visual indicators
  if (status.isGitRepo) {
    console.log(`${chalk.green('●')} Git Repository ${chalk.gray('detected')}`);
    
    if (status.hasAilockHook) {
      console.log(`${chalk.green('●')} Pre-commit Hook ${chalk.gray('installed')}`);
    } else {
      console.log(`${chalk.yellow('⚠')} Pre-commit Hook ${chalk.yellow('missing')} ${chalk.gray('← run: ailock hooks git')}`);
    }
  } else {
    console.log(`${chalk.gray('○')} Git Repository ${chalk.gray('not detected')}`);
  }
  
  // 🎯 FILE STATUS: Visual file protection overview
  const totalProtected = status.protectedFiles.length;
  const totalLocked = status.lockedFiles.length;
  const unlockedCount = totalProtected - totalLocked;
  
  console.log(''); // spacing
  console.log(chalk.cyan.bold('📄 FILE PROTECTION STATUS:'));
  console.log(chalk.gray('─'.repeat(35)));
  
  if (totalProtected === 0) {
    console.log(chalk.yellow.bold('⚠️  NO FILES CONFIGURED FOR PROTECTION'));
    console.log(chalk.gray('   Add patterns to .ailock file or run: ailock lock <file>\n'));
  } else {
    // Visual file status summary
    console.log(`${chalk.green('🔒')} ${totalLocked} files ${chalk.green('PROTECTED')}`);
    if (unlockedCount > 0) {
      console.log(`${chalk.yellow('🔓')} ${unlockedCount} files ${chalk.yellow('VULNERABLE')} ${chalk.gray('← need locking!')}`);
    }
    
    // Show critical files that need attention
    console.log(''); // spacing
    const currentDir = process.cwd();
    const maxFilesToShow = 5;
    let filesShown = 0;
    
    // Show unlocked files first (more urgent)
    for (const file of status.protectedFiles) {
      if (filesShown >= maxFilesToShow) break;
      const relativePath = path.relative(currentDir, file);
      const isLocked = status.lockedFiles.includes(file);
      
      if (!isLocked) {
        console.log(`   ${chalk.yellow('🔓')} ${chalk.white(relativePath)} ${chalk.yellow.bold('← NEEDS PROTECTION!')}`);
        filesShown++;
      }
    }
    
    // Then show some locked files
    for (const file of status.protectedFiles) {
      if (filesShown >= maxFilesToShow) break;
      const relativePath = path.relative(currentDir, file);
      const isLocked = status.lockedFiles.includes(file);
      
      if (isLocked) {
        console.log(`   ${chalk.green('🔒')} ${chalk.gray(relativePath)} ${chalk.green('protected')}`);
        filesShown++;
      }
    }
    
    if (totalProtected > maxFilesToShow) {
      console.log(chalk.gray(`   ... and ${totalProtected - maxFilesToShow} more files`));
    }
    console.log(''); // spacing
  }
  
  // 🎯 SMART ACTIONS: Context-aware, urgent first
  console.log(chalk.cyan.bold('⚡ NEXT STEPS:'));
  console.log(chalk.gray('─'.repeat(40)));
  
  try {
    const projectQuotaUsage = await getProjectQuotaUsage();
    
    // Priority 1: Critical security gaps
    if (unlockedCount > 0) {
      if (projectQuotaUsage.withinQuota) {
        console.log(`${chalk.yellow.bold('1.')} ${chalk.white('ailock lock')} ${chalk.gray('← Protect')} ${chalk.yellow.bold(unlockedCount + ' vulnerable files')}`);
      } else {
        console.log(`${chalk.red.bold('1.')} ${chalk.red('QUOTA EXCEEDED!')} ${chalk.gray('→ run:')} ${chalk.cyan('ailock auth <code>')}`);
        console.log(`   ${chalk.gray('   Get codes at:')} ${chalk.blue.underline('https://ailock.dev')}`);
      }
    }
    
    // Priority 2: System setup
    if (!status.hasAilockHook && status.isGitRepo) {
      const step = unlockedCount > 0 ? '2.' : '1.';
      console.log(`${chalk.yellow.bold(step)} ${chalk.white('ailock hooks git')} ${chalk.gray('← Enable Git protection')}`);
    }
    
    // Priority 3: Getting started (if nothing protected)
    if (totalProtected === 0) {
      console.log(`${chalk.cyan.bold('1.')} ${chalk.white('ailock lock <file>')} ${chalk.gray('← Start protecting files')}`);
      console.log(`   ${chalk.gray('   or create .ailock file with patterns')}`);
    }
    
    // Priority 4: Expansion opportunities
    if (projectQuotaUsage.withinQuota && projectQuotaUsage.available > 0 && totalProtected > 0) {
      console.log(`${chalk.green('💡')} You can protect ${chalk.green.bold(projectQuotaUsage.available + ' more projects')} with current quota!`);
    }
    
    // Priority 5: Quota expansion
    if (projectQuotaUsage.available <= 1 || !projectQuotaUsage.withinQuota) {
      console.log(`${chalk.blue('🚀')} ${chalk.blue.underline('https://ailock.dev')} ${chalk.gray('← Get more protection slots')}`);
    }
    
  } catch (error) {
    // Fallback actions
    if (unlockedCount > 0) {
      console.log(`${chalk.yellow.bold('1.')} ${chalk.white('ailock lock')} ${chalk.gray('← Protect vulnerable files')}`);
    }
    if (!status.hasAilockHook && status.isGitRepo) {
      console.log(`${chalk.yellow.bold('2.')} ${chalk.white('ailock hooks git')} ${chalk.gray('← Enable Git protection')}`);
    }
    if (totalProtected === 0) {
      console.log(`${chalk.cyan.bold('1.')} ${chalk.white('ailock lock <file>')} ${chalk.gray('← Start protecting files')}`);
    }
  }
  
  console.log(''); // final spacing
}

export const statusCommand = new Command('status')
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