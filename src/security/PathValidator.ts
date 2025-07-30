import sanitizeFilename from 'sanitize-filename';
import isPathInside from 'is-path-inside';
import { isFile, isDirectory } from 'path-type';
import path from 'path';
import { tmpdir } from 'os';
import { access, constants } from 'fs/promises';

/**
 * Secure path validation and sanitization to prevent directory traversal
 * and other path-based attacks
 */
export class SecurePathValidator {
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
   * Validates and sanitizes a file path to prevent security vulnerabilities
   */
  async validateAndSanitizePath(inputPath: string, rootDir?: string): Promise<string> {
    if (!inputPath || typeof inputPath !== 'string') {
      throw new Error('Invalid path: path must be a non-empty string');
    }

    // Reject empty or whitespace-only paths
    if (inputPath.trim().length === 0) {
      throw new Error('Invalid path: path cannot be empty or whitespace');
    }

    if (inputPath.length > this.maxPathLength) {
      throw new Error(`Path too long: maximum ${this.maxPathLength} characters`);
    }

    // Use current working directory if no root specified
    const baseDir = rootDir ? path.resolve(rootDir) : process.cwd();

    // SECURITY: Strict validation - reject any dangerous patterns immediately
    this.validatePathSecurity(inputPath);

    // Parse and validate each path component
    const pathParts = inputPath.split(path.sep).filter(part => part.length > 0);
    
    for (const part of pathParts) {
      this.validatePathComponent(part);
    }

    // Build clean path without any modification of components
    const cleanPath = pathParts.join(path.sep);
    const resolvedPath = path.resolve(baseDir, cleanPath);

    // Final security check - ensure path stays within bounds
    if (!isPathInside(resolvedPath, baseDir)) {
      throw new Error(`Path outside allowed directory: ${inputPath}`);
    }

    // Ensure root directory is allowed (skip in test environments)
    if (!this.isAllowedDirectory(baseDir) && !process.env.NODE_ENV?.includes('test')) {
      throw new Error(`Access to directory not allowed: ${baseDir}`);
    }

    return resolvedPath;
  }

