import { constants, access, chmod, stat } from 'fs/promises';
import { platform } from 'os';
import path from 'path';
import { SecureCommandExecutor } from '../security/CommandExecutor.js';
import { SecurePathValidator } from '../security/PathValidator.js';
import { AtomicFileManager } from '../security/AtomicFileManager.js';
import { SecureErrorHandler } from '../security/ErrorHandler.js';

export enum Platform {
  UNIX = 'unix',
  WINDOWS = 'windows',
  WSL = 'wsl'
}

export interface PlatformAdapter {
  lockFile(filePath: string): Promise<void>;
  unlockFile(filePath: string): Promise<void>;
  isLocked(filePath: string): Promise<boolean>;
  supportsImmutable(): boolean;
  validateSecurity(filePath: string): Promise<boolean>;
  getSecurityInfo(filePath: string): Promise<SecurityInfo>;
}

export interface SecurityInfo {
  isReadOnly: boolean;
  isImmutable: boolean;
  permissions: string;
  platform: Platform;
  lastModified: Date;
  checksum?: string;
}

/**
 * Detect the current platform
 */
export function detectPlatform(): Platform {
  const os = platform();
  
  if (os === 'win32') {
    return Platform.WINDOWS;
  }
  
  // Check if we're in WSL
  if (process.env.WSL_DISTRO_NAME || process.env.WSLENV) {
    return Platform.WSL;
  }
  
  return Platform.UNIX;
}

/**
 * Unix/Linux/macOS platform adapter with enhanced security
 */
class UnixAdapter implements PlatformAdapter {
  private commandExecutor: SecureCommandExecutor;
  private pathValidator: SecurePathValidator;
  private atomicManager: AtomicFileManager;
  private errorHandler: SecureErrorHandler;

  constructor() {
    this.commandExecutor = new SecureCommandExecutor(['chattr', 'chmod', 'chflags', 'ls', 'stat']);
    this.pathValidator = new SecurePathValidator();
    this.atomicManager = new AtomicFileManager();
    this.errorHandler = new SecureErrorHandler({ failSafe: true });
  }
  async lockFile(filePath: string): Promise<void> {
    try {
      // Validate and sanitize file path
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      await this.pathValidator.validatePathType(safePath, 'file');
      
      // Acquire atomic lock for the operation
      const lockId = await this.atomicManager.acquireLock(safePath, {
        timeout: 10000,
        checkIntegrity: true,
        backup: true
      });

      try {
        // Make file read-only for all users using native chmod
        await chmod(safePath, 0o444);
        
        // Try to set immutable bit on Linux using secure command execution
        if (platform() === 'linux') {
          try {
            const result = await this.commandExecutor.executeCommand('chattr', ['+i', safePath], {
              timeout: 5000
            });
            
            if (result.exitCode !== 0) {
              console.warn(`Warning: chattr returned non-zero exit code: ${result.stderr}`);
            }
          } catch (error) {
            // Ignore chattr errors - not all filesystems support it
            console.warn(`Warning: Could not set immutable bit on ${safePath}: ${error}`);
          }
        }
        
        // Set extended attributes on macOS
        if (platform() === 'darwin') {
          try {
            await this.commandExecutor.executeCommand('chflags', ['uchg', safePath], {
              timeout: 5000
            });
          } catch (error) {
            console.warn(`Warning: Could not set chflags on ${safePath}: ${error}`);
          }
        }
      } finally {
        await this.atomicManager.releaseLock(safePath, lockId);
      }
    } catch (error) {
      this.errorHandler.handleAndThrow(error, { 
        operation: 'lockFile', 
        filePath, 
        platform: 'unix' 
      });
    }
  }

  async unlockFile(filePath: string): Promise<void> {
    try {
      // Validate and sanitize file path
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      await this.pathValidator.validatePathType(safePath, 'file');
      
      // Acquire atomic lock for the operation
      const lockId = await this.atomicManager.acquireLock(safePath, {
        timeout: 10000,
        checkIntegrity: true
      });

      try {
        // Try to remove immutable bit on Linux first
        if (platform() === 'linux') {
          try {
            await this.commandExecutor.executeCommand('chattr', ['-i', safePath], {
              timeout: 5000
            });
          } catch (error) {
            // Ignore chattr errors - may not be set or filesystem doesn't support
            console.warn(`Warning: Could not remove immutable bit: ${error}`);
          }
        }
        
        // Remove chflags on macOS
        if (platform() === 'darwin') {
          try {
            await this.commandExecutor.executeCommand('chflags', ['nouchg', safePath], {
              timeout: 5000
            });
          } catch (error) {
            console.warn(`Warning: Could not remove chflags: ${error}`);
          }
        }
        
        // Restore write permissions for owner using native chmod
        await chmod(safePath, 0o644);
      } finally {
        await this.atomicManager.releaseLock(safePath, lockId);
      }
    } catch (error) {
      this.errorHandler.handleAndThrow(error, { 
        operation: 'unlockFile', 
        filePath, 
        platform: 'unix' 
      });
    }
  }

