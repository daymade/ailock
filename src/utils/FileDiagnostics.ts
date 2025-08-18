import { stat, access, constants } from 'fs/promises';
import { platform } from 'os';
import { SecureCommandExecutor } from '../security/CommandExecutor.js';

export interface FilePermissionInfo {
  mode: number;
  octal: string;
  readable: boolean;
  writable: boolean;
  executable: boolean;
  owner: string;
  group: string;
  size: number;
  lastModified: Date;
}

export interface FileFlagInfo {
  platform: string;
  hasImmutableFlag?: boolean;
  hasSystemFlag?: boolean;
  chflagsOutput?: string;
  chattrOutput?: string;
  error?: string;
}

export interface UnlockDiagnostics {
  filePath: string;
  permissions: FilePermissionInfo;
  flags: FileFlagInfo;
  atomicLockExists: boolean;
  diagnosis: string[];
  recommendations: string[];
}

/**
 * File diagnostics utility for troubleshooting unlock issues
 */
export class FileDiagnostics {
  private commandExecutor: SecureCommandExecutor;

  constructor() {
    this.commandExecutor = new SecureCommandExecutor(['stat', 'chflags', 'chattr', 'lsattr', 'ls']);
  }

  /**
   * Get comprehensive file permission information
   */
  async getFilePermissions(filePath: string): Promise<FilePermissionInfo> {
    const stats = await stat(filePath);
    const mode = stats.mode;
    
    // Check actual access permissions
    let readable = false;
    let writable = false;
    let executable = false;
    
    try {
      await access(filePath, constants.R_OK);
      readable = true;
    } catch {}
    
    try {
      await access(filePath, constants.W_OK);
      writable = true;
    } catch {}
    
    try {
      await access(filePath, constants.X_OK);
      executable = true;
    } catch {}
    
    return {
      mode,
      octal: (mode & parseInt('777', 8)).toString(8).padStart(3, '0'),
      readable,
      writable,
      executable,
      owner: stats.uid.toString(),
      group: stats.gid.toString(),
      size: stats.size,
      lastModified: stats.mtime
    };
  }

  /**
   * Check file flags and extended attributes
   */
  async getFileFlags(filePath: string): Promise<FileFlagInfo> {
    const currentPlatform = platform();
    const flagInfo: FileFlagInfo = {
      platform: currentPlatform
    };

    try {
      if (currentPlatform === 'darwin') {
        // Check macOS chflags using ls -lO 
        try {
          // First try with GNU ls (if available)
          const result = await this.commandExecutor.executeCommand('ls', ['-lO', filePath], {
            timeout: 3000
          });
          flagInfo.chflagsOutput = result.stdout.trim();
          flagInfo.hasImmutableFlag = result.stdout.includes('uchg') || result.stdout.includes('immutable');
          flagInfo.hasSystemFlag = result.stdout.includes('schg');
        } catch (error) {
          try {
            // Fallback: try using stat with correct format for file flags
            const result = await this.commandExecutor.executeCommand('stat', ['-f', '%f', filePath], {
              timeout: 3000
            });
            const flags = parseInt(result.stdout.trim(), 16);
            flagInfo.chflagsOutput = `Flags: 0x${flags.toString(16)}`;
            // Check for UF_IMMUTABLE (0x2) and UF_APPEND (0x4)
            flagInfo.hasImmutableFlag = (flags & 0x2) !== 0;
            flagInfo.hasSystemFlag = (flags & 0x20000) !== 0; // SF_IMMUTABLE
          } catch (statError) {
            flagInfo.error = `macOS flag check failed: ${error}, stat fallback: ${statError}`;
          }
        }
      } else if (currentPlatform === 'linux') {
        // Check Linux chattr/lsattr
        try {
          const result = await this.commandExecutor.executeCommand('lsattr', [filePath], {
            timeout: 3000
          });
          flagInfo.chattrOutput = result.stdout.trim();
          flagInfo.hasImmutableFlag = result.stdout.includes('i');
        } catch (error) {
          flagInfo.error = `lsattr check failed: ${error}`;
        }
      }
    } catch (error) {
      flagInfo.error = `Platform-specific flag check failed: ${error}`;
    }

    return flagInfo;
  }

