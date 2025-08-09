import { platform } from 'os';
import { Platform, type PlatformAdapter } from '../platform.js';
import { UnixAdapter } from './UnixAdapter.js';
import { WindowsAdapter } from './WindowsAdapter.js';
import { WSLAdapter } from './WSLAdapter.js';

/**
 * Factory class for creating platform-specific adapters
 */
export class PlatformFactory {
  private static instance: PlatformAdapter | null = null;

  /**
   * Create a platform adapter based on the current OS
   */
  static createAdapter(): PlatformAdapter {
    // Return cached instance if available
    if (this.instance) {
      return this.instance;
    }

    const detectedPlatform = this.detectPlatform();
    
    switch (detectedPlatform) {
      case Platform.WINDOWS:
        this.instance = new WindowsAdapter();
        break;
      case Platform.WSL:
        this.instance = new WSLAdapter();
        break;
      case Platform.UNIX:
      default:
        this.instance = new UnixAdapter();
        break;
    }

    return this.instance;
  }

  /**
   * Detect the current platform
   */
  static detectPlatform(): Platform {
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
   * Reset the cached instance (mainly for testing)
   */
  static reset(): void {
    this.instance = null;
  }

  /**
   * Get information about the current platform
   */
  static getPlatformInfo(): {
    platform: Platform;
    os: string;
    isWSL: boolean;
    supportImmutable: boolean;
  } {
    const detectedPlatform = this.detectPlatform();
    const adapter = this.createAdapter();
    
    return {
      platform: detectedPlatform,
      os: platform(),
      isWSL: detectedPlatform === Platform.WSL,
      supportImmutable: adapter.supportsImmutable()
    };
  }
}