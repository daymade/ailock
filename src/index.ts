#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { lockCommand } from './commands/lock.js';
import { unlockCommand } from './commands/unlock.js';
import { statusCommand } from './commands/status.js';
import { statusInteractiveCommand } from './commands/status-interactive.js';
// Removed - duplicate functionality now in 'hooks' command
import { preCommitCheckCommand } from './commands/pre-commit-check.js';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { generateCommand } from './commands/generate.js';
import { diagnoseCommand } from './commands/diagnose.js';
import { completionCommand, setupCompletionCommand } from './commands/completion.js';
import { completionHelperCommand } from './commands/completion-helper.js';
import { hooksCommand } from './commands/hooks.js';

const program = new Command();

// Global options
program
  .option('-q, --quiet', 'Suppress informational output');

// Detect if called as 'aiunlock'
const isAiunlock = process.argv[1]?.endsWith('aiunlock');

// Check if quiet mode is enabled
export function isQuietMode(): boolean {
  const quietIndex = process.argv.indexOf('--quiet');
  const qIndex = process.argv.indexOf('-q');
  return quietIndex !== -1 || qIndex !== -1;
}

// Smart command routing for better UX
function handleSmartRouting() {
  const args = process.argv.slice(2);
  
  // If no arguments, show status
  if (args.length === 0) {
    process.argv.push('status');
    return;
  }
  
  // If first argument exists and is not a known command, check if it's a path
  const firstArg = args[0];
  const knownCommands = [
    'init', 'lock', 'unlock', 'status', 'status-interactive', 
    'list', 'generate', 'hooks', 'diagnose', 'pre-commit-check',
    'completion', 'setup-completion', 'completion-helper',
    '--help', '-h', '--version', '-V'
  ];
  
  if (!knownCommands.includes(firstArg) && !firstArg.startsWith('-')) {
    // Check if it's a valid path (file or directory)
    try {
      const resolvedPath = resolve(firstArg);
      
      // Check if it's an existing file/directory OR a glob pattern
      const isPath = existsSync(resolvedPath) || 
                     firstArg.includes('*') || 
                     firstArg.includes('/') ||
                     firstArg.includes('\\');
      
      if (isPath) {
        // It's a path, so treat it as lock/unlock command
        if (isAiunlock) {
          process.argv.splice(2, 0, 'unlock');
        } else {
          process.argv.splice(2, 0, 'lock');
        }
      } else {
        // Not a path, it's an unknown command - show error and help
        console.error(chalk.red(`Error: Unknown command '${firstArg}'`));
        console.error(chalk.yellow(`\nDid you mean to lock a file? Use: ${isAiunlock ? 'aiunlock' : 'ailock'} <file-path>`));
        console.error(chalk.gray(`\nRun '${isAiunlock ? 'aiunlock' : 'ailock'} --help' to see available commands`));
        process.exit(1);
      }
    } catch {
      // If path resolution fails, show status
      process.argv = process.argv.slice(0, 2).concat(['status']);
    }
  }
}

// Apply smart routing
handleSmartRouting();

program
  .name(isAiunlock ? 'aiunlock' : 'ailock')
  .description('AI-Proof File Guard - Protect sensitive files from accidental AI modifications')
  .version('1.5.1');

// Add commands
program.addCommand(initCommand);
program.addCommand(lockCommand);
program.addCommand(unlockCommand);
program.addCommand(statusCommand);
program.addCommand(statusInteractiveCommand);
program.addCommand(listCommand);
program.addCommand(generateCommand);
program.addCommand(hooksCommand); // Consolidated hook management
program.addCommand(diagnoseCommand);
program.addCommand(completionCommand);
program.addCommand(setupCompletionCommand);

// Hidden commands
program.addCommand(preCommitCheckCommand);
program.addCommand(completionHelperCommand);

// Global error handling
process.on('uncaughtException', (error) => {
  console.error(chalk.red('Error:'), error.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error(chalk.red('Error:'), reason);
  process.exit(1);
});

// Parse command line arguments
program.parse(process.argv);