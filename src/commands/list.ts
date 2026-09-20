import { Command } from 'commander';
import chalk from 'chalk';
import path from 'path';
import micromatch from 'micromatch';
import { realpathSync } from 'fs';
import { loadConfig, findProtectedFiles, type AilockConfig } from '../core/config.js';
import { getPlatformAdapter } from '../core/platform.js';
import { getRepoStatus } from '../core/git.js';

/**
 * Answer "is THIS one file protected?" without walking the project.
 *
 * `ailock list --json` globs the whole project for the protected patterns, which
 * costs seconds in a large repo and is called on every write by the Claude hook.
 * The hook only ever needs the verdict for the single file it is about to write,
 * so it passes --file and we answer that directly.
 *
 * Correctness rests on using the SAME matcher fast-glob uses (micromatch) with
 * the same defaults, so a path that the full glob would return is a path this
 * matches — no second, subtly different implementation of pattern semantics.
 * Calibrated against the full glob on real corpora; see
 * tests/integration/list-single-file.test.ts.
 */
function isProtectedPath(absolutePath: string, config: AilockConfig): boolean {
  if (config.patterns.length === 0) return false;

  // Compare like with like. `loadConfig` derives rootDir from process.cwd(), which
  // the OS has already resolved through symlinks (on macOS /var -> /private/var),
  // while a caller-supplied path may not be. Without normalising both sides,
  // path.relative() yields a "../.." escape for a file that IS inside the root and
  // we report it unprotected — a silent miss. realpathSync falls back to the
  // resolved path for anything that does not exist yet.
  const root = realpathOrSelf(config.rootDir);
  const target = realpathOrSelf(absolutePath);

  const relative = path.relative(root, target);
  // Outside the configured root, or the root itself: not a protected file.
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;

  // fast-glob is given cwd: rootDir, so patterns match the POSIX-style relative
  // path. On Windows path.relative yields backslashes; normalize before matching.
  const posixRelative = relative.split(path.sep).join('/');

  // Same ignore list findProtectedFiles passes to fast-glob.
  const ignore = ['node_modules/**', '.git/**', ...(config.ignore || [])];
  if (ignore.length > 0 && micromatch.isMatch(posixRelative, ignore)) return false;

  return micromatch.isMatch(posixRelative, config.patterns);
}

function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

