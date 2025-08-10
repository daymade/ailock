import { Command } from 'commander';
import chalk from 'chalk';
import { getApiService } from '../services/CliApiService.js';
import { initializeUserConfig, getQuotaStatusSummary } from '../core/directory-tracker.js';
import { info, success, error, warn } from '../utils/output.js';

/**
 * Validate auth code format
 */
function validateAuthCodeFormat(code: string): boolean {
  return /^auth_[a-f0-9]{8}$/.test(code.trim());
}

/**
 * Display auth code redemption success message
 */
function displaySuccessMessage(response: any): void {
  success('🎉 Auth code redeemed successfully!');
  
  if (response.directory_quota) {
    info(chalk.green(`   📈 Your directory quota is now: ${response.directory_quota}`));
  }
  
  if (response.is_first_activation) {
    info(chalk.cyan('\n✨ Welcome to ailock! Your account is now activated.'));
    info(chalk.gray('   • You can now lock files across multiple directories'));
    info(chalk.gray('   • Share your referral code to earn bonus quota'));
    info(chalk.gray('   • Check your status with: ailock status'));
  } else {
    info(chalk.cyan('\n🚀 Your quota has been increased!'));
    info(chalk.gray('   • Continue locking files with: ailock lock'));
    info(chalk.gray('   • Check your current usage with: ailock status'));
  }

  if (response.message) {
    info(chalk.blue(`\n💬 ${response.message}`));
  }
}

/**
 * Display auth code redemption failure message
 */
function displayFailureMessage(errorMessage: string): void {
  error('❌ Failed to redeem auth code');
  
  if (errorMessage.includes('Invalid') || errorMessage.includes('already used')) {
    warn('   The auth code is invalid or has already been used.');
    info(chalk.gray('   • Check that you copied the code correctly'));
    info(chalk.gray('   • Auth codes can only be used once'));
    info(chalk.gray('   • Get new codes from the ailock web portal'));
  } else if (errorMessage.includes('network') || errorMessage.includes('connectivity')) {
    warn('   Network connection failed.');
    info(chalk.gray('   • Check your internet connection'));
    info(chalk.gray('   • Try again in a moment'));
    info(chalk.gray('   • Use --offline flag for local-only operation'));
  } else if (errorMessage.includes('rate limit')) {
    warn('   Rate limit exceeded.');
    info(chalk.gray('   • Please wait a moment before trying again'));
    info(chalk.gray('   • This prevents abuse of the system'));
  } else {
    warn(`   Error: ${errorMessage}`);
    info(chalk.gray('   • Try again in a few moments'));
    info(chalk.gray('   • Contact support if the issue persists'));
  }
  
  info(chalk.blue('\n💡 Alternative actions:'));
  info(chalk.gray('   • Visit the web portal to get more auth codes'));
  info(chalk.gray('   • Share referral codes to earn bonus quota'));
  info(chalk.gray('   • Check your current status with: ailock status'));
}

export const authCommand = new Command('auth')
  .description('Redeem auth code to increase directory quota')
  .argument('<code>', 'Auth code to redeem (format: auth_xxxxxxxx)')
  .option('-v, --verbose', 'Show detailed output')
  .option('--dry-run', 'Validate auth code format without redeeming')
  .action(async (code: string, options) => {
    try {
      // Initialize user configuration if needed
      await initializeUserConfig();
      
      // Clean and validate the auth code
      const cleanCode = code.trim();
      
      if (!validateAuthCodeFormat(cleanCode)) {
        error('❌ Invalid auth code format');
        warn('   Auth codes should be in the format: auth_xxxxxxxx');
        warn('   Where x is a lowercase letter or number');
        info(chalk.gray('\n💡 Example: auth_a1b2c3d4'));
        info(chalk.gray('   Get valid codes from the ailock web portal'));
        process.exit(1);
      }

      if (options.dryRun) {
        success('✅ Auth code format is valid');
        info(chalk.gray(`   Code: ${cleanCode}`));
        info(chalk.gray('   Use without --dry-run to actually redeem'));
        return;
      }

      // Show current status before redemption
      if (options.verbose) {
        info(chalk.blue('📊 Current status:'));
        const currentStatus = await getQuotaStatusSummary();
        info(chalk.gray(`   ${currentStatus}`));
        info(''); // Empty line
      }

      // Attempt to redeem the auth code
      info(chalk.cyan('🔄 Redeeming auth code...'));
      
      const apiService = getApiService();
      const response = await apiService.redeemAuthCode(cleanCode);

      if (response.success) {
        displaySuccessMessage(response);
        
        // Note: Auth code redemption is already tracked by the web API
        // No additional analytics tracking needed here
        
        // Show updated status
        if (options.verbose) {
          info(chalk.blue('\n📊 Updated status:'));
          const updatedStatus = await getQuotaStatusSummary();
          info(chalk.gray(`   ${updatedStatus}`));
        }
        
      } else {
        displayFailureMessage(response.error || 'Unknown error occurred');
        process.exit(1);
      }

    } catch (err) {
      error('❌ Unexpected error during auth code redemption');
      console.error(chalk.red('Details:'), err instanceof Error ? err.message : String(err));
      
      info(chalk.blue('\n💡 Troubleshooting:'));
      info(chalk.gray('   • Check your internet connection'));
      info(chalk.gray('   • Verify the auth code is correct'));
      info(chalk.gray('   • Try again in a few moments'));
      info(chalk.gray('   • Use ailock status to check current quota'));
      
      process.exit(1);
    }
  });