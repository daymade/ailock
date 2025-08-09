import { Command } from 'commander';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { getPlatformAdapter } from '../core/platform.js';
import { getRepoStatus } from '../core/git.js';
import { loadConfig, findProtectedFiles } from '../core/config.js';

interface DoctorOptions {
  fix?: boolean;
  verbose?: boolean;
}

interface DiagnosticIssue {
  type: 'error' | 'warning' | 'info';
  category: string;
  message: string;
  fix?: () => Promise<void>;
}

/**
 * Doctor command to diagnose and fix common ailock issues
 */
export function createDoctorCommand(): Command {
  const doctorCommand = new Command('doctor')
    .description('🩺 Diagnose and fix common ailock issues')
    .option('--fix', 'Automatically fix issues where possible')
    .option('-v, --verbose', 'Show detailed diagnostic information')
    .action(async (options: DoctorOptions) => {
      try {
        await executeDiagnosis(options);
      } catch (error) {
        console.error(chalk.red('❌ Doctor failed:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return doctorCommand;
}

async function executeDiagnosis(options: DoctorOptions): Promise<void> {
  console.log(chalk.blue('🩺 AILock Health Check'));
  console.log(chalk.gray('════════════════════'));
  console.log();

  const issues: DiagnosticIssue[] = [];
  const adapter = getPlatformAdapter();

  // Check 1: Basic configuration
  console.log(chalk.blue('📋 Checking configuration...'));
  try {
    const config = await loadConfig();
    console.log(chalk.green('  ✅ Configuration loaded successfully'));
    
    if (config.patterns.length === 0) {
      issues.push({
        type: 'warning',
        category: 'Configuration',
        message: 'No protection patterns configured'
      });
    } else {
      console.log(chalk.gray(`  📁 Found ${config.patterns.length} protection pattern(s)`));
    }
  } catch (error) {
    issues.push({
      type: 'error',
      category: 'Configuration',
      message: `Cannot load .ailock configuration: ${error}`
    });
  }

  // Check 2: Protected files status
  console.log(chalk.blue('🔒 Checking protected files...'));
  try {
    const config = await loadConfig();
    const protectedFiles = await findProtectedFiles(config);
    
    if (protectedFiles.length === 0) {
      console.log(chalk.yellow('  ⚠️  No protected files found'));
      issues.push({
        type: 'info',
        category: 'Files',
        message: 'No files match your protection patterns'
      });
    } else {
      console.log(chalk.gray(`  📁 Found ${protectedFiles.length} protected file(s)`));
      
      // Check for orphaned locks
      let orphanedLocks = 0;
      let inaccessibleFiles = 0;
      
      for (const file of protectedFiles) {
        if (!existsSync(file)) {
          console.log(chalk.yellow(`  ⚠️  Protected file no longer exists: ${file}`));
          continue;
        }
        
        try {
          const isLocked = await adapter.isLocked(file);
          const canRead = await canAccessFile(file);
          
          if (isLocked && !canRead) {
            orphanedLocks++;
            if (options.verbose) {
              console.log(chalk.red(`  🔒💀 Orphaned lock: ${file}`));
            }
          } else if (!isLocked && !canRead) {
            inaccessibleFiles++;
            if (options.verbose) {
              console.log(chalk.yellow(`  🚫 Inaccessible: ${file}`));
            }
          }
        } catch (error) {
          console.log(chalk.red(`  ❌ Cannot check ${file}: ${error}`));
        }
      }
      
      if (orphanedLocks > 0) {
        issues.push({
          type: 'error',
          category: 'Orphaned Locks',
          message: `${orphanedLocks} file(s) have orphaned locks`,
          fix: async () => {
            console.log(chalk.blue('🔧 Fixing orphaned locks...'));
            console.log(chalk.gray('💡 Run: ailock emergency-unlock --all'));
          }
        });
      }
      
      if (inaccessibleFiles > 0) {
        issues.push({
          type: 'warning',
          category: 'File Access',
          message: `${inaccessibleFiles} file(s) are inaccessible`
        });
      }
    }
  } catch (error) {
    issues.push({
      type: 'error',
      category: 'File Check',
      message: `Cannot check protected files: ${error}`
    });
  }

  // Check 3: Git integration
  console.log(chalk.blue('🔧 Checking Git integration...'));
  try {
    const repoStatus = await getRepoStatus();
    
    if (!repoStatus.isGitRepo) {
      console.log(chalk.yellow('  ⚠️  Not in a Git repository'));
      issues.push({
        type: 'info',
        category: 'Git',
        message: 'Git hooks not applicable (not in Git repo)'
      });
    } else {
      console.log(chalk.green('  ✅ Git repository detected'));
      
      if (!repoStatus.hasAilockHook) {
        issues.push({
          type: 'warning',
          category: 'Git Hooks',
          message: 'Pre-commit hook not installed',
          fix: async () => {
            console.log(chalk.blue('🔧 Installing Git hooks...'));
            console.log(chalk.gray('💡 Run: ailock hooks install'));
          }
        });
      } else {
        console.log(chalk.green('  ✅ Pre-commit hook installed'));
      }
    }
  } catch (error) {
    issues.push({
      type: 'error',
      category: 'Git',
      message: `Cannot check Git status: ${error}`
    });
  }

  // Check 4: Platform capabilities
  console.log(chalk.blue('🖥️  Checking platform capabilities...'));
  try {
    const { detectPlatform } = await import('../core/platform.js');
    const platformType = detectPlatform();
    console.log(chalk.gray(`  💻 Platform: ${platformType}`));
    
    // Test basic locking capability
    const testFile = '/tmp/ailock-doctor-test-' + Date.now();
    require('fs').writeFileSync(testFile, 'test');
    
    try {
      await adapter.lockFile(testFile);
      await adapter.unlockFile(testFile);
      console.log(chalk.green('  ✅ File locking works correctly'));
    } catch (error) {
      issues.push({
        type: 'error',
        category: 'Platform',
        message: `File locking not working: ${error}`
      });
    } finally {
      try {
        require('fs').unlinkSync(testFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    issues.push({
      type: 'error',
      category: 'Platform',
      message: `Platform check failed: ${error}`
    });
  }

  // Report results
  console.log();
  console.log(chalk.blue('📊 Diagnosis Results'));
  console.log(chalk.gray('══════════════════'));

  if (issues.length === 0) {
    console.log(chalk.green('🎉 All systems operational!'));
    console.log(chalk.gray('   Your ailock setup is healthy.'));
    return;
  }

  const errors = issues.filter(i => i.type === 'error');
  const warnings = issues.filter(i => i.type === 'warning');
  const infos = issues.filter(i => i.type === 'info');

  if (errors.length > 0) {
    console.log(chalk.red(`❌ ${errors.length} error(s) found:`));
    errors.forEach(issue => {
      console.log(chalk.red(`   • ${issue.category}: ${issue.message}`));
    });
  }

  if (warnings.length > 0) {
    console.log(chalk.yellow(`⚠️  ${warnings.length} warning(s):`));
    warnings.forEach(issue => {
      console.log(chalk.yellow(`   • ${issue.category}: ${issue.message}`));
    });
  }

  if (infos.length > 0) {
    console.log(chalk.blue(`ℹ️  ${infos.length} info item(s):`));
    infos.forEach(issue => {
      console.log(chalk.blue(`   • ${issue.category}: ${issue.message}`));
    });
  }

  // Auto-fix if requested
  if (options.fix) {
    console.log();
    console.log(chalk.blue('🔧 Attempting automatic fixes...'));
    
    const fixableIssues = issues.filter(i => i.fix);
    if (fixableIssues.length === 0) {
      console.log(chalk.gray('   No automatic fixes available.'));
    } else {
      for (const issue of fixableIssues) {
        try {
          await issue.fix!();
        } catch (error) {
          console.error(chalk.red(`   ❌ Fix failed for ${issue.category}: ${error}`));
        }
      }
    }
  }

  // Exit with error code if serious issues found
  if (errors.length > 0) {
    process.exit(1);
  }
}

async function canAccessFile(filePath: string): Promise<boolean> {
  try {
    require('fs').accessSync(filePath, require('fs').constants.R_OK);
    return true;
  } catch {
    return false;
  }
}