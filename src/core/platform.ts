/**
 * Platform abstraction layer for cross-platform file locking
 * 
 * This module provides a unified interface for file locking operations
 * across different operating systems (Unix/Linux/macOS, Windows, WSL).
 */

// Re-export types and enums
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

// Re-export factory and adapters
export { PlatformFactory } from './platform/PlatformFactory.js';
export { BasePlatformAdapter } from './platform/BasePlatformAdapter.js';
export { UnixAdapter } from './platform/UnixAdapter.js';
export { WindowsAdapter } from './platform/WindowsAdapter.js';
export { WSLAdapter } from './platform/WSLAdapter.js';

// Import factory for convenience functions
import { PlatformFactory } from './platform/PlatformFactory.js';

/**
 * Detect the current platform
 * @deprecated Use PlatformFactory.detectPlatform() instead
 */
export function detectPlatform(): Platform {
  return PlatformFactory.detectPlatform();
}

/**
 * Get the appropriate platform adapter
 * @deprecated Use PlatformFactory.createAdapter() instead
 */
export function getPlatformAdapter(): PlatformAdapter {
  return PlatformFactory.createAdapter();
}