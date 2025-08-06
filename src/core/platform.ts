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
    this.commandExecutor = new SecureCommandExecutor(['chattr', 'chmod', 'chflags', 'ls', 'stat', 'sudo', 'lsattr']);
    this.pathValidator = new SecurePathValidator();
    this.atomicManager = new AtomicFileManager();
    this.errorHandler = new SecureErrorHandler({ failSafe: true });
  }
  async lockFile(filePath: string): Promise<void> {
    try {
      // Validate and sanitize file path
      const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
      await this.pathValidator.validatePathType(safePath, 'file');
      
      // Check if already locked to avoid errors
      if (await this.isLocked(filePath)) {
        return; // Already locked, nothing to do
      }
      
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
        // Note: chattr requires root privileges, so we'll try but not warn on failure
        if (platform() === 'linux') {
          try {
            // Check if we have sudo privileges without password (common in CI/CD)
            const sudoCheck = await this.commandExecutor.executeCommand('sudo', ['-n', 'true'], {
              timeout: 1000
            }).catch(() => ({ exitCode: 1 }));
            
            if (sudoCheck.exitCode === 0) {
              // We have passwordless sudo, use it
              await this.commandExecutor.executeCommand('sudo', ['chattr', '+i', safePath], {
                timeout: 5000
              });
            } else {
              // Try without sudo (will likely fail but won't show warning)
              await this.commandExecutor.executeCommand('chattr', ['+i', safePath], {
                timeout: 5000
              }).catch(() => {
                // Silently ignore - chattr requires root and that's OK
              });
            }
          } catch {
            // Silently ignore all chattr errors - file is still protected via chmod
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
    const maxRetries = 3;
    const retryDelay = 1000; // 1 second
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.attemptUnlockFile(filePath);
        return; // Success - exit retry loop
      } catch (error) {
        if (attempt === maxRetries) {
          // Final attempt failed - provide detailed diagnostics
          await this.handleUnlockFailure(filePath, error);
        } else {
          console.warn(`Unlock attempt ${attempt}/${maxRetries} failed, retrying in ${retryDelay}ms: ${error}`);
          await this.sleep(retryDelay);
        }
      }
    }
  }

  private async attemptUnlockFile(filePath: string): Promise<void> {
    // Validate and sanitize file path
    const safePath = await this.pathValidator.validateAndSanitizePath(filePath);
    await this.pathValidator.validatePathType(safePath, 'file');
    
    // Acquire atomic lock for the operation
    const lockId = await this.atomicManager.acquireLock(safePath, {
      timeout: 10000,
      checkIntegrity: true
    });

    try {
      // Step 1: Remove platform-specific flags first (order matters!)
      await this.removePlatformFlags(safePath);
      
      // Step 2: Brief delay to ensure flags are cleared
      await this.sleep(100);
      
      // Step 3: Restore write permissions
      await chmod(safePath, 0o644);
      
      // Step 4: Verify unlock was successful
      await this.verifyUnlockSuccess(safePath);
      
    } finally {
      await this.atomicManager.releaseLock(safePath, lockId);
    }
  }

  private async removePlatformFlags(safePath: string): Promise<void> {
    if (platform() === 'linux') {
      try {
        // Check if file has immutable flag set
        const lsattrResult = await this.commandExecutor.executeCommand('lsattr', [safePath], {
          timeout: 3000
        }).catch(() => ({ stdout: '' }));
        
        if (lsattrResult.stdout.includes('i')) {
          // Immutable flag is set, try to remove it
          // First try with sudo if available
          const sudoCheck = await this.commandExecutor.executeCommand('sudo', ['-n', 'true'], {
            timeout: 1000
          }).catch(() => ({ exitCode: 1 }));
          
          if (sudoCheck.exitCode === 0) {
            await this.commandExecutor.executeCommand('sudo', ['chattr', '-i', safePath], {
              timeout: 5000
            });
          } else {
            // Try without sudo (will fail if immutable was set with root)
            await this.commandExecutor.executeCommand('chattr', ['-i', safePath], {
              timeout: 5000
            }).catch(() => {
              // If we can't remove immutable flag, user will need sudo
              console.warn(`Note: File may have immutable flag set. If unlock fails, try: sudo chattr -i ${safePath}`);
            });
          }
        }
      } catch {
        // Silently ignore - file may not have immutable flag
      }
    } else if (platform() === 'darwin') {
      try {
        await this.commandExecutor.executeCommand('chflags', ['nouchg', safePath], {
          timeout: 5000
        });
      } catch (error) {
        console.warn(`Warning: Could not remove chflags: ${error}`);
      }
    }
  }

  private async verifyUnlockSuccess(safePath: string): Promise<void> {
    try {
      await access(safePath, constants.W_OK);
    } catch (error) {
      throw new Error(`Unlock verification failed: File still not writable after unlock attempt: ${error}`);
    }
  }

  private async handleUnlockFailure(filePath: string, originalError: unknown): Promise<never> {
    try {
      // Import diagnostics dynamically to avoid circular dependencies
      const { FileDiagnostics } = await import('../utils/FileDiagnostics.js');
      const diagnostics = new FileDiagnostics();
      
      const report = await diagnostics.diagnoseUnlockIssues(filePath);
      const formattedReport = diagnostics.formatDiagnostics(report);
      
      // Log detailed diagnostics for debugging
      console.error('\n' + formattedReport);
      
      // Create enhanced error with diagnostics
      const enhancedError = new Error(
        `Failed to unlock file ${filePath} after ${3} attempts. Original error: ${originalError}\n\n` +
        `Quick diagnosis: ${report.diagnosis.join(', ')}\n` +
        `Recommendations: ${report.recommendations.join(', ')}`
      );
      
      this.errorHandler.handleAndThrow(enhancedError, {
        operation: 'unlockFile',
        filePath,
        platform: 'unix',
        attempts: 3,
        diagnostics: report
      });
    } catch (diagnosticError) {
      // If diagnostics fail, fall back to original error handling
      console.error(`Diagnostic failed: ${diagnosticError}`);
      this.errorHandler.handleAndThrow(originalError, {
        operation: 'unlockFile',
        filePath,
        platform: 'unix',
        attempts: 3
      });
    }
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
    } catch (error: any) {
      // Handle specific error cases
      if (error.code === 'ENOENT') {
        // File doesn't exist, so it can't be locked
        return false;
      } else if (error.code === 'EACCES' || error.code === 'EPERM') {
        // Permission denied - file is locked/read-only
        // EACCES: Linux/Unix read-only
        // EPERM: macOS with immutable flag (uchg)
        return true;
      }
      
      // For other errors (including path validation), treat as not locked
      // This prevents false positives for files outside the project
      return false;
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
      
      // Check if already locked to avoid errors
      if (await this.isLocked(filePath)) {
        return; // Already locked, nothing to do
      }
      
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
    } catch (error: any) {
      // Handle specific error cases
      if (error.code === 'ENOENT') {
        // File doesn't exist, so it can't be locked
        return false;
      } else if (error.code === 'EACCES' || error.code === 'EPERM') {
        // Permission denied - file is locked/read-only
        // EACCES: Linux/Unix read-only
        // EPERM: macOS with immutable flag (uchg)
        return true;
      }
      
      // For other errors (including path validation), treat as not locked
      // This prevents false positives for files outside the project
      return false;
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