  async isLocked(filePath: string): Promise<boolean> {
    try {
      // Validate file path
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      
      // Check if file is currently locked by atomic manager
      if (await this.atomicManager.isFileLocked(safePath)) {
        return true;
      }
      
      // Check write access
      await access(safePath, constants.W_OK);
      return false; // If no error, file is writable
    } catch {
      return true; // If error, file is not writable (locked)
    }
  }

  supportsImmutable(): boolean {
    return platform() === 'linux' || platform() === 'darwin';
  }

  async validateSecurity(filePath: string): Promise<boolean> {
    try {
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      const stats = await stat(safePath);
      
      // Check if file has proper read-only permissions
      const hasWritePermission = (stats.mode & 0o200) !== 0;
      return !hasWritePermission;
    } catch {
      return false;
    }
  }

  async getSecurityInfo(filePath: string): Promise<SecurityInfo> {
    try {
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      const stats = await stat(safePath);
      
      const isReadOnly = (stats.mode & 0o200) === 0;
      let isImmutable = false;
      
      // Check immutable status on Linux
      if (platform() === 'linux') {
        try {
          const result = await this.commandExecutor.executeCommand('lsattr', [safePath], {
            timeout: 3000
          });
          isImmutable = result.stdout.includes('i');
        } catch {
          // Ignore lsattr errors
        }
      }
      
      // Check chflags on macOS
      if (platform() === 'darwin') {
        try {
          const result = await this.commandExecutor.executeCommand('ls', ['-lO', safePath], {
            timeout: 3000
          });
          isImmutable = result.stdout.includes('uchg');
        } catch {
          // Ignore ls errors
        }
      }
      
      return {
        isReadOnly,
        isImmutable,
        permissions: (stats.mode & parseInt('777', 8)).toString(8),
        platform: Platform.UNIX,
        lastModified: stats.mtime
      };
    } catch (error) {
      throw new Error(`Failed to get security info: ${error}`);
    }
  }
}

/**
 * Windows platform adapter with enhanced security
 */
class WindowsAdapter implements PlatformAdapter {
  private commandExecutor: SecureCommandExecutor;
  private pathValidator: SecurePathValidator;
  private atomicManager: AtomicFileManager;

  constructor() {
    this.commandExecutor = new SecureCommandExecutor(['attrib', 'icacls', 'dir']);
    this.pathValidator = new SecurePathValidator();
    this.atomicManager = new AtomicFileManager();
  }

