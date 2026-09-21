import chalk from 'chalk';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { loadConfig, findProtectedFiles } from '../core/config.js';
import { getPlatformAdapter } from '../core/platform.js';
import { info, success, warn, error } from '../utils/output.js';
import { 
  canLockFile, 
  canLockProject,
  trackFileLocked, 
  trackFileUnlocked,
  trackProjectFileLocked,
  trackProjectFileUnlocked,
  getQuotaUsage,
  getQuotaStatusSummary,
  getProjectQuotaUsage,
  getProjectQuotaStatusSummary
} from '../core/directory-tracker.js';
import { getApiService } from './CliApiService.js';

/**
 * Options for file operations
 */
export interface FileOperationOptions {
  patterns?: string[];
  all?: boolean;
  dryRun?: boolean;
  verbose?: boolean;
  force?: boolean;
  includeGitignored?: boolean;
}

/**
 * Result of a file operation
 */
export interface FileOperationResult {
  successful: string[];
  failed: Array<{ file: string; error: string }>;
  skipped: string[];
  /**
   * Files refused before any chmod was attempted, with the reason each was
   * refused. Not all of these are quota: canLockProject() also refuses paths
   * inside temporary or system directories, which is a different answer with a
   * different fix. Collapsing both into one "quota exceeded" message told the
   * user their quota was spent when it was not — measured 2026-09-21, a fresh
   * config reporting 0/2 used still printed "Quota exceeded".
   */
  blocked: Array<{ file: string; reason: string; quotaExceeded: boolean }>;
  totalFiles: number;
}

/**
 * Service for handling common file operations (lock/unlock)
 * Eliminates code duplication between lock and unlock commands
 */
export class FileOperationService {
  private adapter = getPlatformAdapter();