export const listCommand = new Command('list')
  .description('List all protected files and their current status')
  .option('-l, --long', 'Show detailed information for each file')
  .option('--locked-only', 'Show only locked files')
  .option('--json', 'Output as JSON')
  .option('--file <path>', 'Report the status of ONE file instead of scanning the project')
  .action(async (options) => {
    try {
      const config = await loadConfig();

      // Single-file fast path: no glob, no directory walk. Output shape matches
      // the full listing so callers (the Claude hook) parse both identically.
      if (options.file) {
        const adapter = getPlatformAdapter();
        // Echo back the spelling the caller used (absolute), but decide using the
        // symlink-resolved path. Callers — the Claude hook compares the returned
        // absolutePath against the path it passed — would otherwise never match on
        // a path reached through a symlinked directory.
        const requestedPath = path.resolve(options.file);
        const absolutePath = realpathOrSelf(requestedPath);
        const protectedMatch = isProtectedPath(absolutePath, config);
        let isLocked = false;
        let error: string | null = null;

        if (protectedMatch) {
          try {
            isLocked = await adapter.isLocked(absolutePath);
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
          }
        }

        if (options.json) {
          const files = protectedMatch
            ? [{
                path: path.relative(process.cwd(), requestedPath),
                absolutePath: requestedPath,
                locked: isLocked,
                error
              }]
            : [];
          console.log(JSON.stringify({ files, total: files.length }, null, 2));
          return;
        }

        if (!protectedMatch) {
          console.log(chalk.gray(`${options.file} does not match any protected pattern`));
          return;
        }
        const icon = isLocked ? '🔒' : '🔓';
        const text = isLocked ? 'LOCKED' : 'unlocked';
        console.log(chalk[isLocked ? 'green' : 'yellow'](`${icon} ${options.file} ${text}`));
        if (error) console.log(chalk.red(`   Error: ${error}`));
        return;
      }

      const protectedFiles = await findProtectedFiles(config);
      const adapter = getPlatformAdapter();
      const currentDir = process.cwd();
      
      if (protectedFiles.length === 0) {
        if (options.json) {
          console.log(JSON.stringify({ files: [], total: 0 }));
          return;
        }
        
        console.log(chalk.yellow('📄 No protected files found'));
        console.log(chalk.gray('💡 Check your .ailock configuration or create one with: ailock init'));
        return;
      }

      // Get detailed status for each file
      const fileDetails = await Promise.all(
        protectedFiles.map(async (file) => {
          const relativePath = path.relative(currentDir, file);
          let isLocked = false;
          let error: string | null = null;
          
          try {
            isLocked = await adapter.isLocked(file);
          } catch (err) {
            error = err instanceof Error ? err.message : String(err);
          }
          
          return {
            file,
            relativePath,
            isLocked,
            error
          };
        })
      );

      // Apply filters
      let filteredFiles = fileDetails;
      
      if (options.lockedOnly) {
        filteredFiles = fileDetails.filter(f => f.isLocked);
      } else if (options.unlockedOnly) {
        filteredFiles = fileDetails.filter(f => !f.isLocked);
      }

      if (options.json) {
        const jsonOutput = {
          files: filteredFiles.map(f => ({
            path: f.relativePath,
            absolutePath: f.file,
            locked: f.isLocked,
            error: f.error
          })),
          total: filteredFiles.length,
          locked: filteredFiles.filter(f => f.isLocked).length,
          unlocked: filteredFiles.filter(f => !f.isLocked).length
        };
        
        console.log(JSON.stringify(jsonOutput, null, 2));
        return;
      }

      // Header
      console.log(chalk.blue.bold('📄 Protected Files List\n'));
      
      // Summary
      const totalFiles = filteredFiles.length;
      const lockedCount = filteredFiles.filter(f => f.isLocked).length;
      const unlockedCount = totalFiles - lockedCount;
      
      console.log(chalk.blue(`Total: ${totalFiles} files`));
      console.log(chalk.green(`🔒 Locked: ${lockedCount}`));
      console.log(chalk.yellow(`🔓 Unlocked: ${unlockedCount}`));
      
      if (filteredFiles.some(f => f.error)) {
        const errorCount = filteredFiles.filter(f => f.error).length;
        console.log(chalk.red(`❌ Errors: ${errorCount}`));
      }
      
      console.log(); // Empty line

      // File listing
      if (options.long) {
        // Detailed listing
        for (const file of filteredFiles) {
          const statusIcon = file.isLocked ? '🔒' : '🔓';
          const statusColor = file.isLocked ? 'green' : 'yellow';
          const statusText = file.isLocked ? 'LOCKED' : 'unlocked';
          
          console.log(chalk[statusColor](`${statusIcon} ${file.relativePath}`));
          
          if (options.long) {
            console.log(chalk.gray(`   Path: ${file.file}`));
            console.log(chalk.gray(`   Status: ${statusText.toUpperCase()}`));
            
            if (file.error) {
              console.log(chalk.red(`   Error: ${file.error}`));
            }
            
            console.log(); // Empty line between files
          }
        }
      } else {
        // Compact listing
        const maxPathLength = Math.max(...filteredFiles.map(f => f.relativePath.length));
        
        for (const file of filteredFiles) {
          const statusIcon = file.isLocked ? '🔒' : '🔓';
          const statusColor = file.isLocked ? 'green' : 'yellow';
          const paddedPath = file.relativePath.padEnd(maxPathLength);
          const statusText = file.isLocked ? 'LOCKED' : 'unlocked';
          
          let line = chalk[statusColor](`${statusIcon} ${paddedPath} ${statusText}`);
          
          if (file.error) {
            line += chalk.red(` (${file.error})`);
          }
          
          console.log(line);
        }
      }

      // Get Git status if in repo
      try {
        const repoStatus = await getRepoStatus();
        
        if (repoStatus.isGitRepo) {
          console.log('\n' + chalk.blue.bold('🪝 Git Protection Status'));
          
          if (repoStatus.hasAilockHook) {
            console.log(chalk.green('✅ Pre-commit hook installed'));
          } else {
            console.log(chalk.yellow('⚠️  Pre-commit hook not installed'));
            console.log(chalk.gray('   Run: ailock hooks git'));
          }
        }
      } catch {
        // Ignore Git status errors
      }

      // Footer recommendations
      if (unlockedCount > 0) {
        console.log('\n' + chalk.yellow('💡 Recommendation: Lock unprotected files with: ailock lock'));
      }
      
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });
