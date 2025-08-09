import path from 'path';
import sanitizeFilename from 'sanitize-filename';
import { isFile, isDirectory } from 'path-type';
import { access, constants } from 'fs/promises';

/**
 * Path sanitization and normalization utilities
 */
export class PathSanitizer {
  /**
   * Sanitize and normalize a file path
   */
  sanitizePath(inputPath: string): string {
    if (!inputPath || typeof inputPath !== 'string') {
      throw new Error('Path must be a non-empty string');
    }

    // Trim whitespace
    let sanitized = inputPath.trim();

    // Handle empty path after trimming
    if (!sanitized) {
      throw new Error('Path cannot be empty or whitespace only');
    }

    // Normalize slashes (convert backslashes to forward slashes)
    sanitized = sanitized.replace(/\\/g, '/');

    // Remove duplicate slashes
    sanitized = sanitized.replace(/\/+/g, '/');

    // Remove trailing slashes (except for root)
    if (sanitized.length > 1 && sanitized.endsWith('/')) {
      sanitized = sanitized.slice(0, -1);
    }

    return sanitized;
  }

  /**
   * Sanitize a filename (just the filename, not the full path)
   */
  sanitizeFilename(filename: string): string {
    // Use sanitize-filename library for comprehensive sanitization
    const sanitized = sanitizeFilename(filename);
    
    if (!sanitized) {
      throw new Error('Filename becomes empty after sanitization');
    }

    return sanitized;
  }

  /**
   * Resolve and normalize a path
   */
  resolvePath(inputPath: string, basePath?: string): string {
    const sanitized = this.sanitizePath(inputPath);
    
    // Resolve relative to base path if provided
    if (basePath) {
      return path.resolve(basePath, sanitized);
    }
    
    // Otherwise resolve relative to current working directory
    return path.resolve(sanitized);
  }

  /**
   * Get the canonical path (resolve symlinks)
   */
  async getCanonicalPath(inputPath: string): Promise<string> {
    const resolved = this.resolvePath(inputPath);
    
    try {
      // Use realpath to resolve symlinks
      const { realpath } = await import('fs/promises');
      return await realpath(resolved);
    } catch (error) {
      // If file doesn't exist, return the resolved path
      return resolved;
    }
  }

  /**
   * Validate path type (file or directory)
   */
  async validatePathType(filePath: string, expectedType: 'file' | 'directory'): Promise<void> {
    const resolvedPath = this.resolvePath(filePath);
    
    try {
      await access(resolvedPath, constants.F_OK);
    } catch {
      throw new Error(`Path does not exist: ${resolvedPath}`);
    }

    if (expectedType === 'file') {
      const isFileType = await isFile(resolvedPath);
      if (!isFileType) {
        throw new Error(`Expected file but got directory or other: ${resolvedPath}`);
      }
    } else if (expectedType === 'directory') {
      const isDirType = await isDirectory(resolvedPath);
      if (!isDirType) {
        throw new Error(`Expected directory but got file or other: ${resolvedPath}`);
      }
    }
  }

  /**
   * Validate file access permissions
   */
  async validateFileAccess(filePath: string, mode: number = constants.F_OK): Promise<void> {
    const resolvedPath = this.resolvePath(filePath);
    
    try {
      await access(resolvedPath, mode);
    } catch (error) {
      const modeString = this.getModeString(mode);
      throw new Error(`Cannot access file with ${modeString} permission: ${resolvedPath}`);
    }
  }

  /**
   * Get human-readable permission string
   */
  private getModeString(mode: number): string {
    const modes: string[] = [];
    if (mode & constants.F_OK) modes.push('existence');
    if (mode & constants.R_OK) modes.push('read');
    if (mode & constants.W_OK) modes.push('write');
    if (mode & constants.X_OK) modes.push('execute');
    return modes.join(', ') || 'unknown';
  }

  /**
   * Extract directory and filename from a path
   */
  parsePath(inputPath: string): { dir: string; name: string; base: string; ext: string } {
    const sanitized = this.sanitizePath(inputPath);
    return path.parse(sanitized);
  }

  /**
   * Join path segments safely
   */
  joinPath(...segments: string[]): string {
    // Sanitize each segment
    const sanitizedSegments = segments.map(seg => this.sanitizePath(seg));
    return path.join(...sanitizedSegments);
  }

  /**
   * Get relative path between two paths
   */
  getRelativePath(from: string, to: string): string {
    const fromResolved = this.resolvePath(from);
    const toResolved = this.resolvePath(to);
    return path.relative(fromResolved, toResolved);
  }

  /**
   * Check if a path is absolute
   */
  isAbsolutePath(inputPath: string): boolean {
    const sanitized = this.sanitizePath(inputPath);
    return path.isAbsolute(sanitized);
  }
}