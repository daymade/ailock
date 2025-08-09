import { ErrorCategory, ErrorSeverity, SecureError } from './ErrorHandler.js';

/**
 * Error recovery mechanisms and actionable suggestions
 */
export class ErrorRecovery {
  /**
   * Create recovery action for an error
   */
  createRecoveryAction(error: SecureError): (() => Promise<void>) | null {
    switch (error.category) {
      case ErrorCategory.PERMISSION:
        return this.createPermissionRecovery(error);
      case ErrorCategory.FILESYSTEM:
        return this.createFilesystemRecovery(error);
      case ErrorCategory.CONFIGURATION:
        return this.createConfigurationRecovery(error);
      case ErrorCategory.SECURITY:
        return this.createSecurityRecovery(error);
      default:
        return null;
    }
  }

  /**
   * Generate user-friendly recovery suggestions
   */
  generateRecoverySuggestions(error: SecureError): string[] {
    const suggestions: string[] = [];

    switch (error.category) {
      case ErrorCategory.PERMISSION:
        suggestions.push(
          'Check file permissions with: ls -la <file>',
          'Ensure you have write access to the file',
          'Try running with appropriate privileges'
        );
        break;

      case ErrorCategory.FILESYSTEM:
        suggestions.push(
          'Verify the file path exists',
          'Check available disk space',
          'Ensure the parent directory is writable'
        );
        break;

      case ErrorCategory.CONFIGURATION:
        suggestions.push(
          'Check your .ailock configuration file',
          'Verify pattern syntax in configuration',
          'Run: ailock init --interactive to reconfigure'
        );
        break;

      case ErrorCategory.SECURITY:
        if (error.severity === ErrorSeverity.CRITICAL) {
          suggestions.push(
            'This is a critical security error',
            'Review your system for potential security issues',
            'Contact support if the issue persists'
          );
        } else {
          suggestions.push(
            'Review file permissions and access controls',
            'Check for suspicious file modifications'
          );
        }
        break;

      case ErrorCategory.VALIDATION:
        suggestions.push(
          'Check input format and syntax',
          'Ensure all required parameters are provided',
          'Review command usage with: ailock help <command>'
        );
        break;

      case ErrorCategory.NETWORK:
        suggestions.push(
          'Check network connectivity',
          'Verify proxy settings if applicable',
          'Try again in a few moments'
        );
        break;

      default:
        suggestions.push(
          'Try the operation again',
          'Check the documentation for troubleshooting',
          'Run with --verbose for more information'
        );
        break;
    }

    return suggestions;
  }

  /**
   * Determine if error requires immediate attention
   */
  requiresImmediateAttention(error: SecureError): boolean {
    return error.severity === ErrorSeverity.CRITICAL || 
           (error.category === ErrorCategory.SECURITY && error.severity === ErrorSeverity.HIGH);
  }

  /**
   * Generate diagnostic commands for troubleshooting
   */
  generateDiagnosticCommands(error: SecureError): string[] {
    const commands: string[] = [];

    switch (error.category) {
      case ErrorCategory.PERMISSION:
        commands.push(
          'ls -la',
          'whoami',
          'groups'
        );
        break;

      case ErrorCategory.FILESYSTEM:
        commands.push(
          'df -h',
          'ls -la',
          'pwd'
        );
        break;

      case ErrorCategory.CONFIGURATION:
        commands.push(
          'ailock status',
          'cat .ailock',
          'ailock diagnose'
        );
        break;

      case ErrorCategory.SECURITY:
        // Limited diagnostic commands for security errors
        commands.push(
          'ailock status',
          'ailock diagnose --security-check'
        );
        break;
    }

    return commands;
  }

  private createPermissionRecovery(error: SecureError): (() => Promise<void>) | null {
    return async () => {
      console.warn('🔧 Attempting to recover from permission error...');
      // Implementation would depend on specific permission error
      // This is a placeholder for demonstration
    };
  }

  private createFilesystemRecovery(error: SecureError): (() => Promise<void>) | null {
    return async () => {
      console.warn('🔧 Attempting to recover from filesystem error...');
      // Implementation would include directory creation, cleanup, etc.
    };
  }

  private createConfigurationRecovery(error: SecureError): (() => Promise<void>) | null {
    return async () => {
      console.warn('🔧 Attempting to recover from configuration error...');
      // Implementation would include config validation and correction
    };
  }

  private createSecurityRecovery(error: SecureError): (() => Promise<void>) | null {
    // Security errors should not have automatic recovery
    // They require manual intervention
    return null;
  }
}