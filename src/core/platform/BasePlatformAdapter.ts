import { access, chmod, stat, constants } from 'fs/promises';
import { SecureCommandExecutor } from '../../security/CommandExecutor.js';
import { SecurePathValidator } from '../../security/PathValidator.js';
import { AtomicFileManager } from '../../security/AtomicFileManager.js';
import { SecureErrorHandler } from '../../security/ErrorHandler.js';
import type { PlatformAdapter, SecurityInfo, Platform } from '../platform.js';

/**
 * Base abstract class for platform-specific file locking adapters
 */
export abstract class BasePlatformAdapter implements PlatformAdapter {
  protected commandExecutor: SecureCommandExecutor;
  protected pathValidator: SecurePathValidator;
  protected fileManager?: AtomicFileManager;
  protected errorHandler: SecureErrorHandler;
  protected abstract platformType: Platform;

  constructor() {
    this.commandExecutor = new SecureCommandExecutor();
    this.pathValidator = new SecurePathValidator();
    this.errorHandler = new SecureErrorHandler();
    // Remove circular dependency - AtomicFileManager should not be created here
    // This will be injected or created when needed to avoid circular references
  }

  /**
   * Lock a file to prevent modifications
   */
  abstract lockFile(filePath: string): Promise<void>;

  /**
   * Unlock a file to allow modifications
   */
  abstract unlockFile(filePath: string): Promise<void>;

  /**
   * Check if a file is locked
   */
  abstract isLocked(filePath: string): Promise<boolean>;

  /**
   * Check if the platform supports immutable file attributes
   */
  abstract supportsImmutable(): boolean;

  /**
   * Validate file security settings
   */
  async validateSecurity(filePath: string): Promise<boolean> {
    try {
      // Validate path security
      // Validate path exists and is accessible
      await this.pathValidator.validateAndSanitizePath(filePath);

      // Check if file exists
      await access(filePath, constants.F_OK);
      
      // Check if file is locked
      const locked = await this.isLocked(filePath);
      return locked;
    } catch {
      return false;
    }
  }

  /**
   * Get security information about a file
   */
  async getSecurityInfo(filePath: string): Promise<SecurityInfo> {
    const stats = await stat(filePath);
    const isReadOnly = (stats.mode & 0o200) === 0;
    const isImmutable = await this.checkImmutable(filePath);
    
    return {
      isReadOnly,
      isImmutable,
      permissions: (stats.mode & parseInt('777', 8)).toString(8),
      platform: this.platformType,
      lastModified: stats.mtime
    };
  }

  /**
   * Check if a file has immutable attributes (platform-specific)
   */
  protected abstract checkImmutable(filePath: string): Promise<boolean>;

  /**
   * Common method to make a file read-only using chmod
   */
  protected async makeReadOnly(filePath: string): Promise<void> {
    const stats = await stat(filePath);
    const newMode = stats.mode & ~0o200; // Remove write permission
    await chmod(filePath, newMode);
  }

  /**
   * Common method to make a file writable using chmod
   */
  protected async makeWritable(filePath: string): Promise<void> {
    const stats = await stat(filePath);
    const newMode = stats.mode | 0o200; // Add write permission
    await chmod(filePath, newMode);
  }

  /**
   * Common method to check if a file is read-only
   */
  protected async isReadOnly(filePath: string): Promise<boolean> {
    try {
      const stats = await stat(filePath);
      return (stats.mode & 0o200) === 0;
    } catch {
      return false;
    }
  }

  /**
   * Verify file access permissions
   */
  protected async verifyAccess(filePath: string, mode: number): Promise<boolean> {
    try {
      await access(filePath, mode);
      return true;
    } catch {
      return false;
    }
  }
}