  async lockFile(filePath: string): Promise<void> {
    try {
      // Validate and sanitize file path
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      await this.pathValidator.validatePathType(safePath, 'file');
      
      // Acquire atomic lock for the operation
      const lockId = await this.atomicManager.acquireLock(safePath, {
        timeout: 10000,
        checkIntegrity: true,
        backup: true
      });

      try {
        // Use attrib command to set read-only with secure execution
        await this.commandExecutor.executeCommand('attrib', ['+R', safePath], {
          timeout: 5000
        });
        
        // Use icacls for more advanced ACL protection (optional)
        try {
          await this.commandExecutor.executeCommand('icacls', [
            safePath,
            '/inheritance:r',
            '/grant:r',
            '*S-1-1-0:(R)'
          ], {
            timeout: 10000
          });
        } catch (error) {
          console.warn(`Warning: Could not set advanced ACL on ${safePath}: ${error}`);
        }
      } finally {
        await this.atomicManager.releaseLock(safePath, lockId);
      }
    } catch (error) {
      throw new Error(`Failed to lock file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async unlockFile(filePath: string): Promise<void> {
    try {
      // Validate and sanitize file path
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      await this.pathValidator.validatePathType(safePath, 'file');
      
      // Acquire atomic lock for the operation
      const lockId = await this.atomicManager.acquireLock(safePath, {
        timeout: 10000,
        checkIntegrity: true
      });

      try {
        // Reset ACL first (if it was set)
        try {
          await this.commandExecutor.executeCommand('icacls', [safePath, '/reset'], {
            timeout: 10000
          });
        } catch (error) {
          console.warn(`Warning: Could not reset ACL: ${error}`);
        }
        
        // Remove read-only attribute with secure execution
        await this.commandExecutor.executeCommand('attrib', ['-R', safePath], {
          timeout: 5000
        });
      } finally {
        await this.atomicManager.releaseLock(safePath, lockId);
      }
    } catch (error) {
      throw new Error(`Failed to unlock file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async isLocked(filePath: string): Promise<boolean> {
    try {
      // Validate file path
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      
      // Check if file is currently locked by atomic manager
      if (await this.atomicManager.isFileLocked(safePath)) {
        return true;
      }
      
      // Check write access
      await access(safePath, constants.W_OK);
      return false; // If no error, file is writable
    } catch {
      return true; // If error, file is not writable (locked)
    }
  }

  supportsImmutable(): boolean {
    return false; // Windows doesn't have immutable bits like Linux
  }

  async validateSecurity(filePath: string): Promise<boolean> {
    try {
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      const stats = await stat(safePath);
      
      // Check if file has read-only attribute
      const hasWritePermission = (stats.mode & 0o200) !== 0;
      return !hasWritePermission;
    } catch {
      return false;
    }
  }

  async getSecurityInfo(filePath: string): Promise<SecurityInfo> {
    try {
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      const stats = await stat(safePath);
      
      const isReadOnly = (stats.mode & 0o200) === 0;
      
      return {
        isReadOnly,
        isImmutable: false, // Windows doesn't support immutable bits
        permissions: (stats.mode & parseInt('777', 8)).toString(8),
        platform: Platform.WINDOWS,
        lastModified: stats.mtime
      };
    } catch (error) {
      throw new Error(`Failed to get security info: ${error}`);
    }
  }
}

/**
 * WSL (Windows Subsystem for Linux) adapter with intelligent fallback
 */
class WSLAdapter implements PlatformAdapter {
  private unixAdapter = new UnixAdapter();
  private windowsAdapter = new WindowsAdapter();
  private pathValidator = new SecurePathValidator();

  async lockFile(filePath: string): Promise<void> {
    try {
      // Validate file path first
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      await this.pathValidator.validatePathType(safePath, 'file');
      
      // In WSL, try Unix method first, fall back to Windows if needed
      try {
        await this.unixAdapter.lockFile(safePath);
      } catch (error) {
        console.warn(`Unix lock failed, trying Windows method: ${error}`);
        await this.windowsAdapter.lockFile(safePath);
      }
    } catch (error) {
      throw new Error(`Failed to lock file in WSL: ${error}`);
    }
  }

  async unlockFile(filePath: string): Promise<void> {
    try {
      // Validate file path first
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      
      // Try both methods to ensure unlock
      let unixSuccess = false;
      try {
        await this.unixAdapter.unlockFile(safePath);
        unixSuccess = true;
      } catch (error) {
        console.warn(`Unix unlock failed: ${error}`);
      }
      
      if (!unixSuccess) {
        try {
          await this.windowsAdapter.unlockFile(safePath);
        } catch (error) {
          throw new Error(`Both Unix and Windows unlock methods failed: ${error}`);
        }
      }
    } catch (error) {
      throw new Error(`Failed to unlock file in WSL: ${error}`);
    }
  }

  async isLocked(filePath: string): Promise<boolean> {
    try {
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      return await this.unixAdapter.isLocked(safePath);
    } catch {
      return false;
    }
  }

  supportsImmutable(): boolean {
    return false; // WSL doesn't reliably support immutable bits
  }

  async validateSecurity(filePath: string): Promise<boolean> {
    try {
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      return await this.unixAdapter.validateSecurity(safePath);
    } catch {
      return false;
    }
  }

  async getSecurityInfo(filePath: string): Promise<SecurityInfo> {
    try {
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      const info = await this.unixAdapter.getSecurityInfo(safePath);
      return {
        ...info,
        platform: Platform.WSL
      };
    } catch (error) {
      throw new Error(`Failed to get security info in WSL: ${error}`);
    }
  }
}

/**
 * Get the appropriate platform adapter
 */
export function getPlatformAdapter(): PlatformAdapter {
  const currentPlatform = detectPlatform();
  
  switch (currentPlatform) {
    case Platform.WINDOWS:
      return new WindowsAdapter();
    case Platform.WSL:
      return new WSLAdapter();
    case Platform.UNIX:
    default:
      return new UnixAdapter();
  }
}