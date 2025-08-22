import { Command } from 'commander';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { FileOperationService } from '../services/FileOperationService.js';

interface EditOptions {
  editor?: string;
  timeout?: string;
  noRelock?: boolean;
  verbose?: boolean;
}

/**
 * Smart edit command that temporarily unlocks files for editing
 */
export function createEditCommand(): Command {
  const editCommand = new Command('edit')
    .description('Temporarily unlock a file for editing, then relock it')
    .argument('<file>', 'File to edit')
    .option('-e, --editor <editor>', 'Editor to use (default: $EDITOR or vi)')
    .option('-t, --timeout <duration>', 'Auto-relock timeout (e.g., 30m, 1h)', '30m')
    .option('--no-relock', 'Skip automatic relock after editing')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (filePath: string, options: EditOptions) => {
      try {
        await executeEdit(filePath, options);
      } catch (error) {
        console.error(chalk.red('❌ Edit failed:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return editCommand;
}

async function executeEdit(filePath: string, options: EditOptions): Promise<void> {
  const service = new FileOperationService();
  const absolutePath = resolve(filePath);

  // Validate file exists
  if (!existsSync(absolutePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  if (options.verbose) {
    console.log(chalk.blue('📝 Starting smart edit session...'));
    console.log(chalk.gray(`File: ${absolutePath}`));
  }

  // Check if file is currently locked
  const isLocked = await isFileLocked(absolutePath);
  let wasLockedInitially = false;

  if (isLocked) {
    wasLockedInitially = true;
    console.log(chalk.yellow('🔓 File is locked, temporarily unlocking for editing...'));
    
    // Unlock the file
    await service.processFiles('unlock', {
      patterns: [absolutePath],
      verbose: options.verbose
    });
  }

  try {
    // Determine editor
    const editor = getEditor(options.editor);
    if (options.verbose) {
      console.log(chalk.gray(`Using editor: ${editor}`));
    }

    // Set up timeout if specified and not disabled
    let timeoutId: NodeJS.Timeout | null = null;
    if (!options.noRelock && wasLockedInitially) {
      const timeoutMs = parseTimeoutString(options.timeout || '30m');
      timeoutId = setTimeout(async () => {
        console.log(chalk.yellow(`\n⏰ Auto-relock timeout reached (${options.timeout})`));
        console.log(chalk.yellow('🔒 Re-locking file...'));
        await service.processFiles('lock', {
          patterns: [absolutePath],
          verbose: options.verbose
        });
        console.log(chalk.green('✅ File automatically re-locked'));
      }, timeoutMs);

      console.log(chalk.gray(`Auto-relock scheduled in ${options.timeout}`));
    }

    // Launch editor and wait for it to exit
    await launchEditor(editor, absolutePath);

    // Clear timeout if editor exited before timeout
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    // Re-lock the file if it was locked initially and relock is enabled
    if (wasLockedInitially && !options.noRelock) {
      console.log(chalk.yellow('🔒 Re-locking file...'));
      await service.processFiles('lock', {
        patterns: [absolutePath],
        verbose: options.verbose
      });
      console.log(chalk.green('✅ File re-locked successfully'));
    }

    console.log(chalk.green('✅ Edit session completed'));

  } catch (error) {
    // Ensure file is re-locked even if editing failed
    if (wasLockedInitially && !options.noRelock) {
      try {
        console.log(chalk.yellow('🔒 Re-locking file due to error...'));
        await service.processFiles('lock', {
          patterns: [absolutePath],
          verbose: options.verbose
        });
        console.log(chalk.green('✅ File re-locked after error'));
      } catch (lockError) {
        console.error(chalk.red('❌ Failed to re-lock file:'), lockError);
      }
    }
    throw error;
  }
}

function getEditor(editorOption?: string): string {
  if (editorOption) {
    return editorOption;
  }

  // Check environment variables
  const envEditor = process.env.EDITOR || process.env.VISUAL;
  if (envEditor) {
    return envEditor;
  }

  // Platform-specific defaults
  if (process.platform === 'win32') {
    return 'notepad';
  }

  return 'vi';
}

function launchEditor(editor: string, filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const editorArgs = editor.split(' ');
    const editorCommand = editorArgs[0];
    const editorOptions = [...editorArgs.slice(1), filePath];

    const child = spawn(editorCommand, editorOptions, {
      stdio: 'inherit',
      shell: false
    });

    child.on('exit', (code) => {
      if (code === 0 || code === null) {
        resolve();
      } else {
        reject(new Error(`Editor exited with code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to launch editor: ${error.message}`));
    });
  });
}

function parseTimeoutString(timeout: string): number {
  const match = timeout.match(/^(\d+)([smh])$/);
  if (!match) {
    throw new Error('Invalid timeout format. Use format like: 30s, 5m, 1h');
  }

  const value = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    default: throw new Error(`Invalid timeout unit: ${unit}`);
  }
}

async function isFileLocked(filePath: string): Promise<boolean> {
  try {
    const { getPlatformAdapter } = await import('../core/platform.js');
    const adapter = getPlatformAdapter();
    return await adapter.isLocked(filePath);
  } catch {
    return false;
  }
}