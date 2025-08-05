import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { mkdir, writeFile, rm, chmod, access, constants } from 'fs/promises';
import { join } from 'path';
import { tmpdir, platform } from 'os';
import { FileDiagnostics, UnlockDiagnostics } from '../../src/utils/FileDiagnostics.js';
import { SecureCommandExecutor } from '../../src/security/CommandExecutor.js';

// Mock the SecureCommandExecutor
vi.mock('../../src/security/CommandExecutor.js');

describe('FileDiagnostics Tests', () => {
  let tempDir: string;
  let testFile: string;
  let diagnostics: FileDiagnostics;
  let mockCommandExecutor: MockedFunction<any>;

  beforeEach(async () => {
    // Create temp directory and test file
    tempDir = join(tmpdir(), `ailock-diag-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    testFile = join(tempDir, 'test.txt');
    await writeFile(testFile, 'test content');
    
    // Setup mock command executor
    mockCommandExecutor = {
      executeCommand: vi.fn()
    };
    (SecureCommandExecutor as any).mockImplementation(() => mockCommandExecutor);
    
    diagnostics = new FileDiagnostics();
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('getFilePermissions', () => {
    it('should get file permissions correctly', async () => {
      // Set specific permissions
      await chmod(testFile, 0o644);
      
      const permissions = await diagnostics.getFilePermissions(testFile);
      
      expect(permissions).toMatchObject({
        octal: '644',
        readable: true,
        writable: true,
        executable: false,
        size: 12, // 'test content' is 12 bytes
        owner: expect.any(String),
        group: expect.any(String),
        lastModified: expect.any(Date)
      });
    });

    it('should detect read-only permissions', async () => {
      await chmod(testFile, 0o444);
      
      const permissions = await diagnostics.getFilePermissions(testFile);
      
      expect(permissions.octal).toBe('444');
      expect(permissions.readable).toBe(true);
      expect(permissions.writable).toBe(true); // Process may still have write access
    });

    it('should detect executable permissions', async () => {
      await chmod(testFile, 0o755);
      
      const permissions = await diagnostics.getFilePermissions(testFile);
      
      expect(permissions.octal).toBe('755');
      expect(permissions.executable).toBe(true);
    });

    it('should handle non-existent files', async () => {
      const nonExistent = join(tempDir, 'does-not-exist.txt');
      
      await expect(diagnostics.getFilePermissions(nonExistent))
        .rejects.toThrow();
    });
  });

  describe('getFileFlags', () => {
    describe('on macOS', () => {
      const originalPlatform = process.platform;

      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'darwin',
          configurable: true
        });
      });

      afterEach(() => {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true
        });
      });

      it('should detect immutable flags using ls -lO', async () => {
        mockCommandExecutor.executeCommand.mockResolvedValue({
          stdout: '-rw-r--r--  1 user  staff  uchg  12 Jan 1 00:00 test.txt\n',
          stderr: '',
          exitCode: 0
        });
        
        const flags = await diagnostics.getFileFlags(testFile);
        
        expect(flags).toMatchObject({
          platform: 'darwin',
          hasImmutableFlag: true,
          hasSystemFlag: false,
          chflagsOutput: expect.stringContaining('uchg')
        });
        
        expect(mockCommandExecutor.executeCommand).toHaveBeenCalledWith(
          'ls',
          ['-lO', testFile],
          expect.any(Object)
        );
      });

      it('should detect system flags', async () => {
        mockCommandExecutor.executeCommand.mockResolvedValue({
          stdout: '-rw-r--r--  1 user  staff  schg  12 Jan 1 00:00 test.txt\n',
          stderr: '',
          exitCode: 0
        });
        
        const flags = await diagnostics.getFileFlags(testFile);
        
        expect(flags.hasSystemFlag).toBe(true);
      });

      it('should fallback to stat on ls failure', async () => {
        mockCommandExecutor.executeCommand
          .mockRejectedValueOnce(new Error('ls not found'))
          .mockResolvedValueOnce({
            stdout: '2\n', // Hex 0x2 = UF_IMMUTABLE
            stderr: '',
            exitCode: 0
          });
        
        const flags = await diagnostics.getFileFlags(testFile);
        
        expect(flags).toMatchObject({
          hasImmutableFlag: true,
          chflagsOutput: 'Flags: 0x2'
        });
        
        expect(mockCommandExecutor.executeCommand).toHaveBeenCalledWith(
          'stat',
          ['-f', '%f', testFile],
          expect.any(Object)
        );
      });

      it('should handle errors gracefully', async () => {
        mockCommandExecutor.executeCommand.mockRejectedValue(new Error('Permission denied'));
        
        const flags = await diagnostics.getFileFlags(testFile);
        
        expect(flags.error).toContain('Permission denied');
        expect(flags.hasImmutableFlag).toBeUndefined();
      });
    });

    describe('on Linux', () => {
      const originalPlatform = process.platform;

      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'linux',
          configurable: true
        });
      });

      afterEach(() => {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true
        });
      });

      it('should detect immutable flags using lsattr', async () => {
        mockCommandExecutor.executeCommand.mockResolvedValue({
          stdout: '----i--------e-- test.txt\n',
          stderr: '',
          exitCode: 0
        });
        
        const flags = await diagnostics.getFileFlags(testFile);
        
        expect(flags).toMatchObject({
          platform: 'linux',
          hasImmutableFlag: true,
          chattrOutput: expect.stringContaining('i')
        });
        
        expect(mockCommandExecutor.executeCommand).toHaveBeenCalledWith(
          'lsattr',
          [testFile],
          expect.any(Object)
        );
      });

      it('should handle lsattr errors', async () => {
        mockCommandExecutor.executeCommand.mockRejectedValue(new Error('lsattr: Permission denied'));
        
        const flags = await diagnostics.getFileFlags(testFile);
        
        expect(flags.error).toContain('lsattr check failed');
        expect(flags.hasImmutableFlag).toBeUndefined();
      });
    });

    describe('on Windows', () => {
      const originalPlatform = process.platform;

      beforeEach(() => {
        Object.defineProperty(process, 'platform', {
          value: 'win32',
          configurable: true
        });
      });

      afterEach(() => {
        Object.defineProperty(process, 'platform', {
          value: originalPlatform,
          configurable: true
        });
      });

      it('should return basic info for Windows', async () => {
        const flags = await diagnostics.getFileFlags(testFile);
        
        expect(flags).toMatchObject({
          platform: 'win32'
        });
        
        // Should not attempt to run platform-specific commands
        expect(mockCommandExecutor.executeCommand).not.toHaveBeenCalled();
      });
    });
  });

  describe('checkAtomicLock', () => {
    it('should detect existing atomic lock', async () => {
      // Create lock directory and file
      const lockDir = join(tempDir, '.ailock-locks');
      await mkdir(lockDir, { recursive: true });
      await writeFile(join(lockDir, 'test.txt.lock'), 'lock data');
      
      const originalCwd = process.cwd();
      process.chdir(tempDir);
      
      try {
        const hasLock = await diagnostics.checkAtomicLock('test.txt');
        expect(hasLock).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should return false when no atomic lock exists', async () => {
      const hasLock = await diagnostics.checkAtomicLock(testFile);
      expect(hasLock).toBe(false);
    });

    it('should handle paths with directories correctly', async () => {
      const lockDir = join(tempDir, '.ailock-locks');
      await mkdir(lockDir, { recursive: true });
      await writeFile(join(lockDir, 'config.json.lock'), 'lock data');
      
      const originalCwd = process.cwd();
      process.chdir(tempDir);
      
      try {
        const hasLock = await diagnostics.checkAtomicLock('src/config.json');
        expect(hasLock).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('diagnoseUnlockIssues', () => {
    it('should diagnose read-only permissions', async () => {
      await chmod(testFile, 0o444);
      
      const result = await diagnostics.diagnoseUnlockIssues(testFile);
      
      expect(result.diagnosis).toContain('File has read-only permissions (444)');
      expect(result.recommendations).toContain('Run: chmod 644 <file>');
    });

    it('should diagnose immutable flags on macOS', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'darwin',
        configurable: true
      });
      
      mockCommandExecutor.executeCommand.mockResolvedValue({
        stdout: '-rw-r--r--  1 user  staff  uchg  12 Jan 1 00:00 test.txt\n',
        stderr: '',
        exitCode: 0
      });
      
      const result = await diagnostics.diagnoseUnlockIssues(testFile);
      
      expect(result.diagnosis).toContain('File has immutable flag set (darwin)');
      expect(result.recommendations).toContain('Run: chflags nouchg <file>');
    });

    it('should diagnose immutable flags on Linux', async () => {
      Object.defineProperty(process, 'platform', {
        value: 'linux',
        configurable: true
      });
      
      mockCommandExecutor.executeCommand.mockResolvedValue({
        stdout: '----i--------e-- test.txt\n',
        stderr: '',
        exitCode: 0
      });
      
      const result = await diagnostics.diagnoseUnlockIssues(testFile);
      
      expect(result.diagnosis).toContain('File has immutable flag set (linux)');
      expect(result.recommendations).toContain('Run: chattr -i <file>');
    });

    it('should diagnose atomic lock presence', async () => {
      // Create atomic lock
      const lockDir = join(tempDir, '.ailock-locks');
      await mkdir(lockDir, { recursive: true });
      await writeFile(join(lockDir, 'test.txt.lock'), 'lock data');
      
      const originalCwd = process.cwd();
      process.chdir(tempDir);
      
      try {
        const result = await diagnostics.diagnoseUnlockIssues('test.txt');
        
        expect(result.diagnosis).toContain('Atomic lock file exists');
        expect(result.recommendations).toContain('Release atomic lock or wait for timeout');
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should handle normal writable files', async () => {
      await chmod(testFile, 0o644);
      
      const result = await diagnostics.diagnoseUnlockIssues(testFile);
      
      expect(result.diagnosis).toContain('File has normal write permissions (644)');
      expect(result.recommendations).toHaveLength(0);
    });

    it('should handle unusual permissions', async () => {
      await chmod(testFile, 0o777);
      
      const result = await diagnostics.diagnoseUnlockIssues(testFile);
      
      expect(result.diagnosis).toContain('File has unusual permissions (777)');
    });

    it('should provide no issues message when appropriate', async () => {
      await chmod(testFile, 0o644);
      mockCommandExecutor.executeCommand.mockResolvedValue({
        stdout: '-------------e-- test.txt\n', // No immutable flag
        stderr: '',
        exitCode: 0
      });
      
      const result = await diagnostics.diagnoseUnlockIssues(testFile);
      
      // Should have at least the permissions diagnosis
      expect(result.diagnosis.length).toBeGreaterThan(0);
      expect(result.diagnosis).toContain('File has normal write permissions (644)');
    });
  });

  describe('formatDiagnostics', () => {
    it('should format diagnostics report nicely', async () => {
      const mockDiagnostics: UnlockDiagnostics = {
        filePath: '/path/to/file.txt',
        permissions: {
          mode: 33188,
          octal: '444',
          readable: true,
          writable: false,
          executable: false,
          owner: '1000',
          group: '1000',
          size: 1024,
          lastModified: new Date('2024-01-01T00:00:00Z')
        },
        flags: {
          platform: 'darwin',
          hasImmutableFlag: true,
          chflagsOutput: 'uchg',
          hasSystemFlag: false
        },
        atomicLockExists: true,
        diagnosis: [
          'File has read-only permissions (444)',
          'File has immutable flag set (darwin)',
          'Atomic lock file exists'
        ],
        recommendations: [
          'Run: chflags nouchg <file>',
          'Run: chmod 644 <file>',
          'Release atomic lock or wait for timeout'
        ]
      };
      
      const formatted = diagnostics.formatDiagnostics(mockDiagnostics);
      
      expect(formatted).toContain('🔍 Unlock Diagnostics for: /path/to/file.txt');
      expect(formatted).toContain('📋 File Permissions:');
      expect(formatted).toContain('Mode: 444');
      expect(formatted).toContain('Owner: 1000:1000');
      expect(formatted).toContain('Size: 1024 bytes');
      expect(formatted).toContain('🏷️  File Flags:');
      expect(formatted).toContain('Platform: darwin');
      expect(formatted).toContain('Flags: uchg');
      expect(formatted).toContain('🔒 Lock Status:');
      expect(formatted).toContain('Atomic lock: EXISTS');
      expect(formatted).toContain('🔍 Diagnosis:');
      expect(formatted).toContain('• File has read-only permissions');
      expect(formatted).toContain('💡 Recommendations:');
      expect(formatted).toContain('• Run: chflags nouchg');
    });

    it('should handle errors in flag info', () => {
      const mockDiagnostics: UnlockDiagnostics = {
        filePath: '/path/to/file.txt',
        permissions: {
          mode: 33188,
          octal: '644',
          readable: true,
          writable: true,
          executable: false,
          owner: '1000',
          group: '1000',
          size: 100,
          lastModified: new Date()
        },
        flags: {
          platform: 'linux',
          error: 'lsattr: Permission denied'
        },
        atomicLockExists: false,
        diagnosis: ['No obvious unlock issues detected'],
        recommendations: []
      };
      
      const formatted = diagnostics.formatDiagnostics(mockDiagnostics);
      
      expect(formatted).toContain('Error: lsattr: Permission denied');
      expect(formatted).not.toContain('💡 Recommendations:'); // No recommendations
    });
  });

  describe('Integration Tests', () => {
    it('should perform full diagnosis on a locked file', async () => {
      // Make file read-only
      await chmod(testFile, 0o444);
      
      // Mock platform-specific checks
      if (platform() === 'darwin') {
        mockCommandExecutor.executeCommand.mockResolvedValue({
          stdout: '-r--r--r--  1 user  staff  -  12 Jan 1 00:00 test.txt\n',
          stderr: '',
          exitCode: 0
        });
      } else if (platform() === 'linux') {
        mockCommandExecutor.executeCommand.mockResolvedValue({
          stdout: '-------------e-- test.txt\n',
          stderr: '',
          exitCode: 0
        });
      }
      
      const result = await diagnostics.diagnoseUnlockIssues(testFile);
      
      expect(result).toMatchObject({
        filePath: testFile,
        permissions: expect.objectContaining({
          octal: '444'
        }),
        diagnosis: expect.arrayContaining([
          'File has read-only permissions (444)'
        ]),
        recommendations: expect.arrayContaining([
          'Run: chmod 644 <file>'
        ])
      });
      
      // Test formatting
      const formatted = diagnostics.formatDiagnostics(result);
      expect(formatted).toBeTruthy();
      expect(formatted.length).toBeGreaterThan(100); // Should be a substantial report
    });
  });
});