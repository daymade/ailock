import { Platform } from '../platform.js';
import { BasePlatformAdapter } from './BasePlatformAdapter.js';
import path from 'path';
import { execSync } from 'child_process';

/**
 * Unix/Linux/macOS platform adapter for file locking
 */
export class UnixAdapter extends BasePlatformAdapter {
  protected platformType = Platform.UNIX;
  private readonly isMacOS = process.platform === 'darwin';
  private readonly isLinux = process.platform === 'linux';

  /**
   * Lock a file on Unix-like systems
   */
  async lockFile(filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);
    
    // Validate path
    await this.pathValidator.validateAndSanitizePath(absolutePath);

    // First, make the file read-only
    await this.makeReadOnly(absolutePath);

    // Then apply immutable attribute if supported
    if (this.supportsImmutable()) {
      await this.applyImmutableAttribute(absolutePath);
    }
  }

  /**
   * Unlock a file on Unix-like systems
   */
  async unlockFile(filePath: string): Promise<void> {
    const absolutePath = path.resolve(filePath);
    
    // Validate path
    await this.pathValidator.validateAndSanitizePath(absolutePath);

    // First, remove immutable attribute if it exists
    if (this.supportsImmutable()) {
      await this.removeImmutableAttribute(absolutePath);
    }

    // Then make the file writable
    await this.makeWritable(absolutePath);
  }

  /**
   * Check if a file is locked on Unix-like systems
   */
  async isLocked(filePath: string): Promise<boolean> {
    const absolutePath = path.resolve(filePath);
    
    // Check if file is read-only
    const readOnly = await this.isReadOnly(absolutePath);
    
    // A file is considered locked if it's read-only
    // The immutable flag is an additional layer of protection
    return readOnly;
  }

  /**
   * Check if the platform supports immutable file attributes
   */
  supportsImmutable(): boolean {
    // macOS supports chflags, Linux supports chattr
    // We check for command availability
    if (this.isMacOS) {
      return this.commandExists('chflags');
    }
    if (this.isLinux) {
      return this.commandExists('chattr');
    }
    return false;
  }

  /**
   * Check if a file has immutable attributes
   */
  protected async checkImmutable(filePath: string): Promise<boolean> {
    if (!this.supportsImmutable()) {
      return false;
    }

    try {
      if (this.isMacOS) {
        // On macOS, use ls -lO to check for uchg flag
        const result = await this.commandExecutor.executeCommand('ls', ['-lO', filePath]);
        return result.stdout.includes('uchg');
      }
      
      if (this.isLinux) {
        // On Linux, use lsattr to check for immutable flag
        const result = await this.commandExecutor.executeCommand('lsattr', [filePath]);
        return result.stdout.includes('i');
      }
    } catch {
      // If we can't check, assume not immutable
      return false;
    }

    return false;
  }

  /**
   * Apply immutable attribute to a file
   */
  private async applyImmutableAttribute(filePath: string): Promise<void> {
    if (!this.supportsImmutable()) {
      return;
    }

    try {
      if (this.isMacOS) {
        // On macOS, use chflags to set uchg (user immutable) flag
        await this.commandExecutor.executeCommand('chflags', ['uchg', filePath]);
      } else if (this.isLinux) {
        // On Linux, use chattr to set immutable flag
        // Note: This might require sudo
        await this.commandExecutor.executeCommand('chattr', ['+i', filePath]);
      }
    } catch (error) {
      // If we can't set immutable (e.g., no sudo), continue with just read-only
      console.debug(`Could not set immutable attribute: ${error}`);
    }
  }

  /**
   * Remove immutable attribute from a file
   */
  private async removeImmutableAttribute(filePath: string): Promise<void> {
    if (!this.supportsImmutable()) {
      return;
    }

    try {
      if (this.isMacOS) {
        // On macOS, use chflags to remove uchg flag
        await this.commandExecutor.executeCommand('chflags', ['nouchg', filePath]);
      } else if (this.isLinux) {
        // On Linux, use chattr to remove immutable flag
        // Note: This might require sudo
        await this.commandExecutor.executeCommand('chattr', ['-i', filePath]);
      }
    } catch (error) {
      // If we can't remove immutable (e.g., no sudo), try to continue
      console.debug(`Could not remove immutable attribute: ${error}`);
    }
  }

  /**
   * Check if a command exists on the system
   * Made synchronous to maintain interface compatibility
   */
  private commandExists(command: string): boolean {
    try {
      execSync(`which ${command}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}