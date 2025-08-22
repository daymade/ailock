import { Command } from 'commander';
import { existsSync } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import { getPlatformAdapter } from '../core/platform.js';
import { SecurePathValidator } from '../security/PathValidator.js';

interface EmergencyUnlockOptions {
  force?: boolean;
  verbose?: boolean;
  all?: boolean;
}

/**
 * Emergency unlock command for orphaned locks and recovery scenarios
 */
export function createEmergencyUnlockCommand(): Command {
  const emergencyUnlockCommand = new Command('emergency-unlock')
    .description('🚨 Emergency unlock for orphaned locks (use with caution)')
    .argument('[files...]', 'Files to emergency unlock (or use --all)')
    .option('-f, --force', 'Force unlock even if file appears to be in use')
    .option('--all', 'Emergency unlock all protected files in current directory')
    .option('-v, --verbose', 'Show detailed operation info')
    .action(async (files: string[], options: EmergencyUnlockOptions) => {
      try {
        await executeEmergencyUnlock(files, options);
      } catch (error) {
        console.error(chalk.red('❌ Emergency unlock failed:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return emergencyUnlockCommand;
}

async function executeEmergencyUnlock(files: string[], options: EmergencyUnlockOptions): Promise<void> {
  console.log(chalk.yellow('🚨 EMERGENCY UNLOCK MODE'));
  console.log(chalk.yellow('⚠️  This bypasses normal safety checks'));
  console.log(chalk.yellow('⚠️  Only use when files are stuck in locked state'));
  console.log();

  // Get files to unlock
  let targetFiles: string[];
  
  if (options.all) {
    console.log(chalk.blue('📁 Finding all protected files in current directory...'));
    targetFiles = await findAllProtectedFiles();
  } else if (files.length === 0) {
    console.error(chalk.red('❌ No files specified. Use --all or specify file paths.'));
    console.log(chalk.gray('💡 Usage: ailock emergency-unlock <file1> [file2] ...'));
    console.log(chalk.gray('💡 Or:    ailock emergency-unlock --all'));
    process.exit(1);
  } else {
    targetFiles = files.map(f => resolve(f));
  }

  if (targetFiles.length === 0) {
    console.log(chalk.green('✅ No protected files found'));
    return;
  }

  // Validate files exist
  const existingFiles = targetFiles.filter(file => {
    if (!existsSync(file)) {
      console.warn(chalk.yellow(`⚠️  File not found: ${file}`));
      return false;
    }
    return true;
  });

  if (existingFiles.length === 0) {
    console.error(chalk.red('❌ No existing files to unlock'));
    process.exit(1);
  }

  console.log(chalk.blue(`🔓 Emergency unlocking ${existingFiles.length} file(s)...`));
  
  const adapter = getPlatformAdapter();
  const results = { success: 0, failed: 0, skipped: 0 };
  
  for (const file of existingFiles) {
    try {
      // Check if file is actually locked
      const isLocked = await adapter.isLocked(file);
      
      if (!isLocked) {
        console.log(chalk.gray(`  ⏭️  ${file} (already unlocked)`));
        results.skipped++;
        continue;
      }

      if (options.verbose) {
        console.log(chalk.gray(`  🔓 Unlocking: ${file}`));
      }

      // Force unlock - this bypasses normal safety checks
      await adapter.unlockFile(file);
      
      // Verify unlock succeeded
      const stillLocked = await adapter.isLocked(file);
      if (stillLocked) {
        throw new Error('File remains locked after unlock attempt');
      }

      console.log(chalk.green(`  ✅ ${file}`));
      results.success++;
      
    } catch (error) {
      console.error(chalk.red(`  ❌ ${file}: ${error instanceof Error ? error.message : error}`));
      results.failed++;
      
      if (options.verbose) {
        console.error(chalk.gray(`     Details: ${error}`));
      }
    }
  }

  // Summary
  console.log();
  console.log(chalk.blue('📊 Emergency unlock summary:'));
  console.log(`  ✅ Successfully unlocked: ${results.success}`);
  console.log(`  ❌ Failed to unlock: ${results.failed}`);
  console.log(`  ⏭️  Already unlocked: ${results.skipped}`);
  
  if (results.success > 0) {
    console.log();
    console.log(chalk.yellow('🔒 IMPORTANT: These files are now unprotected!'));
    console.log(chalk.yellow('💡 Remember to lock them again when finished:'));
    console.log(chalk.gray('   ailock lock <files>'));
    console.log(chalk.gray('   or use: ailock edit <file> (for temporary edits)'));
  }

  if (results.failed > 0) {
    console.log();
    console.log(chalk.red('⚠️  Some files could not be unlocked.'));
    console.log(chalk.gray('💡 Possible causes:'));
    console.log(chalk.gray('   - File system permissions'));
    console.log(chalk.gray('   - Active file locks by other processes'));
    console.log(chalk.gray('   - Immutable attributes requiring admin rights'));
    console.log(chalk.gray('💡 Try running with elevated privileges if needed'));
    
    process.exit(1);
  }
}

async function findAllProtectedFiles(): Promise<string[]> {
  try {
    const { loadConfig, findProtectedFiles } = await import('../core/config.js');
    const config = await loadConfig();
    return await findProtectedFiles(config);
  } catch (error) {
    console.warn(chalk.yellow(`⚠️  Could not load .ailock config: ${error}`));
    return [];
  }
}