import { glob } from 'glob';
import path from 'path';
import ignore from 'ignore';
import { existsSync, readFileSync } from 'fs';

/**
 * Glob pattern validation and matching for file operations
 */
export class GlobValidator {
  private readonly maxPatternLength = 1024;
  private readonly dangerousPatterns = [
    '/**/*',  // Recursive all files
    '**/**',  // Double recursive
    '/*',     // Root directory
  ];

  /**
   * Validate a glob pattern for safety
   */
  validateGlobPattern(pattern: string): void {
    if (!pattern || typeof pattern !== 'string') {
      throw new Error('Pattern must be a non-empty string');
    }

    // Check pattern length
    if (pattern.length > this.maxPatternLength) {
      throw new Error(`Pattern exceeds maximum length of ${this.maxPatternLength} characters`);
    }

    // Warn about potentially dangerous patterns
    for (const dangerous of this.dangerousPatterns) {
      if (pattern === dangerous || pattern.startsWith(dangerous)) {
        console.warn(`Warning: Pattern '${pattern}' may match a large number of files`);
      }
    }

    // Check for invalid glob characters at the start
    if (pattern.startsWith('!')) {
      throw new Error('Negation patterns are not supported directly');
    }
  }

  /**
   * Find files matching glob patterns
   */
  async findMatchingFiles(
    patterns: string[],
    options: {
      cwd?: string;
      ignore?: string[];
      absolute?: boolean;
    } = {}
  ): Promise<string[]> {
    const { cwd = process.cwd(), ignore: ignorePatterns = [], absolute = true } = options;
    const matchedFiles = new Set<string>();

    for (const pattern of patterns) {
      this.validateGlobPattern(pattern);
      
      try {
        const matches = await glob(pattern, {
          cwd,
          absolute,
          dot: true,
          ignore: ignorePatterns,
          nodir: true,
        });
        
        for (const match of matches) {
          matchedFiles.add(match);
        }
      } catch (error) {
        console.warn(`Failed to match pattern '${pattern}': ${error}`);
      }
    }

    return Array.from(matchedFiles);
  }

  /**
   * Create an ignore instance from gitignore-style patterns
   */
  createIgnoreFilter(patterns: string[]): (path: string) => boolean {
    const ig = ignore();
    
    // Add patterns
    for (const pattern of patterns) {
      if (pattern && !pattern.startsWith('#')) {
        ig.add(pattern.trim());
      }
    }

    return (filePath: string) => !ig.ignores(filePath);
  }

  /**
   * Load patterns from a gitignore-style file
   */
  loadPatternsFromFile(filePath: string): string[] {
    if (!existsSync(filePath)) {
      return [];
    }

    try {
      const content = readFileSync(filePath, 'utf-8');
      return content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'));
    } catch (error) {
      console.warn(`Failed to load patterns from ${filePath}: ${error}`);
      return [];
    }
  }

  /**
   * Check if a path matches any of the given patterns
   */
  matchesPattern(filePath: string, patterns: string[]): boolean {
    const relativePath = path.relative(process.cwd(), filePath);
    
    for (const pattern of patterns) {
      // Simple pattern matching (can be enhanced with minimatch if needed)
      if (pattern.includes('*')) {
        // Convert glob to regex (simplified)
        const regexPattern = pattern
          .replace(/\./g, '\\.')
          .replace(/\*/g, '.*')
          .replace(/\?/g, '.');
        
        const regex = new RegExp(`^${regexPattern}$`);
        if (regex.test(relativePath)) {
          return true;
        }
      } else {
        // Exact match or directory prefix
        if (relativePath === pattern || relativePath.startsWith(pattern + path.sep)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Expand glob patterns to actual file paths
   */
  async expandPatterns(patterns: string[], cwd?: string): Promise<string[]> {
    const expanded: string[] = [];
    
    for (const pattern of patterns) {
      // Check if it's a glob pattern
      if (pattern.includes('*') || pattern.includes('?') || pattern.includes('[')) {
        const matches = await this.findMatchingFiles([pattern], { cwd });
        expanded.push(...matches);
      } else {
        // It's a direct path
        const absolutePath = path.isAbsolute(pattern) ? pattern : path.join(cwd || process.cwd(), pattern);
        if (existsSync(absolutePath)) {
          expanded.push(absolutePath);
        }
      }
    }

    return expanded;
  }
}