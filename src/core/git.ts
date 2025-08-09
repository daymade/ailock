import { simpleGit, SimpleGit, CheckRepoActions } from 'simple-git';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { mkdir } from 'fs/promises';
import path from 'path';
import { loadConfig, findProtectedFiles } from './config.js';
import { getPlatformAdapter } from './platform.js';

export interface GitHookInfo {
  hookPath: string;
  exists: boolean;
  isAilockManaged: boolean;
  content?: string;
}

export interface RepoStatus {
  isGitRepo: boolean;
  hasAilockHook: boolean;
  hookInfo?: GitHookInfo;
  protectedFiles: string[];
  lockedFiles: string[];
}

/**
 * Get SimpleGit instance for the current directory
 */
export function getGit(cwd?: string): SimpleGit {
  return simpleGit(cwd || process.cwd());
}

/**
 * Check if current directory is a Git repository
 */
export async function isGitRepository(cwd?: string): Promise<boolean> {
  try {
    const git = getGit(cwd);
    await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the Git repository root directory
 */
export async function getRepoRoot(cwd?: string): Promise<string | null> {
  try {
    const git = getGit(cwd);
    const repoRoot = await git.revparse(['--show-toplevel']);
    return repoRoot.trim();
  } catch {
    return null;
  }
}

/**
 * Check if a file has staged changes that would be included in commit
 */
export async function hasStagedChanges(files: string[], cwd?: string): Promise<string[]> {
  try {
    const git = getGit(cwd);
    const status = await git.status();
    
    const changedFiles: string[] = [];
    const allChangedFiles = [
      ...status.staged,
      ...status.modified,
      ...status.created,
      ...status.renamed.map(r => r.to || r.from)
    ];
    
    for (const file of files) {
      const relativePath = path.relative(process.cwd(), file);
      if (allChangedFiles.includes(relativePath)) {
        changedFiles.push(file);
      }
    }
    
    return changedFiles;
  } catch {
    return [];
  }
}

/**
 * Get information about the pre-commit hook
 */
export function getHookInfo(repoRoot: string): GitHookInfo {
  const hookPath = path.join(repoRoot, '.git', 'hooks', 'pre-commit');
  const exists = existsSync(hookPath);
  
  let isAilockManaged = false;
  let content: string | undefined;
  
  if (exists) {
    content = readFileSync(hookPath, 'utf-8');
    isAilockManaged = content.includes('# ailock-managed') || content.includes('ailock-pre-commit-check');
  }
  
  return {
    hookPath,
    exists,
    isAilockManaged,
    content
  };
}

/**
 * Get comprehensive repository status
 */
export async function getRepoStatus(cwd?: string): Promise<RepoStatus> {
  const workingDir = cwd || process.cwd();
  const isRepo = await isGitRepository(workingDir);
  
  if (!isRepo) {
    return {
      isGitRepo: false,
      hasAilockHook: false,
      protectedFiles: [],
      lockedFiles: []
    };
  }
  
  const repoRoot = await getRepoRoot(workingDir);
  if (!repoRoot) {
    throw new Error('Could not determine Git repository root');
  }
  
  const hookInfo = getHookInfo(repoRoot);
  const config = await loadConfig(workingDir);
  const protectedFiles = await findProtectedFiles(config);
  
  // Check which protected files are currently locked
  const adapter = getPlatformAdapter();
  const lockedFiles: string[] = [];
  
  for (const file of protectedFiles) {
    try {
      const isLocked = await adapter.isLocked(file);
      if (isLocked) {
        lockedFiles.push(file);
      }
    } catch {
      // Ignore errors for individual files
    }
  }
  
  return {
    isGitRepo: true,
    hasAilockHook: hookInfo.isAilockManaged,
    hookInfo,
    protectedFiles,
    lockedFiles
  };
}

/**
 * Generate pre-commit hook script content
 * Uses null-terminated file processing to prevent shell injection
 */
export function generatePreCommitHook(): string {
  return `#!/bin/sh
# ailock-managed
# This hook is managed by ailock - do not edit manually
# Generated on ${new Date().toISOString()}

# ailock pre-commit protection
# Prevents committing changes to locked files

set -e

# Check if ailock is available
if ! command -v ailock >/dev/null 2>&1; then
    echo "Warning: ailock not found in PATH, skipping locked file check"
    exit 0
fi

# Check if there are any staged files
if [ -z "$(git diff --cached --name-only)" ]; then
    exit 0
fi

echo "🔒 Checking for modifications to locked files..."

# Process files safely using null delimiter to handle special characters in filenames
# This prevents shell injection attacks from malicious filenames
check_failed=0
git diff --cached --name-only -z | while IFS= read -r -d '' filename; do
    if [ -n "$filename" ]; then
        # Pass each filename as a properly quoted argument
        if ! ailock pre-commit-check "$filename"; then
            check_failed=1
            break
        fi
    fi
done || check_failed=1

if [ $check_failed -eq 1 ]; then
    echo ""
    echo "❌ Commit blocked: Attempted to modify locked files"
    echo "💡 To edit these files:"
    echo "   1. Run: ailock unlock <filename>"
    echo "   2. Make your changes"
    echo "   3. Run: ailock lock <filename>"
    echo "   4. Commit your changes"
    exit 1
fi

echo "✅ No locked files modified"
exit 0
`;
}

/**
 * Install or update the pre-commit hook
 */
export async function installPreCommitHook(repoRoot: string, force: boolean = false): Promise<void> {
  const hookInfo = getHookInfo(repoRoot);
  
  if (hookInfo.exists && !hookInfo.isAilockManaged && !force) {
    throw new Error('Pre-commit hook already exists and is not managed by ailock. Use --force to overwrite.');
  }
  
  // Ensure hooks directory exists
  const hooksDir = path.dirname(hookInfo.hookPath);
  await mkdir(hooksDir, { recursive: true });
  
  // Write the hook
  const hookContent = generatePreCommitHook();
  writeFileSync(hookInfo.hookPath, hookContent, { mode: 0o755 });
}

/**
 * Remove ailock pre-commit hook
 */
export function removePreCommitHook(repoRoot: string): void {
  const hookInfo = getHookInfo(repoRoot);
  
  if (!hookInfo.exists) {
    throw new Error('No pre-commit hook found');
  }
  
  if (!hookInfo.isAilockManaged) {
    throw new Error('Pre-commit hook is not managed by ailock');
  }
  
  // Remove the hook file
  const fs = require('fs');
  fs.unlinkSync(hookInfo.hookPath);
}