  /**
   * Check if atomic lock file exists
   */
  async checkAtomicLock(filePath: string): Promise<boolean> {
    try {
      const lockDir = '.ailock-locks';
      const basename = filePath.split('/').pop() || 'unknown';
      const lockFilePath = `${lockDir}/${basename}.lock`;
      
      await access(lockFilePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Perform comprehensive diagnostics for unlock issues
   */
  async diagnoseUnlockIssues(filePath: string): Promise<UnlockDiagnostics> {
    const permissions = await this.getFilePermissions(filePath);
    const flags = await this.getFileFlags(filePath);
    const atomicLockExists = await this.checkAtomicLock(filePath);

    const diagnosis: string[] = [];
    const recommendations: string[] = [];

    // Analyze permissions
    if (permissions.octal === '444') {
      diagnosis.push('File has read-only permissions (444)');
    } else if (permissions.octal === '644') {
      diagnosis.push('File has normal write permissions (644)');
    } else {
      diagnosis.push(`File has unusual permissions (${permissions.octal})`);
    }

    // Analyze flags
    if (flags.hasImmutableFlag) {
      diagnosis.push(`File has immutable flag set (${flags.platform})`);
      if (flags.platform === 'darwin') {
        recommendations.push('Run: chflags nouchg <file>');
      } else if (flags.platform === 'linux') {
        recommendations.push('Run: chattr -i <file>');
      }
    }

    // Analyze atomic locks
    if (atomicLockExists) {
      diagnosis.push('Atomic lock file exists');
      recommendations.push('Release atomic lock or wait for timeout');
    }

    // Provide general recommendations
    if (permissions.octal === '444' && !flags.hasImmutableFlag) {
      recommendations.push('Run: chmod 644 <file>');
    }

    if (diagnosis.length === 0) {
      diagnosis.push('No obvious unlock issues detected');
    }

    return {
      filePath,
      permissions,
      flags,
      atomicLockExists,
      diagnosis,
      recommendations
    };
  }

  /**
   * Format diagnostics for display
   */
  formatDiagnostics(diagnostics: UnlockDiagnostics): string {
    const lines: string[] = [];
    
    lines.push(`🔍 Unlock Diagnostics for: ${diagnostics.filePath}`);
    lines.push('');
    
    lines.push('📋 File Permissions:');
    lines.push(`   Mode: ${diagnostics.permissions.octal} (${diagnostics.permissions.mode})`);
    lines.push(`   Owner: ${diagnostics.permissions.owner}:${diagnostics.permissions.group}`);
    lines.push(`   Size: ${diagnostics.permissions.size} bytes`);
    lines.push(`   Modified: ${diagnostics.permissions.lastModified.toISOString()}`);
    lines.push('');
    
    lines.push('🏷️  File Flags:');
    lines.push(`   Platform: ${diagnostics.flags.platform}`);
    if (diagnostics.flags.chflagsOutput) {
      lines.push(`   Flags: ${diagnostics.flags.chflagsOutput}`);
    }
    if (diagnostics.flags.chattrOutput) {
      lines.push(`   Attributes: ${diagnostics.flags.chattrOutput}`);
    }
    if (diagnostics.flags.error) {
      lines.push(`   Error: ${diagnostics.flags.error}`);
    }
    lines.push('');
    
    lines.push('🔒 Lock Status:');
    lines.push(`   Atomic lock: ${diagnostics.atomicLockExists ? 'EXISTS' : 'Not found'}`);
    lines.push('');
    
    lines.push('🔍 Diagnosis:');
    diagnostics.diagnosis.forEach(item => lines.push(`   • ${item}`));
    lines.push('');
    
    if (diagnostics.recommendations.length > 0) {
      lines.push('💡 Recommendations:');
      diagnostics.recommendations.forEach(item => lines.push(`   • ${item}`));
    }
    
    return lines.join('\n');
  }
}