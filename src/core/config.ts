import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import glob from 'fast-glob';

export interface AilockConfig {
  patterns: string[];
  ignore?: string[];
  rootDir: string;
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

/**
 * Load and parse .ailock configuration
 */
export async function loadConfig(startDir?: string): Promise<AilockConfig> {
  const ailockPath = await findAilockFile(startDir);
  
  if (!ailockPath) {
    // Return default configuration if no .ailock file found
    return {
      patterns: ['.env', '.env.*', '**/*.key', '**/*.pem', '**/secrets.json'],
      rootDir: startDir || process.cwd()
    };
  }

  const content = await readFile(ailockPath, 'utf-8');
  const patterns = parseAilockContent(content);
  const rootDir = path.dirname(ailockPath);

  return {
    patterns,
    rootDir
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