import { tmpdir } from 'os';
import { mkdir, rmdir, writeFile } from 'fs/promises';
import path from 'path';
import { expect } from 'vitest';

/**
 * Security test environment manager for isolated testing
 */
export class SecurityTestEnvironment {
  private testDirs: string[] = [];
  private testFiles: string[] = [];

  /**
   * Creates a temporary directory for testing
   */
  async createTempDir(): Promise<string> {
    const tempDir = path.join(tmpdir(), `ailock-test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    await mkdir(tempDir, { recursive: true, mode: 0o755 });
    this.testDirs.push(tempDir);
    return tempDir;
  }

  /**
   * Creates a test file with specified content
   */
  async createTestFile(dir: string, filename: string, content: string = 'test content'): Promise<string> {
    const filePath = path.join(dir, filename);
    await writeFile(filePath, content, { mode: 0o644 });
    this.testFiles.push(filePath);
    return filePath;
  }

  /**
   * Cleanup all test resources
   */
  async cleanup(): Promise<void> {
    // Clean up files first
    for (const file of this.testFiles) {
      try {
        await import('fs').then(fs => fs.promises.unlink(file));
      } catch {
        // Ignore cleanup errors
      }
    }

    // Clean up directories
    for (const dir of this.testDirs) {
      try {
        await rmdir(dir, { recursive: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    this.testDirs = [];
    this.testFiles = [];
  }
}

/**
 * Collection of malicious inputs for security testing
 */
export const MALICIOUS_INPUTS = {
  /**
   * Path traversal attack vectors (safe test patterns)
   */
  pathTraversal: [
    '../../../safe-test-file',
    '..\\..\\..\\test-directory\\test-file',
    '/test/safe-file',
    'C:\\TestDir\\test-file',
    '....//....//....//test-file',
    '..%2F..%2F..%2Ftest-file',
    '..%252F..%252F..%252Ftest-file',
    '../test-file%00.txt',
    '../../test/safe-file',
    '~/../../test-file',
    '/test/safe-directory/file',
    '\\\\..\\\\..\\\\..\\\\test\\\\file'
  ],

  /**
   * Command injection attack vectors (safe test patterns)
   */
  commandInjection: [
    '; echo test-command',
    '&& echo malicious-test',
    '| cat test-file',
    '`echo test-output`',
    '$(echo test-substitution)',
    '; echo test-comment #',
    '& echo background-test &',
    '|| echo fallback-test',
    '>& /dev/null 0>&1',
    '; echo "test command injection"'
  ],

  /**
   * Special characters that could cause issues
   */
  specialCharacters: [
    '\0',                           // Null byte
    '\x01\x02\x03\x04\x05',       // Control characters
    '\x1b[31mRed\x1b[0m',         // ANSI escape sequences
    '\r\n',                        // CRLF injection
    '\t\v\f',                      // Whitespace characters
    String.fromCharCode(127),       // DEL character
    '\u0000\u0001\u0002',         // Unicode control chars
    '\uFEFF',                      // Byte order mark
    '\u200E\u200F',               // Unicode direction marks
    '\\x41\\x42\\x43'             // Escaped characters
  ],

  /**
   * Dangerous filenames
   */
  dangerousFilenames: [
    'CON', 'PRN', 'AUX', 'NUL',           // Windows reserved names
    'COM1', 'COM2', 'LPT1', 'LPT2',       // Windows device names
    '..',                                   // Parent directory
    '.',                                    // Current directory
    ' ',                                    // Space only
    '..\\..\\..\\file.txt',               // Path traversal in name
    'file\0hidden.txt',                    // Null byte injection
    'file:with:colons',                    // Colon separator
    'file<with>brackets',                  // Angle brackets
    'file*with*wildcards',                 // Wildcards
    'file|with|pipes',                     // Pipe characters
    'file"with"quotes',                    // Quote characters
    'file with trailing space ',          // Trailing space
    '.hiddenfile',                         // Hidden file
    'verylongfilename'.repeat(50),        // Very long filename
    String.fromCharCode(0x202E) + 'exe.txt' // Unicode RLO attack
  ],

  /**
   * Environment variable injection attempts
   */
  environmentInjection: [
    'PATH=/test/safe:$PATH',
    'LD_PRELOAD=/test/safe.so',
    'SHELL=/test/safe-shell',
    'IFS=$\'\\t\\n\'; echo test',
    'PS1=`echo test`',
    'HOME=../../../test-home',
    'TMP=/test/$(echo safe)',
    'USER=testuser; echo test',
    '$VARIABLE=test-value',
    '${IFS}echo${IFS}test-file'
  ],

  /**
   * Glob pattern attacks
   */
  globPatterns: [
    '../**/*',                       // Traversal glob
    '$(echo test)/*',               // Command substitution
    '`echo test`/**',               // Backtick substitution
    '/test/path/**',                // Absolute path glob
    '~/test/**',                    // Home directory access
    '**/../../test-file',           // Traversal with glob
    '**/*$(echo test)*',            // Command injection in glob
    '{/test/file1,/test/file2}',    // Brace expansion
    '*.{txt,log,cfg}',              // Safe file extensions
    '[a-z]*/../../*'                // Character class with traversal
  ],

  /**
   * SQL injection patterns (for testing input sanitization)
   */
  sqlInjection: [
    "'; DROP TABLE test_table; --",
    "' OR '1'='1",
    "'; SELECT test FROM test_table; --",
    "' UNION SELECT test FROM test_table --",
    "'; INSERT INTO test_table VALUES ('test', 'safe'); --"
  ],

  /**
   * XSS patterns (for testing input sanitization)
   */
  xssPatterns: [
    '<script>console.log("Test")</script>',
    '<img src=x onerror=console.log("Test")>',
    'javascript:console.log("Test")',
    '<svg onload=console.log("Test")>',
    '<iframe src="javascript:console.log(\'Test\')"></iframe>',
    '"><script>console.log("Test")</script>',
    '<script src="http://test.com/test.js"></script>'
  ]
};

/**
 * Test timing utilities for race condition testing
 */
export class TimingUtils {
  /**
   * Sleep for specified milliseconds
   */
  static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute multiple promises concurrently and collect results
   */
  static async executeConCurrently<T>(
    operations: (() => Promise<T>)[],
    maxConcurrency: number = 10
  ): Promise<PromiseSettledResult<T>[]> {
    const results: PromiseSettledResult<T>[] = [];
    
    for (let i = 0; i < operations.length; i += maxConcurrency) {
      const batch = operations.slice(i, i + maxConcurrency);
      const batchPromises = batch.map(op => op());
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults);
    }
    
    return results;
  }

  /**
   * Measure execution time of an operation
   */
  static async measureTime<T>(operation: () => Promise<T>): Promise<{ result: T; timeMs: number }> {
    const start = Date.now();
    const result = await operation();
    const timeMs = Date.now() - start;
    
    return { result, timeMs };
  }
}

/**
 * Mock utilities for testing
 */
export class MockUtils {
  /**
   * Creates a mock function that fails after N calls
   */
  static createFailAfterNCalls<T>(n: number, error: Error) {
    let callCount = 0;
    return () => {
      callCount++;
      if (callCount > n) {
        return Promise.reject(error);
      }
      return Promise.resolve({} as T);
    };
  }

  /**
   * Creates a mock that intermittently fails
   */
  static createIntermittentFailure<T>(
    failureRate: number,
    error: Error
  ) {
    return () => {
      if (Math.random() < failureRate) {
        return Promise.reject(error);
      }
      return Promise.resolve({} as T);
    };
  }
}

/**
 * Security assertion helpers
 */
export class SecurityAssertions {
  /**
   * Assert that a string doesn't contain sensitive information
   */
  static assertNoSensitiveInfo(text: string, context: string = ''): void {
    const sensitivePatterns = [
      /\/Users\/[^\/\s]+/,                    // macOS user paths
      /\/home\/[^\/\s]+/,                     // Linux home paths
      /C:\\Users\\[^\\s]+/,                   // Windows user paths
      /password/i,                            // Password mentions
      /secret/i,                              // Secret mentions
      /token/i,                               // Token mentions
      /key/i,                                 // Key mentions
      /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, // IP addresses
      /[a-f0-9]{32,}/,                        // Hex strings (potential hashes)
      /[A-Za-z0-9+\/]{20,}={0,2}/             // Base64 strings
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(text)) {
        throw new Error(
          `Sensitive information detected in ${context}: ${pattern.source}`
        );
      }
    }
  }

  /**
   * Assert that an error message is properly sanitized
   */
  static assertSanitizedError(error: Error | string): void {
    const message = typeof error === 'string' ? error : error.message;
    
    // Should contain redaction markers
    expect(message).toMatch(/\[REDACTED\]/);
    
    // Should not contain sensitive patterns
    this.assertNoSensitiveInfo(message, 'error message');
    
    // Should not be too long
    expect(message.length).toBeLessThan(500);
  }

  /**
   * Assert that a path is properly sanitized
   */
  static assertSanitizedPath(originalPath: string, sanitizedPath: string): void {
    // Should not contain traversal patterns
    expect(sanitizedPath).not.toMatch(/\.\./);
    expect(sanitizedPath).not.toMatch(/\/\.\./);
    expect(sanitizedPath).not.toMatch(/\\\.\./);
    
    // Should not contain dangerous characters
    expect(sanitizedPath).not.toMatch(/[<>:|?*\0]/);
    
    // Should not be absolute if original wasn't meant to be
    if (!path.isAbsolute(originalPath)) {
      expect(path.isAbsolute(sanitizedPath)).toBe(false);
    }
  }

  /**
   * Assert that command arguments are safe
   */
  static assertSafeCommandArgs(args: string[]): void {
    const dangerousChars = /[;&|`$(){}[\]<>]/;
    
    for (const arg of args) {
      expect(typeof arg).toBe('string');
      expect(arg).not.toMatch(dangerousChars);
      expect(arg).not.toContain('\0');
      expect(arg.length).toBeLessThan(5000); // Reasonable length limit
    }
  }
}