  /**
   * Process files for locking or unlocking
   * DRY principle - shared logic for both operations
   */
  public async processFiles(
    operation: 'lock' | 'unlock',
    options: FileOperationOptions
  ): Promise<FileOperationResult> {
    const result: FileOperationResult = {
      successful: [],
      failed: [],
      skipped: [],
      blocked: [],
      totalFiles: 0
    };

    // Get files to process
    const filesToProcess = await this.getFilesToProcess(options);
    result.totalFiles = filesToProcess.length;

    if (filesToProcess.length === 0) {
      return result;
    }

    // Display what will be done
    if (!options.dryRun) {
      this.displayOperationStart(operation, filesToProcess);
    }

    // Process each file
    for (const file of filesToProcess) {
      if (options.dryRun) {
        info(chalk.gray(`  Would ${operation}: ${file}`));
        result.successful.push(file);
        continue;
      }

      try {
        // Check current state
        const isLocked = await this.adapter.isLocked(file);
        
        if (operation === 'lock' && isLocked) {
          if (options.verbose) {
            info(chalk.gray(`  ℹ️  Already locked: ${file}`));
          }
          result.skipped.push(file);
          continue;
        }
        
        if (operation === 'unlock' && !isLocked) {
          if (options.verbose) {
            info(chalk.gray(`  ℹ️  Already unlocked: ${file}`));
          }
          result.skipped.push(file);
          continue;
        }

        // Check quota before locking (only for lock operations)
        if (operation === 'lock') {
          const quotaCheck = await canLockProject(file);

          if (!quotaCheck.canLock) {
            // canLockProject() refuses for two unrelated reasons: the project
            // quota really is spent, or the path is not a legitimate project
            // root (temporary/system directory). Say which one. Reporting the
            // second as the first sends the user off to buy capacity they do
            // not need.
            const quotaExceeded = quotaCheck.quotaUsage.used >= quotaCheck.quotaUsage.quota;
            const reason = quotaCheck.reason
              || (quotaExceeded
                ? `Project quota exceeded (${quotaCheck.quotaUsage.used}/${quotaCheck.quotaUsage.quota})`
                : 'Lock refused');
            result.blocked.push({ file, reason, quotaExceeded });

            if (options.verbose || result.blocked.length <= 3) {
              warn(`  🚫 ${reason} — ${file}`);
            }

            // Conversion analytics only mean something for a real quota wall.
            // Counting a refused temp path here would inflate the very signal
            // used to decide the free tier is too small.
            if (quotaExceeded && result.blocked.filter(b => b.quotaExceeded).length === 1) {
              const apiService = getApiService();
              await apiService.trackUsage('project_quota_exceeded', {
                directoryPath: file,
                totalLockedCount: quotaCheck.quotaUsage.used,
                metadata: {
                  quotaType: 'project',
                  quotaLimit: quotaCheck.quotaUsage.quota,
                  quotaUsed: quotaCheck.quotaUsage.used
                }
              });
            }
            continue;
          }
        }

        // Perform the operation
        if (operation === 'lock') {
          await this.adapter.lockFile(file);
          await trackProjectFileLocked(file); // Track for project-based quota management
        } else {
          await this.adapter.unlockFile(file);
          await trackProjectFileUnlocked(file); // Update project-based quota tracking
        }
        
        result.successful.push(file);
        
        if (options.verbose) {
          const icon = operation === 'lock' ? '🔒' : '🔓';
          info(chalk.green(`  ${icon} ${file}`));
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.failed.push({ file, error: errorMessage });
        
        if (options.verbose) {
          console.error(`  ❌ Failed to ${operation} ${file}: ${errorMessage}`);
        }
      }
    }

    return result;
  }

  /**
   * Get list of files to process based on options
   */
  private async getFilesToProcess(options: FileOperationOptions): Promise<string[]> {
    // If specific patterns provided, use those
    if (options.patterns && options.patterns.length > 0) {
      const files: string[] = [];
      
      for (const pattern of options.patterns) {
        const resolvedPath = resolve(pattern);
        
        if (existsSync(resolvedPath)) {
          files.push(resolvedPath);
        } else if (pattern.includes('*')) {
          // It's a glob pattern, use config to find files
          const config = await loadConfig(undefined, {
            includeGitignored: options.includeGitignored
          });
          const matchedFiles = await findProtectedFiles({
            ...config,
            patterns: [pattern]
          });
          files.push(...matchedFiles);
        } else {
          warn(`⚠️  File not found: ${pattern}`);
        }
      }
      
      return [...new Set(files)]; // Remove duplicates
    }

    // Use config file patterns
    const config = await loadConfig(undefined, {
      includeGitignored: options.includeGitignored
    });
    
    if (!config.patterns || config.patterns.length === 0) {
      throw new Error('No patterns specified. Use .ailock file or provide file arguments.');
    }

    return findProtectedFiles(config);
  }

  /**
   * Display operation start message
   */
  private displayOperationStart(operation: 'lock' | 'unlock', files: string[]): void {
    const action = operation === 'lock' ? 'lock' : 'unlock';
    info(chalk.cyan(`Found ${files.length} file(s) to ${action}:`));
    
    for (const file of files.slice(0, 10)) {
      const icon = operation === 'lock' ? '🔒' : '🔓';
      info(chalk.gray(`  ${icon} ${file}`));
    }
    
    if (files.length > 10) {
      info(chalk.gray(`  ... and ${files.length - 10} more`));
    }
    
    info(''); // Empty line for readability
  }

  /**
   * Display operation summary
   */
  public async displaySummary(operation: 'lock' | 'unlock', result: FileOperationResult, options: FileOperationOptions): Promise<void> {
    if (options.dryRun) {
      info(chalk.yellow(`\n🔍 Dry run completed. ${result.totalFiles} file(s) would be ${operation}ed.`));
      return;
    }

    // Success summary
    if (result.successful.length > 0) {
      const action = operation === 'lock' ? 'Locked' : 'Unlocked';
      success(`✅ ${action} ${result.successful.length} file(s)`);
    }

    // Skipped summary
    if (result.skipped.length > 0 && options.verbose) {
      const state = operation === 'lock' ? 'already locked' : 'already unlocked';
      info(chalk.gray(`ℹ️  Skipped ${result.skipped.length} file(s) (${state})`));
    }

    // Blocked summary. Only a genuine quota wall gets the quota framing and the
    // conversion pitch; anything else is reported as what it actually is.
    if (result.blocked.length > 0) {
      const quotaBlocked = result.blocked.filter(b => b.quotaExceeded);
      const otherBlocked = result.blocked.filter(b => !b.quotaExceeded);

      if (quotaBlocked.length > 0) {
        error(`\n🚫 Quota exceeded: ${quotaBlocked.length} file(s) could not be locked`);
        const quotaStatus = await getProjectQuotaStatusSummary();
        warn(`   Current quota: ${quotaStatus}`);
        this.displayConversionMessage(quotaBlocked.length);
      }

      if (otherBlocked.length > 0) {
        error(`\n🚫 ${otherBlocked.length} file(s) could not be locked:`);
        const seen = new Set<string>();
        for (const b of otherBlocked) {
          // Same reason for many files is one problem, not N problems.
          if (seen.has(b.reason)) continue;
          seen.add(b.reason);
          error(`  • ${b.reason}`);
        }
        if (quotaBlocked.length === 0) {
          warn('   Run from a real project directory, not a temporary or system path.');
        }
      }
    }

    // Failed summary with helpful suggestions
    if (result.failed.length > 0) {
      error(`\n❌ Failed to ${operation} ${result.failed.length} file(s):`);
      for (const failedItem of result.failed) {
        error(`  • ${failedItem.file}: ${failedItem.error}`);
      }

      // Provide helpful suggestions based on operation and error types
      this.displayErrorSuggestions(operation, result.failed);
    }

    // Additional hints
    if (operation === 'unlock' && result.successful.length > 0) {
      warn('\n⚠️  Remember to lock these files again after editing!');
      info(chalk.gray('💡 Consider using: ailock edit <filename> (auto-relock after editing)'));
    }
  }

  /**
   * Display helpful suggestions based on error types
   */
  private displayErrorSuggestions(operation: 'lock' | 'unlock', failures: Array<{file: string, error: string}>): void {
    const permissionErrors = failures.filter(f => 
      f.error.toLowerCase().includes('permission') || 
      f.error.toLowerCase().includes('denied') ||
      f.error.toLowerCase().includes('eperm')
    );

    const lockedErrors = failures.filter(f =>
      f.error.toLowerCase().includes('locked') ||
      f.error.toLowerCase().includes('busy') ||
      f.error.toLowerCase().includes('ebusy')
    );

    const pathErrors = failures.filter(f =>
      f.error.toLowerCase().includes('path') ||
      f.error.toLowerCase().includes('directory') ||
      f.error.toLowerCase().includes('outside allowed')
    );

    info(chalk.blue('\n💡 Helpful suggestions:'));

    if (permissionErrors.length > 0) {
      info(chalk.gray('   • Permission errors may require elevated privileges'));
      info(chalk.gray('   • Try: sudo ailock ' + (operation === 'lock' ? 'lock' : 'unlock') + ' <file>'));
      if (operation === 'unlock') {
        info(chalk.gray('   • For editing: ailock edit <file> (handles permissions automatically)'));
      }
    }

    if (lockedErrors.length > 0) {
      info(chalk.gray('   • Files may be locked by another process'));
      info(chalk.gray('   • Try: ailock emergency-unlock <file> (if files are stuck)'));
      info(chalk.gray('   • Or: ailock doctor (diagnose lock issues)'));
    }

    if (pathErrors.length > 0) {
      info(chalk.gray('   • Path validation is blocking access'));
      info(chalk.gray('   • Ensure files are in your project directory'));
      info(chalk.gray('   • Check file paths for special characters or suspicious patterns'));
    }

    // General suggestions
    if (failures.length > 0) {
      info(chalk.gray('   • Run: ailock doctor (comprehensive health check)'));
      info(chalk.gray('   • Use: ailock diagnose <file> (detailed file analysis)'));
      
      if (operation === 'unlock' && failures.some(f => f.error.includes('permission'))) {
        info(chalk.blue('\n🎯 Quick fix for editing:'));
        info(chalk.gray('   ailock edit <file>  # Temporarily unlock, open editor, then relock'));
      }
    }
  }

  /**
   * Display conversion message when quota is exceeded
   */
  private displayConversionMessage(blockedCount: number): void {
    // Main conversion trigger message (as per blueprint)
    error(chalk.red('\n🚫 Free quota limit reached.'));
    
    info(chalk.yellow('\n✨ Unlock more capacity instantly!'));
    info(chalk.white('   Visit https://ailock.dev to sign up and get 1 FREE auth code (+1 permanent capacity).'));
    
    info(chalk.green('\n💡 Growth hack:'));
    info(chalk.white('   Use a friend\'s referral link to sign up and get 2 EXTRA auth codes!'));
    info(chalk.gray('   (That\'s 4 total directories instead of 2)'));
    
    info(chalk.cyan('\n🔑 Already have an auth code?'));
    info(chalk.white('   Run: ') + chalk.bold.cyan('ailock auth <your_auth_code>'));
    
    // Additional motivation for viral sharing
    info(chalk.magenta('\n🎁 Bonus rewards:'));
    info(chalk.gray('   • Invite friends = Both get 1 auth code when they activate'));
    info(chalk.gray('   • Invite 3 friends = Get 5 BONUS auth codes!'));
    info(chalk.gray('   • Every auth code = +1 permanent directory capacity'));
    
    if (blockedCount > 5) {
      info(chalk.yellow(`\n📊 You tried to lock ${blockedCount} additional directories.`));
      info(chalk.white('   Sign up now to unlock your full productivity potential!'));
    }
  }
}