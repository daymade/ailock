import { Command } from 'commander';
import chalk from 'chalk';
import { getApiService, type AuthRedeemResponse } from '../services/CliApiService.js';
import { initializeUserConfig, getQuotaStatusSummary } from '../core/directory-tracker.js';
import { info, success, error, warn } from '../utils/output.js';

/**
 * Validate auth code format
 * Requires secure 32-character format for proper security
 */
function validateAuthCodeFormat(code: string): boolean {
  // Secure format: auth_ + 32 hex characters
  return /^auth_[a-f0-9]{32}$/.test(code.trim());
}

/**
 * Display auth code redemption success message
 */
function displaySuccessMessage(response: AuthRedeemResponse): void {
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
  } else if (errorMessage.includes('offline')) {
    warn('   Cannot redeem auth codes in offline mode.');
    info(chalk.gray('   • Disable offline mode to redeem codes'));
    info(chalk.gray('   • Run: ailock config set offline false'));
  } else if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
    warn('   Network error occurred.');
    info(chalk.gray('   • Check your internet connection'));
    info(chalk.gray('   • Try again in a few moments'));
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
  .argument('<code>', 'Auth code to redeem (format: auth_ + 32 hex characters)')
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
        warn('   Auth codes must be 32 hex characters after auth_ prefix');
        info(chalk.gray('\n💡 Example:'));
        info(chalk.gray('   auth_a1b2c3d4e5f6789012345678901234567890'));
        info(chalk.gray('\n   Get valid codes from the ailock web portal'));
        throw new Error('Invalid auth code format');
      }

      if (options.dryRun) {
        success('✅ Auth code format is valid');
        info(chalk.gray(`   Code: ${cleanCode}`));
        info(chalk.gray('   Use without --dry-run to actually redeem'));
        return;
      }

      // Show current status before redemption if verbose
      if (options.verbose) {
        const statusBefore = await getQuotaStatusSummary();
        info(chalk.blue('\n📊 Current Status:'));
        info(chalk.gray(`   ${statusBefore}`));
      }

      // Redeem the auth code
      info(chalk.blue('\n🔄 Redeeming auth code...'));
      const apiService = getApiService();
      const response = await apiService.redeemAuthCode(cleanCode);

      if (response.success) {
        displaySuccessMessage(response);
        
        // Show new status if verbose
        if (options.verbose) {
          const statusAfter = await getQuotaStatusSummary();
          info(chalk.blue('\n📊 Updated Status:'));
          info(chalk.gray(`   ${statusAfter}`));
        }
      } else {
        displayFailureMessage(response.error || 'Unknown error occurred');
        throw new Error(response.error || 'Unknown error occurred');
      }
    } catch (err) {
      // Re-throw if it's an expected error that was already handled with proper messaging
      if (err instanceof Error && (
        err.message === 'Invalid auth code format' || 
        err.message.includes('Unknown error occurred') ||
        err.message.includes('Failed to redeem auth code')
      )) {
        throw err;
      }
      
      // Handle unexpected errors
      error('❌ Unexpected error during auth code redemption');
      
      if (err instanceof Error) {
        warn(`   ${err.message}`);
        
        if (process.env.AILOCK_DEBUG === 'true') {
          // Sanitize error output to prevent information disclosure
          const sanitizedError = {
            message: err.message,
            name: err.name,
            // Don't expose full stack trace, just the first line
            stack: err.stack?.split('\n')[0]
          };
          console.error('Debug: Error details:', sanitizedError);
        }
      }
      
      info(chalk.gray('\n💡 Try again or contact support if the issue persists'));
      throw err;
    }
  });