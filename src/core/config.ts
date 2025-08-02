import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import glob from 'fast-glob';
import { getRepoRoot } from './git.js';

export interface AilockConfig {
  patterns: string[];
  ignore?: string[];
  rootDir: string;
  includeGitignored?: boolean;
  gitIgnorePatterns?: string[];
}

/**
 * Parse .ailock file content using gitignore-style syntax
 */
export function parseAilockContent(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .filter(line => !line.startsWith('!')) // TODO: Handle negation patterns in future
}

/**
 * Parse .gitignore file content and extract potentially sensitive patterns
 */
export function parseGitignoreContent(content: string): string[] {
  const lines = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .filter(line => !line.startsWith('!')); // Skip negation patterns for now

  // Smart filtering: only include patterns that likely contain sensitive data
  const sensitivePatterns = [
    // Environment files
    /\.env/i,
    /environment/i,
    
    // Secret and credential files
    /secret/i,
    /credential/i,
    /password/i,
    /token/i,
    /key/i,
    /cert/i,
    /\.pem$/i,
    /\.p12$/i,
    /\.pfx$/i,
    /\.crt$/i,
    
    // Configuration files that might contain secrets
    /config.*\.json$/i,
    /config.*\.yaml$/i,
    /config.*\.yml$/i,
    
    // Database files
    /\.db$/i,
    /\.sqlite$/i,
    
    // Private keys and certificates
    /private/i,
    /\.rsa$/i,
    /\.dsa$/i,
  ];

  return lines.filter(line => 
    sensitivePatterns.some(pattern => pattern.test(line))
  );
}

/**
 * Find .gitignore file in the git repository root
 */
export async function findGitignoreFile(startDir: string = process.cwd()): Promise<string | null> {
  try {
    const repoRoot = await getRepoRoot(startDir);
    if (!repoRoot) {
      return null;
    }
    
    const gitignorePath = path.join(repoRoot, '.gitignore');
    if (existsSync(gitignorePath)) {
      return gitignorePath;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Find .ailock file in current directory or parent directories
 */
export async function findAilockFile(startDir: string = process.cwd()): Promise<string | null> {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const ailockPath = path.join(currentDir, '.ailock');
    if (existsSync(ailockPath)) {
      return ailockPath;
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

export interface LoadConfigOptions {
  includeGitignored?: boolean;
}

/**
 * Load and parse .ailock configuration
 */
export async function loadConfig(startDir?: string, options?: LoadConfigOptions): Promise<AilockConfig> {
  const ailockPath = await findAilockFile(startDir);
  const workingDir = startDir || process.cwd();
  
  // Load gitignore patterns if requested
  let gitIgnorePatterns: string[] = [];
  if (options?.includeGitignored) {
    const gitignorePath = await findGitignoreFile(workingDir);
    if (gitignorePath) {
      try {
        const gitignoreContent = await readFile(gitignorePath, 'utf-8');
        gitIgnorePatterns = parseGitignoreContent(gitignoreContent);
      } catch (error) {
        // Silently ignore gitignore parsing errors
        console.warn(`Warning: Could not parse .gitignore file: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  
  if (!ailockPath) {
    // Return default configuration if no .ailock file found
    const defaultPatterns = ['.env', '.env.*', '**/*.key', '**/*.pem', '**/secrets.json'];
    const allPatterns = options?.includeGitignored 
      ? [...defaultPatterns, ...gitIgnorePatterns]
      : defaultPatterns;
      
    return {
      patterns: [...new Set(allPatterns)], // Remove duplicates
      rootDir: workingDir,
      includeGitignored: options?.includeGitignored,
      gitIgnorePatterns: options?.includeGitignored ? gitIgnorePatterns : []
    };
  }

  const content = await readFile(ailockPath, 'utf-8');
  const ailockPatterns = parseAilockContent(content);
  const rootDir = path.dirname(ailockPath);
  
  // Merge .ailock patterns with gitignore patterns if requested
  const allPatterns = options?.includeGitignored 
    ? [...ailockPatterns, ...gitIgnorePatterns]
    : ailockPatterns;

  return {
    patterns: [...new Set(allPatterns)], // Remove duplicates
    rootDir,
    includeGitignored: options?.includeGitignored,
    gitIgnorePatterns: options?.includeGitignored ? gitIgnorePatterns : []
  };
}

/**
 * Find all files matching the protection patterns
 */
export async function findProtectedFiles(config: AilockConfig): Promise<string[]> {
  if (config.patterns.length === 0) {
    return [];
  }

  try {
    const files = await glob(config.patterns, {
      cwd: config.rootDir,
      absolute: true,
      ignore: ['node_modules/**', '.git/**', ...(config.ignore || [])],
      onlyFiles: true,
      followSymbolicLinks: false
    });

    return files;
  } catch (error) {
    throw new Error(`Failed to find protected files: ${error instanceof Error ? error.message : String(error)}`);
  }
}