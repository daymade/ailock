import { Command } from 'commander';
import chalk from 'chalk';
import { FileDiagnostics } from '../utils/FileDiagnostics.js';

export const diagnoseCommand = new Command('diagnose')
  .description('Diagnose file locking/unlocking issues')
  .argument('<file>', 'File to diagnose')
  .option('-v, --verbose', 'Show verbose output')
  .action(async (file: string, options) => {
    try {
      console.log(chalk.blue.bold('🔍 Running File Diagnostics...\n'));
      
      const diagnostics = new FileDiagnostics();
      const report = await diagnostics.diagnoseUnlockIssues(file);
      
      if (options.verbose) {
        // Show full detailed report
        console.log(diagnostics.formatDiagnostics(report));
      } else {
        // Show summary
        console.log(chalk.blue.bold(`📄 File: ${report.filePath}`));
        console.log(chalk.gray(`   Permissions: ${report.permissions.octal}`));
        console.log(chalk.gray(`   Platform: ${report.flags.platform}`));
        
        if (report.flags.hasImmutableFlag) {
          console.log(chalk.yellow('   ⚠️  Immutable flag detected'));
        }
        
        if (report.atomicLockExists) {
          console.log(chalk.yellow('   ⚠️  Atomic lock file exists'));
        }
        
        console.log('\n' + chalk.blue.bold('🔍 Diagnosis:'));
        report.diagnosis.forEach(item => {
          console.log(chalk.gray(`   • ${item}`));
        });
        
        if (report.recommendations.length > 0) {
          console.log('\n' + chalk.blue.bold('💡 Recommendations:'));
          report.recommendations.forEach(item => {
            console.log(chalk.yellow(`   • ${item}`));
          });
        }
        
        console.log('\n' + chalk.gray('💡 Use --verbose for detailed information'));
      }
      
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });