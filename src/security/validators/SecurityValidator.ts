import path from 'path';
import isPathInside from 'is-path-inside';
import { tmpdir } from 'os';

/**
 * Security-focused path validation to prevent directory traversal
 * and other path-based security vulnerabilities
 */
export class SecurityValidator {
  private readonly allowedRootDirs: string[];
  private readonly maxPathLength = 4096;
  private readonly maxComponentLength = 255;

  constructor(allowedRootDirs: string[] = []) {
    this.allowedRootDirs = allowedRootDirs.map(dir => path.resolve(dir));
    
    // Always allow current working directory and temp directories
    const cwdPath = process.cwd();
    const tmpDir = tmpdir();
    
    if (!this.allowedRootDirs.includes(cwdPath)) {
      this.allowedRootDirs.push(cwdPath);
    }
    
    if (!this.allowedRootDirs.includes(tmpDir)) {
      this.allowedRootDirs.push(tmpDir);
    }
    
    // Allow common temporary directories
    const commonTempDirs = ['/tmp', '/var/tmp', process.env.TMPDIR, process.env.TEMP].filter(Boolean);
    for (const tempDir of commonTempDirs) {
      const resolvedTemp = path.resolve(tempDir!);
      if (!this.allowedRootDirs.includes(resolvedTemp)) {
        this.allowedRootDirs.push(resolvedTemp);
      }
    }
  }

  /**
   * Validate path security to prevent directory traversal attacks
   */
  validatePathSecurity(inputPath: string): void {
    if (!inputPath || typeof inputPath !== 'string') {
      throw new Error('Invalid path: path must be a non-empty string');
    }

    // Check for null bytes
    if (inputPath.includes('\0')) {
      throw new Error('Path contains null bytes');
    }

    // Check path length
    if (inputPath.length > this.maxPathLength) {
      throw new Error(`Path exceeds maximum length of ${this.maxPathLength} characters`);
    }

    // Check for suspicious patterns
    const suspiciousPatterns = [
      /\.\.\/\.\.\/\.\.\//, // Multiple directory traversals
      /[<>:"|?*]/, // Invalid characters on Windows
      /\\\\/, // UNC paths
      /^~/, // Home directory expansion
    ];

    for (const pattern of suspiciousPatterns) {
      if (pattern.test(inputPath)) {
        throw new Error(`Path contains suspicious pattern: ${pattern}`);
      }
    }

    // Validate each path component
    const components = inputPath.split(path.sep).filter(Boolean);
    for (const component of components) {
      this.validatePathComponent(component);
    }
  }

  /**
   * Validate individual path component
   */
  private validatePathComponent(component: string): void {
    // Check component length
    if (component.length > this.maxComponentLength) {
      throw new Error(`Path component exceeds maximum length of ${this.maxComponentLength} characters`);
    }

    // Check for directory traversal
    if (component === '..' || component === '.') {
      return; // These are allowed but will be resolved later
    }

    // Check for hidden files (optional - could be configurable)
    if (component.startsWith('.') && component !== '.' && component !== '..') {
      // Hidden files are allowed but logged for awareness
      console.debug(`Path contains hidden file/directory: ${component}`);
    }

    // Check for Windows reserved names
    if (this.isWindowsReservedName(component)) {
      throw new Error(`Path component is a Windows reserved name: ${component}`);
    }

    // Check for control characters
    if (/[\x00-\x1f\x7f]/.test(component)) {
      throw new Error('Path component contains control characters');
    }
  }

  /**
   * Check if path is within allowed directories
   */
  isPathAllowed(resolvedPath: string): boolean {
    // If no specific root dirs are configured, allow all
    if (this.allowedRootDirs.length === 0) {
      return true;
    }

    // Check if path is inside any allowed directory
    for (const allowedDir of this.allowedRootDirs) {
      if (isPathInside(resolvedPath, allowedDir) || resolvedPath === allowedDir) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if filename is a Windows reserved name
   */
  private isWindowsReservedName(filename: string): boolean {
    const reserved = [
      'CON', 'PRN', 'AUX', 'NUL',
      'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
      'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ];

    const nameWithoutExt = filename.split('.')[0].toUpperCase();
    return reserved.includes(nameWithoutExt);
  }

  /**
   * Get allowed root directories
   */
  getAllowedRootDirs(): string[] {
    return [...this.allowedRootDirs];
  }
}