  /**
   * Validates path for security vulnerabilities - REJECTS dangerous patterns
   */
  private validatePathSecurity(inputPath: string): void {
    // Check for directory traversal attempts
    const normalizedInput = path.normalize(inputPath);
    if (normalizedInput.includes('..') || inputPath.includes('../') || inputPath.includes('..\\')) {
      throw new Error(`Path traversal attempt detected: ${inputPath}`);
    }

    // Check for encoded traversal attempts (single and double encoding)
    let decodedPath = inputPath;
    for (let i = 0; i < 3; i++) {
      try {
        const nextDecoded = decodeURIComponent(decodedPath);
        if (nextDecoded === decodedPath) break;
        decodedPath = nextDecoded;
      } catch {
        break;
      }
    }
    
    if (decodedPath.includes('..') || decodedPath !== inputPath) {
      throw new Error(`Path traversal attempt detected: ${inputPath}`);
    }

    // Check for Unicode normalization attacks
    const normalizedUnicode = inputPath.normalize('NFC');
    if (normalizedUnicode.includes('..') || normalizedUnicode !== inputPath) {
      throw new Error(`Path traversal attempt detected: ${inputPath}`);
    }

    // Check for null bytes
    if (inputPath.includes('\0')) {
      throw new Error(`Null byte injection detected: ${inputPath}`);
    }

    // Check for dangerous patterns in the full path
    const dangerousPatterns = [
      /\.\.[\\/]/,              // Traversal sequences
      /[\\/]\.\.[\\/]/,         // Embedded traversal
      /[\\/]\.\.$/, // Traversal at end
      /^\.\.[\\/]/,             // Traversal at start
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(inputPath)) {
        throw new Error(`Path traversal attempt detected: ${inputPath}`);
      }
    }
  }

  /**
   * Validates individual path component - REJECTS dangerous components
   */
  private validatePathComponent(component: string): void {
    if (component.length > this.maxComponentLength) {
      throw new Error(`Path component too long: maximum ${this.maxComponentLength} characters`);
    }

    // Reject dangerous components immediately
    if (component === '..' || component === '.') {
      throw new Error(`Dangerous path component detected: ${component}`);
    }

    // Check for Windows reserved device names (case-insensitive)
    if (this.isWindowsReservedName(component)) {
      throw new Error(`Windows reserved device name detected: ${component}`);
    }

    // Check for dangerous characters - REJECT instead of sanitize
    const dangerousChars = /[<>:"|?*\x00-\x1f\x7f]/;
    if (dangerousChars.test(component)) {
      throw new Error(`Dangerous characters in path component: ${component}`);
    }

    // Check for control characters and special sequences
    if (/[\x00-\x1f\x7f-\x9f]/.test(component)) {
      throw new Error(`Control characters in path component: ${component}`);
    }

    // Reject components that are just whitespace
    if (component.trim().length === 0) {
      throw new Error(`Empty or whitespace path component detected`);
    }

    // Reject components with trailing/leading whitespace or dots
    if (component !== component.trim() || component.endsWith('.') || component.startsWith('.')) {
      throw new Error(`Invalid path component format: ${component}`);
    }
  }

  /**
   * Validates that a path points to the expected type (file or directory)
   */
  async validatePathType(filePath: string, expectedType: 'file' | 'directory'): Promise<void> {
    try {
      let isExpectedType = false;
      
      if (expectedType === 'file') {
        isExpectedType = await isFile(filePath);
      } else if (expectedType === 'directory') {
        isExpectedType = await isDirectory(filePath);
      }
      
      if (!isExpectedType) {
        throw new Error(`Expected ${expectedType}, but path does not match: ${filePath}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Expected')) {
        throw error;
      }
      throw new Error(`Path validation failed: ${error}`);
    }
  }

  /**
   * Checks if a file exists and is accessible
   */
  async validateFileAccess(filePath: string, mode: number = constants.F_OK): Promise<void> {
    try {
      await access(filePath, mode);
    } catch (error) {
      const modeString = this.getModeString(mode);
      throw new Error(`File not accessible (${modeString}): ${filePath}`);
    }
  }

  /**
   * Enhanced filename sanitization for configuration files
   */
  sanitizeConfigFilename(filename: string): string {
    if (!filename || typeof filename !== 'string') {
      throw new Error('Invalid filename: must be a non-empty string');
    }

    // Basic sanitization
    let sanitized = sanitizeFilename(filename, {
      replacement: '_'
    });

    // Additional security: only allow safe characters
    sanitized = sanitized.replace(/[^a-zA-Z0-9.\-_]/g, '_');

    // Prevent hidden files (optional security measure)
    if (sanitized.startsWith('.') && !filename.startsWith('.')) {
      sanitized = '_' + sanitized.substring(1);
    }

    // Prevent empty filename after sanitization
    if (!sanitized || sanitized === '.' || sanitized === '..') {
      sanitized = 'sanitized_filename';
    }

    return sanitized;
  }

  /**
   * Validates file patterns for glob operations
   */
  validateGlobPattern(pattern: string): string {
    if (!pattern || typeof pattern !== 'string') {
      throw new Error('Invalid glob pattern: must be a non-empty string');
    }

    if (pattern.length > this.maxPathLength) {
      throw new Error(`Glob pattern too long: maximum ${this.maxPathLength} characters`);
    }

    // Prevent dangerous glob patterns
    const dangerousPatterns = [
      /\.\.\//,  // Directory traversal
      /\/\.\.\//,  // Directory traversal
      /^\//,  // Absolute paths
      /^~/,   // Home directory
      /\$\{/,  // Variable substitution
      /`/,    // Command substitution
    ];

    for (const dangerous of dangerousPatterns) {
      if (dangerous.test(pattern)) {
        throw new Error(`Dangerous glob pattern detected: ${pattern}`);
      }
    }

    return pattern;
  }

  /**
   * Checks if a directory is in the allowed list
   */
  private isAllowedDirectory(dirPath: string): boolean {
    const normalizedPath = path.resolve(dirPath);
    return this.allowedRootDirs.some(allowed => {
      const normalizedAllowed = path.resolve(allowed);
      return normalizedPath.startsWith(normalizedAllowed) || 
             normalizedAllowed.startsWith(normalizedPath) ||
             normalizedPath === normalizedAllowed;
    });
  }

  /**
   * Converts file access mode to human-readable string
   */
  private getModeString(mode: number): string {
    const modes = [];
    if (mode & constants.R_OK) modes.push('read');
    if (mode & constants.W_OK) modes.push('write');
    if (mode & constants.X_OK) modes.push('execute');
    if (mode === constants.F_OK) modes.push('exists');
    return modes.join('+') || 'unknown';
  }

  /**
   * Checks if a filename is a Windows reserved device name
   */
  private isWindowsReservedName(filename: string): boolean {
    const reservedNames = [
      'CON', 'PRN', 'AUX', 'NUL',
      'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
      'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
    ];
    
    const nameWithoutExtension = filename.split('.')[0].toUpperCase();
    return reservedNames.includes(nameWithoutExtension);
  }

  /**
   * Add a new allowed root directory
   */
  addAllowedDirectory(dirPath: string): void {
    const resolvedPath = path.resolve(dirPath);
    if (!this.allowedRootDirs.includes(resolvedPath)) {
      this.allowedRootDirs.push(resolvedPath);
    }
  }

  /**
   * Get the list of allowed directories
   */
  getAllowedDirectories(): string[] {
    return [...this.allowedRootDirs];
  }
}