/**
 * Platform-specific test utilities
 */
export class PlatformUtils {
  /**
   * Get platform-specific dangerous paths
   */
  static getDangerousPaths(): string[] {
    const platform = process.platform;
    
    const commonPaths = ['/test/safe-file', '/test/config', '/test/.ssh/test_key'];
    
    if (platform === 'win32') {
      return [
        'C:\\Test\\Config\\test-file',
        'C:\\Test\\Config\\test-hosts',
        'C:\\Test\\User\\.ssh\\test_key',
        ...commonPaths
      ];
    }
    
    if (platform === 'darwin') {
      return [
        '/Test/Library/Config/test.keychain',
        '/test/config/test.passwd',
        ...commonPaths
      ];
    }
    
    return commonPaths;
  }

  /**
   * Get platform-specific command injection vectors
   */
  static getCommandInjectionVectors(): string[] {
    const platform = process.platform;
    
    const common = [
      '; echo test-command',
      '&& echo test.com',
      '| cat test-file'
    ];
    
    if (platform === 'win32') {
      return [
        '& echo test-command',
        '&& powershell -c "Write-Output test.com"',
        ...common
      ];
    }
    
    return common;
  }

  /**
   * Check if running in a safe test environment
   */
  static isTestEnvironment(): boolean {
    return (
      process.env.NODE_ENV === 'test' ||
      process.env.VITEST === 'true' ||
      process.env.CI === 'true'
    );
  }
}

