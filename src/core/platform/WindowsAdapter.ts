import { Platform } from '../platform.js';
import { BasePlatformAdapter } from './BasePlatformAdapter.js';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Windows platform adapter for file locking
 */
export class WindowsAdapter extends BasePlatformAdapter {
  protected platformType = Platform.WINDOWS;

  /**
   * Lock a file on Windows
   */
  async lockFile(filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);
    
    // Validate path
    await this.pathValidator.validateAndSanitizePath(absolutePath);

    // On Windows, we use attrib to set read-only
    await this.setReadOnlyAttribute(absolutePath, true);
    
    // Additionally, we can use ACLs for stronger protection
    await this.setWindowsACL(absolutePath, true);
  }

  /**
   * Unlock a file on Windows
   */
  async unlockFile(filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);
    
    // Validate path
    await this.pathValidator.validateAndSanitizePath(absolutePath);

    // Remove ACL restrictions first
    await this.setWindowsACL(absolutePath, false);
    
    // Then remove read-only attribute
    await this.setReadOnlyAttribute(absolutePath, false);
  }

  /**
   * Check if a file is locked on Windows
   */
  async isLocked(filePath: string): Promise<boolean> {
    const absolutePath = path.resolve(filePath);
    
    try {
      // Check if file has read-only attribute
      const result = await this.commandExecutor.executeCommand('attrib', [absolutePath]);
      return result.stdout.includes(' R ');
    } catch {
      // If we can't check, use the base implementation
      return await this.isReadOnly(absolutePath);
    }
  }

  /**
   * Windows doesn't support immutable attributes like Unix
   */
  supportsImmutable(): boolean {
    return false;
  }

  /**
   * Check if a file has immutable attributes (always false on Windows)
   */
  protected async checkImmutable(filePath: string): Promise<boolean> {
    return false;
  }

  /**
   * Set or remove the read-only attribute using attrib command
   */
  private async setReadOnlyAttribute(filePath: string, readOnly: boolean): Promise<void> {
    try {
      const flag = readOnly ? '+R' : '-R';
      await this.commandExecutor.executeCommand('attrib', [flag, filePath]);
    } catch (error) {
      // Fallback to chmod if attrib fails
      if (readOnly) {
        await this.makeReadOnly(filePath);
      } else {
        await this.makeWritable(filePath);
      }
    }
  }

  /**
   * Set Windows ACLs for additional protection
   */
  private async setWindowsACL(filePath: string, lock: boolean): Promise<void> {
    try {
      if (lock) {
        // Remove write permissions for current user using icacls
        // /deny removes write (W) and delete (D) permissions
        const username = process.env.USERNAME || process.env.USER || 'Everyone';
        await this.commandExecutor.executeCommand('icacls', [
          filePath,
          '/deny',
          `${username}:(W,D)`,
          '/Q'
        ]);
      } else {
        // Reset permissions to inherited defaults
        await this.commandExecutor.executeCommand('icacls', [
          filePath,
          '/reset',
          '/Q'
        ]);
      }
    } catch (error) {
      // ACL operations might fail without admin rights
      // Continue with basic protection
      console.debug(`Could not modify Windows ACLs: ${error}`);
    }
  }

  /**
   * Check if running with administrator privileges
   */
  private isAdmin(): boolean {
    try {
      execSync('net session', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}