import chalk from 'chalk';

/**
 * Check if quiet mode is enabled from command line arguments
 */
function isQuietMode(): boolean {
  const quietIndex = process.argv.indexOf('--quiet');
  const qIndex = process.argv.indexOf('-q');
  return quietIndex !== -1 || qIndex !== -1;
}

/**
 * Output information message (suppressed in quiet mode)
 */
export function info(message: string): void {
  if (!isQuietMode()) {
    console.log(message);
  }
}

/**
 * Output success message (suppressed in quiet mode)
 */
export function success(message: string): void {
  if (!isQuietMode()) {
    console.log(chalk.green(message));
  }
}

/**
 * Output warning message (always shown)
 */
export function warn(message: string): void {
  console.warn(chalk.yellow(message));
}

/**
 * Output error message (always shown)
 */
export function error(message: string): void {
  console.error(chalk.red(message));
}

/**
 * Output debug message (only in debug mode, suppressed in quiet mode)
 */
export function debug(message: string): void {
  if (process.env.DEBUG && !isQuietMode()) {
    console.debug(chalk.gray(message));
  }
}

/**
 * Output raw message (always shown, for data output)
 */
export function raw(message: string): void {
  console.log(message);
}