/**
 * Performance testing utilities
 */
export class PerformanceUtils {
  /**
   * Measure execution time of an operation
   */
  static async measureTime<T>(operation: () => Promise<T>): Promise<{ result: T; timeMs: number }> {
    const start = Date.now();
    const result = await operation();
    const timeMs = Date.now() - start;
    
    return { result, timeMs };
  }

  /**
   * Test memory usage during operation
   */
  static async measureMemoryUsage<T>(
    operation: () => Promise<T>
  ): Promise<{ result: T; memoryDelta: number }> {
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    const initialMemory = process.memoryUsage().heapUsed;
    const result = await operation();
    
    if (global.gc) {
      global.gc();
    }
    
    const finalMemory = process.memoryUsage().heapUsed;
    const memoryDelta = finalMemory - initialMemory;
    
    return { result, memoryDelta };
  }

  /**
   * Test operation under high concurrency
   */
  static async stressTest<T>(
    operation: () => Promise<T>,
    concurrency: number = 100,
    duration: number = 5000
  ): Promise<{
    totalOperations: number;
    successCount: number;
    errorCount: number;
    averageTime: number;
  }> {
    const endTime = Date.now() + duration;
    const results: { success: boolean; time: number }[] = [];
    
    const workers = Array.from({ length: concurrency }, async () => {
      while (Date.now() < endTime) {
        const start = Date.now();
        try {
          await operation();
          results.push({ success: true, time: Date.now() - start });
        } catch {
          results.push({ success: false, time: Date.now() - start });
        }
      }
    });
    
    await Promise.all(workers);
    
    const successCount = results.filter(r => r.success).length;
    const totalOperations = results.length;
    const averageTime = results.reduce((sum, r) => sum + r.time, 0) / totalOperations;
    
    return {
      totalOperations,
      successCount,
      errorCount: totalOperations - successCount,
      averageTime
    };
  }
}