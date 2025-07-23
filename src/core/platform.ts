import { exec } from 'child_process';
import { promisify } from 'util';
import { constants, access, chmod, stat } from 'fs/promises';
import { platform } from 'os';
import path from 'path';

const execAsync = promisify(exec);

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
 * Unix/Linux/macOS platform adapter
 */
class UnixAdapter implements PlatformAdapter {
  async lockFile(filePath: string): Promise<void> {
    try {
      // Make file read-only for all users
      await chmod(filePath, 0o444);
      
      // Try to set immutable bit on Linux
      if (platform() === 'linux') {
        try {
          await execAsync(`chattr +i "${filePath}"`);
        } catch (error) {
          // Ignore chattr errors - not all filesystems support it
          console.warn(`Warning: Could not set immutable bit on ${filePath}: ${error}`);
        }
      }
    } catch (error) {
      throw new Error(`Failed to lock file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async unlockFile(filePath: string): Promise<void> {
    try {
      // Try to remove immutable bit on Linux first
      if (platform() === 'linux') {
        try {
          await execAsync(`chattr -i "${filePath}"`);
        } catch (error) {
          // Ignore chattr errors
        }
      }
      
      // Restore write permissions for owner
      await chmod(filePath, 0o644);
    } catch (error) {
      throw new Error(`Failed to unlock file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async isLocked(filePath: string): Promise<boolean> {
    try {
      await access(filePath, constants.W_OK);
      return false; // If no error, file is writable
    } catch {
      return true; // If error, file is not writable (locked)
    }
  }

  supportsImmutable(): boolean {
    return platform() === 'linux';
  }
}

/**
 * Windows platform adapter
 */
class WindowsAdapter implements PlatformAdapter {
  async lockFile(filePath: string): Promise<void> {
    try {
      // Use attrib command to set read-only
      await execAsync(`attrib +R "${filePath}"`);
      
      // For more advanced scenarios, we could use icacls
      // await execAsync(`icacls "${filePath}" /inheritance:r /grant:r *S-1-1-0:R`);
    } catch (error) {
      throw new Error(`Failed to lock file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async unlockFile(filePath: string): Promise<void> {
    try {
      // Remove read-only attribute
      await execAsync(`attrib -R "${filePath}"`);
    } catch (error) {
      throw new Error(`Failed to unlock file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async isLocked(filePath: string): Promise<boolean> {
    try {
      const stats = await stat(filePath);
      // On Windows, check if file has read-only attribute
      // This is a simplified check - in reality we'd need more sophisticated detection
      return !(stats.mode & 0o200); // Check if owner has write permission
    } catch {
      return false;
    }
  }

  supportsImmutable(): boolean {
    return false;
  }
}

/**
 * WSL (Windows Subsystem for Linux) adapter
 */
class WSLAdapter implements PlatformAdapter {
  private unixAdapter = new UnixAdapter();
  private windowsAdapter = new WindowsAdapter();

  async lockFile(filePath: string): Promise<void> {
    // In WSL, try Unix method first, fall back to Windows if needed
    try {
      await this.unixAdapter.lockFile(filePath);
    } catch (error) {
      console.warn(`Unix lock failed, trying Windows method: ${error}`);
      await this.windowsAdapter.lockFile(filePath);
    }
  }

  async unlockFile(filePath: string): Promise<void> {
    // Try both methods to ensure unlock
    try {
      await this.unixAdapter.unlockFile(filePath);
    } catch {
      // Try Windows method if Unix fails
      await this.windowsAdapter.unlockFile(filePath);
    }
  }

  async isLocked(filePath: string): Promise<boolean> {
    return await this.unixAdapter.isLocked(filePath);
  }

  supportsImmutable(): boolean {
    return false; // WSL doesn't reliably support immutable bits
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