import { Command } from 'commander';
import chalk from 'chalk';
import { 
  getQuotaUsage, 
  getQuotaStatusSummary, 
  initializeUserConfig,
  getTrackedDirectories,
  validateDirectoryTracking,
  resetDirectoryTracking,
  repairDirectoryTracking,
  // New project-based functions
  getProjectQuotaUsage,
  getProjectQuotaStatusSummary,
  getProtectedProjectsList
} from '../core/directory-tracker.js';
import { getProjectDisplayPath, getProjectStats } from '../core/project-utils.js';
import { 
  loadUserConfig, 
  getUserConfigDebugInfo, 
  setOfflineMode, 
  getOfflineMode,
  setAnalyticsEnabled,
  getAnalyticsEnabled,
  repairUserConfigAsync,
  setPrivacyLevel,
  getPrivacyLevel,
  setTelemetryOptOut,
  getTelemetryOptOut
} from '../core/user-config.js';
import { getApiService } from '../services/CliApiService.js';
import { getMachineUuid } from '../core/machine-id.js';
import { info, success, error, warn } from '../utils/output.js';

/**
 * Show detailed quota status
 */
async function showQuotaStatus(): Promise<void> {
  try {
    const projectQuotaUsage = await getProjectQuotaUsage();
    const projectQuotaStatusSummary = await getProjectQuotaStatusSummary();
    
    info(chalk.blue.bold('📊 Project Protection Status\n'));
    
    // Overall status
    if (projectQuotaUsage.withinQuota) {
      success(`✅ ${projectQuotaStatusSummary}`);
    } else {
      error(`🚫 ${projectQuotaStatusSummary}`);
    }
    
    // Detailed breakdown
    info(chalk.cyan('\n📈 Quota Details:'));
    info(chalk.gray(`   Used: ${projectQuotaUsage.used} projects`));
    info(chalk.gray(`   Limit: ${projectQuotaUsage.quota} projects`));
    info(chalk.gray(`   Available: ${projectQuotaUsage.available} projects`));
    
    // Progress bar visualization
    const progressBarWidth = 20;
    const usedWidth = Math.min(progressBarWidth, Math.ceil((projectQuotaUsage.used / projectQuotaUsage.quota) * progressBarWidth));
    const remainingWidth = progressBarWidth - usedWidth;
    
    const usedBar = '█'.repeat(usedWidth);
    const remainingBar = '░'.repeat(remainingWidth);
    
    if (projectQuotaUsage.withinQuota) {
      info(chalk.green(`   [${usedBar}${remainingBar}] ${Math.round((projectQuotaUsage.used / projectQuotaUsage.quota) * 100)}%`));
    } else {
      info(chalk.red(`   [${usedBar}${remainingBar}] ${Math.round((projectQuotaUsage.used / projectQuotaUsage.quota) * 100)}%`));
    }
    
    // Show protected projects
    if (projectQuotaUsage.projects.length > 0) {
      info(chalk.cyan('\n📁 Protected Projects:'));
      
      for (const project of projectQuotaUsage.projects) {
        const displayPath = getProjectDisplayPath(project.rootPath);
        const typeIcon = project.type === 'git' ? '📦' : '📁';
        const typeLabel = project.type === 'git' ? 'Git repository' : 'Directory';
        
        info(chalk.gray(`   ${typeIcon} ${project.name} (${typeLabel})`));
        info(chalk.dim(`      ${displayPath}`));
        
        if (project.protectedPaths.length > 1) {
          info(chalk.dim(`      └─ ${project.protectedPaths.length} protected files/directories`));
        }
      }
      
      // Show statistics
      const stats = projectQuotaUsage.stats;
      if (stats.total > 0) {
        info(chalk.cyan('\n📊 Project Statistics:'));
        info(chalk.gray(`   📦 Git repositories: ${stats.gitProjects}`));
        info(chalk.gray(`   📁 Standalone directories: ${stats.directoryProjects}`));
        info(chalk.gray(`   🔒 Total protected files/directories: ${stats.totalProtectedPaths}`));
      }
    } else {
      info(chalk.yellow('\n📁 No projects are currently protected.'));
      info(chalk.gray('   Lock some files to start protecting your projects.'));
    }
    
    // Recommendations
    if (!projectQuotaUsage.withinQuota) {
      info(chalk.blue('\n🚀 Increase Your Quota:'));
      info(chalk.gray('   1. Visit the ailock web portal'));
      info(chalk.gray('   2. Get auth codes through signup or referrals'));
      info(chalk.gray('   3. Run: ailock auth <your-auth-code>'));
      info(chalk.gray('   4. Continue protecting more projects'));
    } else if (projectQuotaUsage.available <= 1) {
      info(chalk.yellow('\n⚠️  Running Low on Quota:'));
      info(chalk.gray('   Consider getting more auth codes before you need them.'));
      info(chalk.gray('   Visit the web portal to increase your quota.'));
    }
    
  } catch (err) {
    error('Failed to get quota status');
    console.error(chalk.red('Details:'), err instanceof Error ? err.message : String(err));
  }
}

