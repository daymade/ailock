#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { lockCommand } from './commands/lock.js';
import { unlockCommand } from './commands/unlock.js';
import { statusCommand } from './commands/status.js';
import { statusInteractiveCommand } from './commands/status-interactive.js';
import { installHooksCommand } from './commands/install-hooks.js';
import { preCommitCheckCommand } from './commands/pre-commit-check.js';
import { initCommand } from './commands/init.js';
import { listCommand } from './commands/list.js';
import { generateCommand } from './commands/generate.js';

const program = new Command();

program
  .name('ailock')
  .description('AI-Proof File Guard - Protect sensitive files from accidental AI modifications')
  .version('1.0.0');

// Add commands
program.addCommand(initCommand);
program.addCommand(lockCommand);
program.addCommand(unlockCommand);
program.addCommand(statusCommand);
program.addCommand(statusInteractiveCommand);
program.addCommand(listCommand);
program.addCommand(generateCommand);
program.addCommand(installHooksCommand);

// Command for Git hook integration (internal use)
program.addCommand(preCommitCheckCommand);

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