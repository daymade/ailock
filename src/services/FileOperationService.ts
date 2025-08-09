import chalk from 'chalk';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { loadConfig, findProtectedFiles } from '../core/config.js';
import { getPlatformAdapter } from '../core/platform.js';

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
        console.log(chalk.gray(`  Would ${operation}: ${file}`));
        result.successful.push(file);
        continue;
      }

      try {
        // Check current state
        const isLocked = await this.adapter.isLocked(file);
        
        if (operation === 'lock' && isLocked) {
          if (options.verbose) {
            console.log(chalk.gray(`  ℹ️  Already locked: ${file}`));
          }
          result.skipped.push(file);
          continue;
        }
        
        if (operation === 'unlock' && !isLocked) {
          if (options.verbose) {
            console.log(chalk.gray(`  ℹ️  Already unlocked: ${file}`));
          }
          result.skipped.push(file);
          continue;
        }

        // Perform the operation
        if (operation === 'lock') {
          await this.adapter.lockFile(file);
        } else {
          await this.adapter.unlockFile(file);
        }
        
        result.successful.push(file);
        
        if (options.verbose) {
          const icon = operation === 'lock' ? '🔒' : '🔓';
          console.log(chalk.green(`  ${icon} ${file}`));
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        result.failed.push({ file, error: errorMessage });
        
        if (options.verbose) {
          console.log(chalk.red(`  ❌ Failed to ${operation} ${file}: ${errorMessage}`));
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
          console.log(chalk.yellow(`⚠️  File not found: ${pattern}`));
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
    console.log(chalk.cyan(`Found ${files.length} file(s) to ${action}:`));
    
    for (const file of files.slice(0, 10)) {
      const icon = operation === 'lock' ? '🔒' : '🔓';
      console.log(chalk.gray(`  ${icon} ${file}`));
    }
    
    if (files.length > 10) {
      console.log(chalk.gray(`  ... and ${files.length - 10} more`));
    }
    
    console.log(); // Empty line for readability
  }

  /**
   * Display operation summary
   */
  public displaySummary(operation: 'lock' | 'unlock', result: FileOperationResult, options: FileOperationOptions): void {
    if (options.dryRun) {
      console.log(chalk.yellow(`\n🔍 Dry run completed. ${result.totalFiles} file(s) would be ${operation}ed.`));
      return;
    }

    // Success summary
    if (result.successful.length > 0) {
      const action = operation === 'lock' ? 'Locked' : 'Unlocked';
      console.log(chalk.green(`✅ ${action} ${result.successful.length} file(s)`));
    }

    // Skipped summary
    if (result.skipped.length > 0 && options.verbose) {
      const state = operation === 'lock' ? 'already locked' : 'already unlocked';
      console.log(chalk.gray(`ℹ️  Skipped ${result.skipped.length} file(s) (${state})`));
    }

    // Failed summary
    if (result.failed.length > 0) {
      console.log(chalk.red(`\n❌ Failed to ${operation} ${result.failed.length} file(s):`));
      for (const { file, error } of result.failed) {
        console.log(chalk.red(`  • ${file}: ${error}`));
      }
    }

    // Additional hints
    if (operation === 'unlock' && result.successful.length > 0) {
      console.log(chalk.yellow('\n⚠️  Remember to lock these files again after editing!'));
      console.log(chalk.gray('   Run: ailock lock'));
    }
  }
}