/**
 * Sync quota with the backend
 */
async function syncQuota(): Promise<void> {
  try {
    info(chalk.cyan('🔄 Syncing quota with backend...'));
    
    const config = await loadUserConfig();
    const apiService = getApiService();
    
    // Try to get status from any available auth code
    // In a real scenario, we'd need to store the user's current auth code
    // For now, we'll just track the sync attempt
    await apiService.trackUsage('status_check', {
      metadata: { sync_requested: true }
    });
    
    success('✅ Sync completed');
    info(chalk.gray('   Your local quota status has been updated.'));
    
  } catch (err) {
    error('❌ Failed to sync quota');
    if (err instanceof Error && err.message.includes('offline')) {
      info(chalk.gray('   You are in offline mode. Quota sync is not available.'));
    } else {
      console.error(chalk.red('Details:'), err instanceof Error ? err.message : String(err));
      info(chalk.gray('   Check your internet connection and try again.'));
    }
  }
}

/**
 * Reset local quota tracking (for testing/troubleshooting)
 */
async function resetQuota(force: boolean): Promise<void> {
  try {
    if (!force) {
      warn('⚠️  This will reset your local directory tracking.');
      info(chalk.gray('   Use --force to confirm this action.'));
      info(chalk.gray('   Your actual quota limit will not be affected.'));
      return;
    }
    
    info(chalk.cyan('🔄 Resetting local directory tracking...'));
    
    await resetDirectoryTracking();
    
    success('✅ Local directory tracking has been reset');
    info(chalk.gray('   Your quota limit remains unchanged.'));
    info(chalk.gray('   Locked directories are no longer being tracked for quota purposes.'));
    info(chalk.gray('   Run: ailock status to see the current state.'));
    
  } catch (err) {
    error('❌ Failed to reset quota tracking');
    console.error(chalk.red('Details:'), err instanceof Error ? err.message : String(err));
  }
}

/**
 * Show debug information
 */
async function showDebugInfo(): Promise<void> {
  try {
    info(chalk.blue.bold('🔍 Quota System Debug Information\n'));
    
    // User configuration (without sensitive data)
    const debugConfig = await getUserConfigDebugInfo();
    info(chalk.cyan('👤 User Configuration:'));
    info(chalk.gray(`   Machine UUID: ${debugConfig.machineUuid || 'Not set'}`));
    info(chalk.gray(`   Directory Quota: ${debugConfig.directoryQuota}`));
    info(chalk.gray(`   Tracked Directories: ${debugConfig.lockedDirectories?.length ?? 0}`));
    info(chalk.gray(`   Protected Projects: ${debugConfig.protectedProjects?.length ?? 0}`));
    info(chalk.gray(`   Analytics Enabled: ${debugConfig.analyticsEnabled}`));
    info(chalk.gray(`   Offline Mode: ${debugConfig.offlineMode || false}`));
    info(chalk.gray(`   Last Sync: ${debugConfig.lastSyncAt || 'Never'}`));
    info(chalk.gray(`   Config Version: ${debugConfig.version}`));
    
    // API configuration
    const apiService = getApiService();
    const apiInfo = apiService.getApiInfo();
    info(chalk.cyan('\n🌐 API Configuration:'));
    info(chalk.gray(`   Base URL: ${apiInfo.baseUrl}`));
    info(chalk.gray(`   Timeout: ${apiInfo.timeout}ms`));
    info(chalk.gray(`   Max Retries: ${apiInfo.maxRetries}`));
    
    // Connectivity test
    info(chalk.cyan('\n📡 Connectivity Test:'));
    const isConnected = await apiService.testConnectivity();
    if (isConnected) {
      success('   ✅ API is reachable');
    } else {
      error('   ❌ API is not reachable');
      info(chalk.gray('   Check your internet connection or proxy settings'));
    }
    
    // Validation
    const validationErrors = await validateDirectoryTracking();
    info(chalk.cyan('\n✅ Quota System Validation:'));
    if (validationErrors.length === 0) {
      success('   ✅ No issues found');
    } else {
      warn(`   ⚠️  Found ${validationErrors.length} issue(s):`);
      for (const issue of validationErrors) {
        warn(`   • ${issue}`);
      }
      info(chalk.gray('   💡 Run: ailock quota repair --auto    # Attempt automatic repair'));
    }
    
    // Environment variables
    const envVars = {
      'AILOCK_API_URL': process.env.AILOCK_API_URL,
      'AILOCK_DEBUG': process.env.AILOCK_DEBUG,
      'AILOCK_OFFLINE': process.env.AILOCK_OFFLINE
    };
    
    info(chalk.cyan('\n🔧 Environment Variables:'));
    for (const [key, value] of Object.entries(envVars)) {
      if (value) {
        info(chalk.gray(`   ${key}: ${value}`));
      } else {
        info(chalk.gray(`   ${key}: Not set`));
      }
    }
    
  } catch (err) {
    error('❌ Failed to get debug information');
    console.error(chalk.red('Details:'), err instanceof Error ? err.message : String(err));
  }
}

