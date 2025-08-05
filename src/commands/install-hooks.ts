import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { access, constants } from 'fs/promises';
import { isGitRepository, getRepoRoot, installPreCommitHook, getHookInfo } from '../core/git.js';

export const installHooksCommand = new Command('install-hooks')
  .description('Install Git pre-commit hooks to protect locked files')
  .option('-f, --force', 'Overwrite existing hooks')
  .option('-y, --yes', 'Skip confirmation prompts')
  .action(async (options) => {
    try {
      // Check if we're in a Git repository
      const isRepo = await isGitRepository();
      if (!isRepo) {
        console.error(chalk.red('Error: Not a Git repository'));
        console.log(chalk.gray('Initialize a Git repository first: git init'));
        process.exit(1);
      }
      
      const repoRoot = await getRepoRoot();
      if (!repoRoot) {
        console.error(chalk.red('Error: Could not determine Git repository root'));
        process.exit(1);
      }
      
      // Check existing hook status
      const hookInfo = getHookInfo(repoRoot);
      
      console.log(chalk.blue.bold('🪝 Installing ailock Git hooks\n'));
      
      if (hookInfo.exists) {
        if (hookInfo.isAilockManaged) {
          console.log(chalk.yellow('⚠️  Ailock pre-commit hook already exists'));
          
          if (!options.force && !options.yes) {
            const { shouldUpdate } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'shouldUpdate',
                message: 'Update existing ailock hook?',
                default: true
              }
            ]);
            
            if (!shouldUpdate) {
              console.log(chalk.gray('Hook installation cancelled'));
              return;
            }
          }
          
          console.log(chalk.blue('🔄 Updating existing ailock hook...'));
        } else {
          console.log(chalk.red('❌ Pre-commit hook already exists (not managed by ailock)'));
          console.log(chalk.gray(`Hook path: ${hookInfo.hookPath}`));
          
          if (!options.force) {
            if (options.yes) {
              console.error(chalk.red('Error: Cannot overwrite existing hook without --force flag'));
              process.exit(1);
            }
            
            const { shouldOverwrite } = await inquirer.prompt([
              {
                type: 'confirm',
                name: 'shouldOverwrite',
                message: 'Overwrite existing pre-commit hook? (This will replace it entirely)',
                default: false
              }
            ]);
            
            if (!shouldOverwrite) {
              console.log(chalk.gray('Hook installation cancelled'));
              console.log(chalk.yellow('💡 You can manually add ailock protection to your existing hook:'));
              console.log(chalk.gray('   if ! ailock-pre-commit-check $(git diff --cached --name-only); then'));
              console.log(chalk.gray('     echo "Commit blocked: locked files modified"'));
              console.log(chalk.gray('     exit 1'));
              console.log(chalk.gray('   fi'));
              return;
            }
          }
          
          console.log(chalk.yellow('⚠️  Overwriting existing pre-commit hook...'));
        }
      } else {
        console.log(chalk.blue('📝 Installing new pre-commit hook...'));
      }
      
      // Install the hook
      await installPreCommitHook(repoRoot, options.force);
      
      // Get fresh hook info after installation
      const freshHookInfo = getHookInfo(repoRoot);
      
      console.log(chalk.green('✅ Pre-commit hook installed successfully!'));
      console.log(chalk.gray(`   Hook location: ${freshHookInfo.hookPath}`));
      
      // Show what the hook does
      console.log('\n' + chalk.blue.bold('🛡️  Protection Features:'));
      console.log(chalk.gray('   • Prevents commits that modify locked files'));
      console.log(chalk.gray('   • Shows helpful unlock instructions on violation'));
      console.log(chalk.gray('   • Works with all Git clients and IDEs'));
      
      // Show next steps
      console.log('\n' + chalk.blue.bold('🚀 Next Steps:'));
      console.log(chalk.gray('   1. Lock sensitive files: ailock lock'));
      console.log(chalk.gray('   2. Try committing - hook will protect locked files'));
      console.log(chalk.gray('   3. Check status anytime: ailock status'));
      
      // Test hook functionality
      console.log('\n' + chalk.blue('🧪 Testing hook installation...'));
      
      try {
        // Check if hook is executable using fs.access
        await access(freshHookInfo.hookPath, constants.X_OK);
        console.log(chalk.green('✅ Hook is executable and ready'));
      } catch (error) {
        console.log(chalk.yellow('⚠️  Hook may not be executable'));
        console.log(chalk.gray(`   Run: chmod +x "${freshHookInfo.hookPath}"`));
        if (error instanceof Error) {
          console.log(chalk.gray(`   Error: ${error.message}`));
        }
      }
      
    } catch (error) {
      console.error(chalk.red('Error installing hooks:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });