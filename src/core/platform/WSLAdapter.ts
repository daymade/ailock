import { Platform } from '../platform.js';
import { UnixAdapter } from './UnixAdapter.js';
import path from 'path';

/**
 * Windows Subsystem for Linux (WSL) adapter for file locking
 * Extends UnixAdapter but with WSL-specific considerations
 */
export class WSLAdapter extends UnixAdapter {
  protected platformType = Platform.WSL;

  /**
   * Lock a file in WSL environment
   */
  async lockFile(filePath: string): Promise<void> {
    const absolutePath = this.convertPath(filePath);
    
    // Use Unix-style locking
    await super.lockFile(absolutePath);
    
    // Additional WSL-specific handling if needed
    await this.syncWithWindows(absolutePath);
  }

  /**
   * Unlock a file in WSL environment
   */
  async unlockFile(filePath: string): Promise<void> {
    const absolutePath = this.convertPath(filePath);
    
    // Use Unix-style unlocking
    await super.unlockFile(absolutePath);
    
    // Additional WSL-specific handling if needed
    await this.syncWithWindows(absolutePath);
  }

  /**
   * Check if a file is locked in WSL environment
   */
  async isLocked(filePath: string): Promise<boolean> {
    const absolutePath = this.convertPath(filePath);
    return await super.isLocked(absolutePath);
  }

  /**
   * WSL supports limited immutable attributes
   * Depends on the underlying filesystem
   */
  supportsImmutable(): boolean {
    // Check if we're on a filesystem that supports extended attributes
    // For now, we'll be conservative and say no
    return false;
  }

  /**
   * Convert WSL paths if needed
   * Handles /mnt/c/ style paths and Windows paths
   */
  private convertPath(filePath: string): string {
    let convertedPath = path.resolve(filePath);
    
    // Handle Windows-style paths in WSL
    if (filePath.match(/^[A-Z]:\\/i)) {
      // Convert C:\ to /mnt/c/
      const driveLetter = filePath[0].toLowerCase();
      const pathWithoutDrive = filePath.substring(3).replace(/\\/g, '/');
      convertedPath = `/mnt/${driveLetter}/${pathWithoutDrive}`;
    }
    
    return convertedPath;
  }

  /**
   * Sync file attributes with Windows side if on Windows filesystem
   */
  private async syncWithWindows(filePath: string): Promise<void> {
    // Check if file is on Windows filesystem (under /mnt/)
    if (!filePath.startsWith('/mnt/')) {
      return;
    }

    try {
      // WSL2 automatically syncs permissions, but we can force a sync
      // by touching the file's metadata
      await this.commandExecutor.executeCommand('touch', ['-c', filePath]);
    } catch (error) {
      // Sync errors are non-fatal
      console.debug(`Could not sync with Windows filesystem: ${error}`);
    }
  }

  /**
   * Check if running in WSL1 or WSL2
   */
  private async getWSLVersion(): Promise<number> {
    try {
      const wslEnv = process.env.WSL_DISTRO_NAME;
      if (wslEnv) {
        // Try to detect WSL version
        const result = await this.commandExecutor.executeCommand('wsl.exe', ['--list', '--verbose']);
        if (result.stdout.includes('VERSION 2')) {
          return 2;
        }
      }
    } catch {
      // Default to WSL1 behavior if we can't detect
    }
    return 1;
  }
}