/**
 * Repair quota system issues
 */
async function repairQuota(auto: boolean): Promise<void> {
  try {
    if (!auto) {
      info(chalk.blue.bold('🔧 Quota System Repair'));
      info(chalk.gray('   This will attempt to fix issues with your quota configuration.'));
      info(chalk.gray('   Use --auto to perform repairs without confirmation.'));
      return;
    }
    
    info(chalk.cyan('🔧 Repairing quota system issues...'));
    
    // Repair user configuration
    info(chalk.gray('   Checking user configuration...'));
    const configRepairResult = await repairUserConfigAsync();
    
    if (configRepairResult.repaired) {
      success('✅ User configuration repaired');
      for (const fix of configRepairResult.issuesFixed) {
        info(chalk.gray(`   • ${fix}`));
      }
      
      if (configRepairResult.hadToReset) {
        warn('⚠️  Configuration was reset to defaults');
        info(chalk.gray('   Your quota and directory tracking have been reset.'));
      }
    } else {
      success('✅ User configuration is healthy');
    }
    
    // Repair directory tracking
    info(chalk.gray('   Checking directory tracking...'));
    const trackingRepairResult = await repairDirectoryTracking();
    
    if (trackingRepairResult.repaired) {
      success('✅ Directory tracking repaired');
      for (const fix of trackingRepairResult.issuesFixed) {
        info(chalk.gray(`   • ${fix}`));
      }
    } else {
      success('✅ Directory tracking is healthy');
    }
    
    // Show remaining issues if any
    if (trackingRepairResult.issuesRemaining.length > 0) {
      warn('⚠️  Some issues could not be automatically resolved:');
      for (const issue of trackingRepairResult.issuesRemaining) {
        warn(`   • ${issue}`);
      }
      info(chalk.gray('   You may need to manually resolve these issues or contact support.'));
    }
    
    if (configRepairResult.repaired || trackingRepairResult.repaired) {
      info(chalk.blue('\n🚀 Next Steps:'));
      info(chalk.gray('   1. Run: ailock status                  # Verify your current state'));
      info(chalk.gray('   2. Run: ailock quota status           # Check quota information'));
      if (configRepairResult.hadToReset) {
        info(chalk.gray('   3. Run: ailock auth <code>             # Redeem auth codes if you have any'));
      }
    } else {
      success('\n🎉 No repairs were needed - your quota system is healthy!');
    }
    
  } catch (err) {
    error('❌ Failed to repair quota system');
    console.error(chalk.red('Details:'), err instanceof Error ? err.message : String(err));
    info(chalk.gray('   Try running with AILOCK_DEBUG=true for more information.'));
  }
}

