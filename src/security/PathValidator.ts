import path from 'path';
import { SecurityValidator } from './validators/SecurityValidator.js';
import { GlobValidator } from './validators/GlobValidator.js';
import { PathSanitizer } from './validators/PathSanitizer.js';

/**
 * Unified path validation combining security, glob, and sanitization features
 * This is a facade that maintains backward compatibility while delegating to specialized validators
 */
export class SecurePathValidator {
  private readonly securityValidator: SecurityValidator;
  private readonly globValidator: GlobValidator;
  private readonly pathSanitizer: PathSanitizer;

  constructor(allowedRootDirs: string[] = []) {
    this.securityValidator = new SecurityValidator(allowedRootDirs);
    this.globValidator = new GlobValidator();
    this.pathSanitizer = new PathSanitizer();
  }

  /**
   * Validates and sanitizes a file path to prevent security vulnerabilities
   */
  async validateAndSanitizePath(inputPath: string, rootDir?: string): Promise<string> {
    // First sanitize the path
    const sanitized = this.pathSanitizer.sanitizePath(inputPath);
    
    // Then validate security
    this.securityValidator.validatePathSecurity(sanitized);
    
    // Resolve the path
    const resolved = this.pathSanitizer.resolvePath(sanitized, rootDir);
    
    // Check if path is allowed
    if (!this.securityValidator.isPathAllowed(resolved)) {
      throw new Error(`Path outside allowed directory: ${inputPath}`);
    }
    
    return resolved;
  }

  /**
   * Validate path type (file or directory)
   */
  async validatePathType(filePath: string, expectedType: 'file' | 'directory'): Promise<void> {
    await this.pathSanitizer.validatePathType(filePath, expectedType);
  }

  /**
   * Validate file access permissions
   */
  async validateFileAccess(filePath: string, mode?: number): Promise<void> {
    await this.pathSanitizer.validateFileAccess(filePath, mode);
  }

  /**
   * Find files matching glob patterns
   */
  async findMatchingFiles(patterns: string[], options?: any): Promise<string[]> {
    return await this.globValidator.findMatchingFiles(patterns, options);
  }

  /**
   * Check if a path matches any of the given patterns
   */
  matchesPattern(filePath: string, patterns: string[]): boolean {
    return this.globValidator.matchesPattern(filePath, patterns);
  }

  /**
   * Load patterns from a gitignore-style file
   */
  loadPatternsFromFile(filePath: string): string[] {
    return this.globValidator.loadPatternsFromFile(filePath);
  }

  /**
   * Create an ignore filter from patterns
   */
  createIgnoreFilter(patterns: string[]): (path: string) => boolean {
    return this.globValidator.createIgnoreFilter(patterns);
  }

  /**
   * Get allowed root directories
   */
  getAllowedRootDirs(): string[] {
    return this.securityValidator.getAllowedRootDirs();
  }

  /**
   * Parse a path into its components
   */
  parsePath(inputPath: string): any {
    return this.pathSanitizer.parsePath(inputPath);
  }

  /**
   * Join path segments safely
   */
  joinPath(...segments: string[]): string {
    return this.pathSanitizer.joinPath(...segments);
  }

  /**
   * Get relative path between two paths
   */
  getRelativePath(from: string, to: string): string {
    return this.pathSanitizer.getRelativePath(from, to);
  }

  /**
   * Check if a path is absolute
   */
  isAbsolutePath(inputPath: string): boolean {
    return this.pathSanitizer.isAbsolutePath(inputPath);
  }
}