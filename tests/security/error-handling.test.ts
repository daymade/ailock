import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
  SecureErrorHandler, 
  ErrorSeverity, 
  ErrorCategory 
} from '../../src/security/ErrorHandler.js';
import { 
  MALICIOUS_INPUTS, 
  SecurityAssertions 
} from './utils/security-test-helpers.js';

describe('Secure Error Handling and Information Disclosure Prevention', () => {
  let errorHandler: SecureErrorHandler;

  beforeEach(() => {
    errorHandler = new SecureErrorHandler({
      sanitizeMessages: true,
      includeStackTrace: false,
      logErrors: false,
      failSafe: true
    });
  });

  describe('Information Disclosure Prevention', () => {
    it('should sanitize file paths in error messages', () => {
      const sensitiveErrors = [
        new Error('Failed to access /Users/admin/.ssh/id_rsa'),
        new Error('Cannot read /home/user/.bashrc'),
        new Error('Permission denied: C:\\Users\\Administrator\\Documents\\secret.txt'),
        new Error('File not found: /private/etc/master.passwd'),
        new Error('Access denied to /root/.ssh/authorized_keys')
      ];

      for (const error of sensitiveErrors) {
        const handled = errorHandler.handle(error);
        
        // Should not contain actual paths
        expect(handled.message).not.toMatch(/\/Users\/[^\/\s]+/);
        expect(handled.message).not.toMatch(/\/home\/[^\/\s]+/);
        expect(handled.message).not.toMatch(/C:\\Users\\[^\\s]+/);
        expect(handled.message).not.toMatch(/\/private\/etc/);
        expect(handled.message).not.toMatch(/\/root\//);
        
        // Should contain redaction markers
        expect(handled.message).toContain('[REDACTED]');
        
        SecurityAssertions.assertSanitizedError(handled.message);
      }
    });

    it('should sanitize credentials and secrets in error messages', () => {
      const credentialErrors = [
        new Error('Authentication failed with password: secret123'),
        new Error('Invalid API key: abcd1234567890efgh'),
        new Error('Token expired: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'),
        new Error('Database connection failed: postgresql://user:pass@host:5432/db'),
        new Error('SSH key validation failed: ssh-rsa AAAAB3NzaC1yc2EAAAADAQAB'),
        new Error('Bearer token invalid: Bearer abc123def456')
      ];

      for (const error of credentialErrors) {
        const handled = errorHandler.handle(error);
        
        // Should not contain credentials
        expect(handled.message).not.toContain('secret123');
        expect(handled.message).not.toContain('abcd1234567890efgh');
        expect(handled.message).not.toContain('eyJhbGciOiJIUzI1NiI');
        expect(handled.message).not.toContain('user:pass@host');
        expect(handled.message).not.toContain('AAAAB3NzaC1yc2E');
        expect(handled.message).not.toContain('abc123def456');
        
        // Should contain redaction markers
        expect(handled.message).toContain('[REDACTED]');
        
        SecurityAssertions.assertSanitizedError(handled.message);
      }
    });

    it('should sanitize IP addresses and network information', () => {
      const networkErrors = [
        new Error('Connection timeout to 192.168.1.100:8080'),
        new Error('DNS resolution failed for internal.company.com'),
        new Error('Port scan detected from 10.0.0.5'),
        new Error('Invalid hostname: db-server-01.internal'),
        new Error('Network unreachable: 172.16.0.0/12')
      ];

      for (const error of networkErrors) {
        const handled = errorHandler.handle(error);
        
        // Should not contain network information
        expect(handled.message).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
        expect(handled.message).not.toContain('internal.company.com');
        expect(handled.message).not.toContain('db-server-01.internal');
        expect(handled.message).not.toContain('172.16.0.0/12');
        
        // Should contain redaction markers
        expect(handled.message).toContain('[REDACTED]');
        
        SecurityAssertions.assertSanitizedError(handled.message);
      }
    });

    it('should sanitize hexadecimal strings and hashes', () => {
      const hashErrors = [
        new Error('Hash mismatch: expected 1a2b3c4d5e6f7890abcdef1234567890'),
        new Error('Invalid checksum: sha256:abcd1234567890ef'),
        new Error('MD5 verification failed: d41d8cd98f00b204e9800998ecf8427e'),
        new Error('Certificate fingerprint: A1:B2:C3:D4:E5:F6')
      ];

      for (const error of hashErrors) {
        const handled = errorHandler.handle(error);
        
        // Should not contain hex strings
        expect(handled.message).not.toMatch(/[a-f0-9]{32,}/);
        expect(handled.message).not.toMatch(/[A-F0-9]{2}:[A-F0-9]{2}:[A-F0-9]{2}/);
        
        // Should contain redaction markers  
        expect(handled.message).toContain('[REDACTED]');
        
        SecurityAssertions.assertSanitizedError(handled.message);
      }
    });

    it('should sanitize Base64 encoded data', () => {
      const base64Errors = [
        new Error('Invalid token: YWRtaW46cGFzc3dvcmQ='),
        new Error('Decode failed: SGVsbG8gV29ybGQ='),
        new Error('Certificate data: LS0tLS1CRUdJTiBDRVJUSUZJQ0FURS0tLS0t')
      ];

      for (const error of base64Errors) {
        const handled = errorHandler.handle(error);
        
        // Should not contain base64 strings
        expect(handled.message).not.toMatch(/[A-Za-z0-9+\/]{20,}={0,2}/);
        
        // Should contain redaction markers
        expect(handled.message).toContain('[REDACTED]');
        
        SecurityAssertions.assertSanitizedError(handled.message);
      }
    });
  });

  describe('Error Categorization', () => {
    it('should categorize security errors correctly', () => {
      const securityErrors = [
        { error: new Error('Access denied'), category: ErrorCategory.SECURITY },
        { error: new Error('Permission denied'), category: ErrorCategory.SECURITY },
        { error: new Error('Unauthorized access'), category: ErrorCategory.SECURITY },
        { error: new Error('Authentication failed'), category: ErrorCategory.SECURITY },
        { error: new Error('Security violation detected'), category: ErrorCategory.SECURITY }
      ];

      for (const { error, category } of securityErrors) {
        const handled = errorHandler.handle(error);
        expect(handled.category).toBe(category);
        expect(handled.severity).toBe(ErrorSeverity.HIGH);
        expect(handled.shouldFailSafe).toBe(true);
      }
    });

    it('should categorize validation errors correctly', () => {
      const validationErrors = [
        { error: new Error('Invalid input format'), category: ErrorCategory.VALIDATION },
        { error: new Error('Validation failed'), category: ErrorCategory.VALIDATION },
        { error: new Error('Malformed data'), category: ErrorCategory.VALIDATION },
        { error: new Error('Path traversal attempt detected'), category: ErrorCategory.VALIDATION }
      ];

      for (const { error, category } of validationErrors) {
        const handled = errorHandler.handle(error);
        expect(handled.category).toBe(category);
        expect(handled.severity).toBe(ErrorSeverity.MEDIUM);
        expect(handled.shouldFailSafe).toBe(true);
      }
    });

    it('should categorize filesystem errors correctly', () => {
      const filesystemErrors = [
        { error: new Error('ENOENT: file not found'), category: ErrorCategory.FILESYSTEM },
        { error: new Error('EACCES: permission denied'), category: ErrorCategory.FILESYSTEM },
        { error: new Error('EPERM: operation not permitted'), category: ErrorCategory.FILESYSTEM },
        { error: new Error('File system error occurred'), category: ErrorCategory.FILESYSTEM }
      ];

      for (const { error, category } of filesystemErrors) {
        const handled = errorHandler.handle(error);
        expect(handled.category).toBe(category);
        expect(handled.severity).toBe(ErrorSeverity.MEDIUM);
        expect(handled.shouldFailSafe).toBe(false); // FS errors typically don't require fail-safe
      }
    });

    it('should categorize permission errors correctly', () => {
      const permissionErrors = [
        { error: new Error('Insufficient privileges'), category: ErrorCategory.PERMISSION },
        { error: new Error('Administrator rights required'), category: ErrorCategory.PERMISSION },
        { error: new Error('Permission escalation detected'), category: ErrorCategory.PERMISSION }
      ];

      for (const { error, category } of permissionErrors) {
        const handled = errorHandler.handle(error);
        expect(handled.category).toBe(category);
        expect(handled.severity).toBe(ErrorSeverity.HIGH);
        expect(handled.shouldFailSafe).toBe(true);
      }
    });

    it('should handle unknown errors gracefully', () => {
      const unknownErrors = [
        new Error('Something went wrong'),
        new Error('Unexpected error occurred'),
        new Error('')
      ];

      for (const error of unknownErrors) {
        const handled = errorHandler.handle(error);
        expect(handled.category).toBe(ErrorCategory.UNKNOWN);
        expect(handled.severity).toBe(ErrorSeverity.MEDIUM);
        expect(handled.shouldFailSafe).toBe(true); // Unknown errors should fail safe
      }
    });
  });

  describe('Context Sanitization', () => {
    it('should sanitize sensitive context information', () => {
      const sensitiveContext = {
        password: 'supersecret123',
        apiKey: 'key_1234567890abcdef',
        userToken: 'bearer_token_xyz',
        sessionId: 'sess_abcd1234',
        normalData: 'safe information',
        nestedObject: {
          secret: 'hidden_value',
          safe: 'visible_value',
          credentials: {
            username: 'admin',
            password: 'secret'
          }
        }
      };

      const handled = errorHandler.handle(new Error('Test error'), sensitiveContext);
      
      // Sensitive keys should be redacted
      expect(handled.context?.password).toBe('[REDACTED]');
      expect(handled.context?.apiKey).toBe('[REDACTED]');
      expect(handled.context?.userToken).toBe('[REDACTED]');
      expect(handled.context?.sessionId).toBe('[REDACTED]');
      
      // Safe data should be preserved
      expect(handled.context?.normalData).toBe('safe information');
      expect(handled.context?.nestedObject?.safe).toBe('visible_value');
      
      // Nested sensitive data should be redacted
      expect(handled.context?.nestedObject?.secret).toBe('[REDACTED]');
      expect(handled.context?.nestedObject?.credentials?.password).toBe('[REDACTED]');
    });

    it('should limit context size to prevent resource exhaustion', () => {
      const largeContext = {
        data: 'x'.repeat(5000),
        moreData: 'y'.repeat(5000),
        evenMoreData: 'z'.repeat(5000)
      };

      const handler = new SecureErrorHandler({ 
        maxContextSize: 1000,
        sanitizeMessages: true 
      });
      
      const handled = handler.handle(new Error('Test'), largeContext);
      
      const contextSize = JSON.stringify(handled.context || {}).length;
      expect(contextSize).toBeLessThanOrEqual(1000);
    });

    it('should handle circular references in context', () => {
      const circularContext: any = { name: 'test' };
      circularContext.self = circularContext;

      // Should not throw due to circular reference
      expect(() => {
        errorHandler.handle(new Error('Test'), circularContext);
      }).not.toThrow();
    });

    it('should sanitize context values recursively', () => {
      const contextWithSensitiveValues = {
        user: '/Users/admin/.ssh/id_rsa',
        config: {
          database: 'postgresql://user:pass@host:5432/db',
          api: {
            token: 'abc123def456',
            endpoint: 'https://api.internal.com/v1'
          }
        },
        logs: [
          'Connected to 192.168.1.100',
          'Authentication successful for admin',
          'Token: eyJhbGciOiJIUzI1NiJ9'
        ]
      };

      const handled = errorHandler.handle(new Error('Test'), contextWithSensitiveValues);
      
      // All sensitive values should be sanitized
      const contextStr = JSON.stringify(handled.context);
      expect(contextStr).toContain('[REDACTED]');
      expect(contextStr).not.toContain('/Users/admin');
      expect(contextStr).not.toContain('user:pass@host');
      expect(contextStr).not.toContain('abc123def456');
      expect(contextStr).not.toContain('192.168.1.100');
      expect(contextStr).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    });
  });

  describe('Fail-Safe Behavior Determination', () => {
    it('should determine fail-safe behavior based on error type', () => {
      const testCases = [
        { error: new Error('Security violation'), shouldFailSafe: true },
        { error: new Error('Access denied'), shouldFailSafe: true },
        { error: new Error('Invalid input detected'), shouldFailSafe: true },
        { error: new Error('Path traversal attempt'), shouldFailSafe: true },
        { error: new Error('ENOENT: file not found'), shouldFailSafe: false },
        { error: new Error('Configuration option invalid'), shouldFailSafe: false }
      ];

      for (const { error, shouldFailSafe } of testCases) {
        const result = errorHandler.shouldFailSafe(error);
        expect(result).toBe(shouldFailSafe);
      }
    });

    it('should default to fail-safe for unknown error types', () => {
      const unknownErrors = [
        new Error('Random error message'),
        new Error(''),
        'string error',
        { message: 'object error' },
        null,
        undefined
      ];

      for (const error of unknownErrors) {
        const result = errorHandler.shouldFailSafe(error);
        expect(result).toBe(true); // Should default to safe
      }
    });

    it('should respect fail-safe configuration', () => {
      const noFailSafeHandler = new SecureErrorHandler({ failSafe: false });
      
      const securityError = new Error('Security violation');
      const fsError = new Error('ENOENT: file not found');
      
      expect(noFailSafeHandler.shouldFailSafe(securityError)).toBe(false);
      expect(noFailSafeHandler.shouldFailSafe(fsError)).toBe(false);
    });
  });

  describe('Error Recovery Actions', () => {
    it('should provide recovery actions for filesystem errors', () => {
      const fsError = errorHandler.handle(
        new Error('ENOENT: file not found'),
        { filePath: '/test/file.txt' }
      );
      
      const recoveryAction = errorHandler.createRecoveryAction(fsError);
      expect(recoveryAction).not.toBeNull();
      expect(typeof recoveryAction).toBe('function');
    });

    it('should provide recovery actions for permission errors', () => {
      const permError = errorHandler.handle(
        new Error('Permission denied'),
        { operation: 'file_write' }
      );
      
      const recoveryAction = errorHandler.createRecoveryAction(permError);
      expect(recoveryAction).not.toBeNull();
      expect(typeof recoveryAction).toBe('function');
    });

    it('should provide recovery actions for configuration errors', () => {
      const configError = errorHandler.handle(
        new Error('Invalid configuration option'),
        { setting: 'timeout' }
      );
      
      const recoveryAction = errorHandler.createRecoveryAction(configError);
      expect(recoveryAction).not.toBeNull();
      expect(typeof recoveryAction).toBe('function');
    });

    it('should return null for unrecoverable errors', () => {
      const securityError = errorHandler.handle(
        new Error('Security violation detected')
      );
      
      const recoveryAction = errorHandler.createRecoveryAction(securityError);
      expect(recoveryAction).toBeNull();
    });
  });

  describe('Error Message Formatting', () => {
    it('should format critical errors with appropriate prefix', () => {
      const criticalError = errorHandler.handle(
        new Error('System compromise detected')
      );
      
      const formatted = errorHandler.formatForUser(criticalError);
      expect(formatted).toMatch(/^❌ Critical Error:/);
    });

    it('should format high severity errors with appropriate prefix', () => {
      const highError = errorHandler.handle(
        new Error('Access denied')
      );
      
      const formatted = errorHandler.formatForUser(highError);
      expect(formatted).toMatch(/^🚨 Error:/);
    });

    it('should format warnings with appropriate prefix', () => {
      const warningError = errorHandler.handle(
        new Error('Permission change detected')
      );
      
      const formatted = errorHandler.formatForUser(warningError);
      expect(formatted).toMatch(/^⚠️/);
    });

    it('should format info messages with appropriate prefix', () => {
      const infoError = errorHandler.handle(
        new Error('Configuration updated')
      );
      
      const formatted = errorHandler.formatForUser(infoError);
      expect(formatted).toMatch(/^ℹ️/);
    });
  });

  describe('Logging Security', () => {
    it('should log errors without sensitive information', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const handlerWithLogging = new SecureErrorHandler({ 
        logErrors: true,
        sanitizeMessages: true 
      });
      
      const sensitiveError = new Error('Failed to access /Users/admin/.ssh/id_rsa');
      handlerWithLogging.handle(sensitiveError, { 
        apiKey: 'secret123',
        filePath: '/Users/admin/document.txt' 
      });
      
      // Should have logged something
      expect(consoleSpy).toHaveBeenCalled();
      
      // Check that logged content doesn't contain sensitive info
      const loggedContent = consoleSpy.mock.calls[0]?.[1];
      if (typeof loggedContent === 'string') {
        expect(loggedContent).toContain('[REDACTED]');
        expect(loggedContent).not.toContain('/Users/admin');
        expect(loggedContent).not.toContain('secret123');
      }
      
      consoleSpy.mockRestore();
    });

    it('should not include stack traces when disabled', () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const handlerWithLogging = new SecureErrorHandler({ 
        logErrors: true,
        includeStackTrace: false 
      });
      
      const errorWithStack = new Error('Test error');
      handlerWithLogging.handle(errorWithStack);
      
      // Should not log stack trace
      const logCalls = consoleSpy.mock.calls;
      const hasStackTrace = logCalls.some(call => 
        call.some(arg => 
          typeof arg === 'string' && arg.includes('Stack trace:')
        )
      );
      
      expect(hasStackTrace).toBe(false);
      
      consoleSpy.mockRestore();
    });
  });

  describe('Non-Error Input Handling', () => {
    it('should handle string errors', () => {
      const stringError = 'This is a string error';
      const handled = errorHandler.handle(stringError);
      
      expect(handled.message).toBe(stringError);
      expect(handled.category).toBe(ErrorCategory.UNKNOWN);
    });

    it('should handle object errors', () => {
      const objectError = { message: 'Object error', code: 123 };
      const handled = errorHandler.handle(objectError);
      
      expect(handled.message).toContain('Object error');
      expect(handled.category).toBe(ErrorCategory.UNKNOWN);
    });

    it('should handle null and undefined errors', () => {
      const nullHandled = errorHandler.handle(null);
      const undefinedHandled = errorHandler.handle(undefined);
      
      expect(nullHandled.message).toBe('An unexpected error occurred');
      expect(undefinedHandled.message).toBe('An unexpected error occurred');
    });
  });

  describe('Security Regression Tests', () => {
    it('should consistently sanitize known attack vectors', () => {
      const attackVectors = [
        ...MALICIOUS_INPUTS.pathTraversal,
        ...MALICIOUS_INPUTS.commandInjection,
        ...MALICIOUS_INPUTS.xssPatterns,
        ...MALICIOUS_INPUTS.sqlInjection
      ];

      for (const attack of attackVectors) {
        const error = new Error(`Operation failed: ${attack}`);
        const handled = errorHandler.handle(error);
        
        // Should be sanitized
        SecurityAssertions.assertSanitizedError(handled.message);
        
        // Should not contain the original attack vector
        expect(handled.message.toLowerCase()).not.toContain(attack.toLowerCase());
      }
    });

    it('should maintain sanitization under load', () => {
      const sensitiveError = new Error('Access denied to /Users/admin/.ssh/id_rsa');
      
      // Process many errors to test consistency
      for (let i = 0; i < 1000; i++) {
        const handled = errorHandler.handle(sensitiveError);
        
        expect(handled.message).toContain('[REDACTED]');
        expect(handled.message).not.toContain('/Users/admin');
        SecurityAssertions.assertSanitizedError(handled.message);
      }
    });

    it('should not be bypassable through encoding', () => {
      const encodedSensitiveInfo = [
        'Path: %2FUsers%2Fadmin%2F.ssh%2Fid_rsa',
        'Token: \\x65\\x79\\x4a\\x68\\x62\\x47\\x63\\x69\\x4f\\x69\\x4a\\x49\\x55\\x7a\\x49\\x31\\x4e\\x69\\x4a\\x39',
        'IP: \\x31\\x39\\x32\\x2e\\x31\\x36\\x38\\x2e\\x31\\x2e\\x31\\x30\\x30'
      ];

      for (const encoded of encodedSensitiveInfo) {
        const error = new Error(`Failed: ${encoded}`);
        const handled = errorHandler.handle(error);
        
        SecurityAssertions.assertSanitizedError(handled.message);
        // Should be sanitized regardless of encoding
        expect(handled.message).toContain('[REDACTED]');
      }
    });
  });

  describe('Performance and Resource Management', () => {
    it('should handle large error messages efficiently', () => {
      const largeMessage = 'Error: ' + 'x'.repeat(100000);
      const largeError = new Error(largeMessage);
      
      const startTime = Date.now();
      const handled = errorHandler.handle(largeError);
      const duration = Date.now() - startTime;
      
      // Should complete quickly
      expect(duration).toBeLessThan(1000);
      
      // Should truncate large messages
      expect(handled.message.length).toBeLessThan(500);
    });

    it('should not consume excessive memory', () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Process many errors
      for (let i = 0; i < 10000; i++) {
        const error = new Error(`Error ${i} with sensitive data /Users/admin/file${i}.txt`);
        errorHandler.handle(error, { 
          index: i, 
          sensitiveData: `secret-${i}` 
        });
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Should not leak significant memory
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024); // 50MB
    });
  });
});