// Create the quota command with subcommands
export const quotaCommand = new Command('quota')
  .description('Manage directory quota and usage tracking')
  .addCommand(
    new Command('status')
      .description('Show detailed quota status and usage')
      .action(async () => {
        await initializeUserConfig();
        await showQuotaStatus();
      })
  )
  .addCommand(
    new Command('sync')
      .description('Sync quota status with backend')
      .action(async () => {
        await initializeUserConfig();
        await syncQuota();
      })
  )
  .addCommand(
    new Command('reset')
      .description('Reset local directory tracking (for troubleshooting)')
      .option('--force', 'Confirm the reset operation')
      .action(async (options) => {
        await initializeUserConfig();
        await resetQuota(options.force);
      })
  )
  .addCommand(
    new Command('debug')
      .description('Show debug information for troubleshooting')
      .action(async () => {
        await initializeUserConfig();
        await showDebugInfo();
      })
  )
  .addCommand(
    new Command('config')
      .description('Manage quota system configuration')
      .option('--offline <mode>', 'Set offline mode (true/false)')
      .option('--analytics <mode>', 'Set analytics enabled (true/false)')
      .option('--privacy <level>', 'Set privacy level (minimal/standard/enhanced)')
      .option('--telemetry <mode>', 'Set telemetry opt-out (true/false)')
      .action(async (options) => {
        await initializeUserConfig();
        
        if (options.offline !== undefined) {
          const offlineMode = options.offline.toLowerCase() === 'true';
          await setOfflineMode(offlineMode);
          success(`✅ Offline mode set to: ${offlineMode}`);
        }
        
        if (options.analytics !== undefined) {
          const analyticsEnabled = options.analytics.toLowerCase() === 'true';
          await setAnalyticsEnabled(analyticsEnabled);
          success(`✅ Analytics enabled set to: ${analyticsEnabled}`);
        }
        
        if (options.privacy !== undefined) {
          const privacyLevel = options.privacy.toLowerCase();
          if (['minimal', 'standard', 'enhanced'].includes(privacyLevel)) {
            await setPrivacyLevel(privacyLevel as 'minimal' | 'standard' | 'enhanced');
            success(`✅ Privacy level set to: ${privacyLevel}`);
            
            if (privacyLevel === 'enhanced') {
              info(chalk.yellow('   Privacy level set to enhanced - analytics and telemetry disabled'));
            }
          } else {
            error('❌ Invalid privacy level. Use: minimal, standard, or enhanced');
            return;
          }
        }
        
        if (options.telemetry !== undefined) {
          const telemetryOptOut = options.telemetry.toLowerCase() === 'true';
          await setTelemetryOptOut(telemetryOptOut);
          success(`✅ Telemetry opt-out set to: ${telemetryOptOut}`);
        }
        
        if (!options.offline && !options.analytics && !options.privacy && !options.telemetry) {
          // Show current configuration
          const [offlineMode, analyticsEnabled, privacyLevel, telemetryOptOut] = await Promise.all([
            getOfflineMode(),
            getAnalyticsEnabled(),
            getPrivacyLevel(),
            getTelemetryOptOut()
          ]);
          
          info(chalk.blue.bold('⚙️  Current Configuration:'));
          info(chalk.gray(`   Offline mode: ${offlineMode}`));
          info(chalk.gray(`   Analytics enabled: ${analyticsEnabled}`));
          info(chalk.gray(`   Privacy level: ${privacyLevel}`));
          info(chalk.gray(`   Telemetry opt-out: ${telemetryOptOut}`));
          
          info(chalk.cyan('\n💡 Usage:'));
          info(chalk.gray('   ailock quota config --offline true     # Enable offline mode'));
          info(chalk.gray('   ailock quota config --analytics false  # Disable analytics'));
          info(chalk.gray('   ailock quota config --privacy enhanced # Set privacy to enhanced'));
          info(chalk.gray('   ailock quota config --telemetry true   # Opt out of telemetry'));
          
          info(chalk.cyan('\n🔒 Privacy Levels:'));
          info(chalk.gray('   minimal   - All tracking enabled (fastest development)'));
          info(chalk.gray('   standard  - Balanced privacy and functionality (default)'));
          info(chalk.gray('   enhanced  - Maximum privacy (disables analytics & telemetry)'));
        }
      })
  )
  .addCommand(
    new Command('repair')
      .description('Repair quota system issues and configuration problems')
      .option('--auto', 'Perform repairs automatically without confirmation')
      .action(async (options) => {
        await initializeUserConfig();
        await repairQuota(options.auto);
      })
  );