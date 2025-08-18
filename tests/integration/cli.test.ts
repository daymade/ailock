import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { exec } from 'child_process';
import { promisify } from 'util';
import { mkdir, writeFile, rm, access, constants } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

const execAsync = promisify(exec);

describe('CLI Integration Tests', () => {
  let tempDir: string;
  let cliPath: string;
  
  beforeEach(async () => {
    tempDir = join(tmpdir(), `ailock-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
    
    // Use the compiled CLI
    cliPath = join(process.cwd(), 'dist', 'index.js');
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should show help information', async () => {
    const { stdout } = await execAsync(`node "${cliPath}" --help`);
    
    expect(stdout).toContain('AI-Proof File Guard');
    expect(stdout).toContain('lock');
    expect(stdout).toContain('unlock');
  });

  it('should show version information', async () => {
    const { stdout } = await execAsync(`node "${cliPath}" --version`);
    
    expect(stdout.trim()).toBe('1.5.4');
  });

  it('should lock and unlock files with configuration', async () => {
    // Create .ailock configuration
    const ailockContent = `.env
*.key`;
    await writeFile(join(tempDir, '.ailock'), ailockContent);
    
    // Create test files
    await writeFile(join(tempDir, '.env'), 'API_KEY=secret');
    await writeFile(join(tempDir, 'test.key'), 'private key');
    await writeFile(join(tempDir, 'normal.txt'), 'normal file');
    
    // Change to temp directory for CLI execution
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    
    try {
      // Test lock command
      const { stdout: lockOutput } = await execAsync(`node "${cliPath}" lock --verbose`);
      expect(lockOutput).toContain('Using patterns from .ailock');
      expect(lockOutput).toContain('.env');
      expect(lockOutput).toContain('test.key');
      expect(lockOutput).toContain('Locked 2 file(s)');
      
      // Verify files are locked (not writable)
      await expect(access(join(tempDir, '.env'), constants.W_OK)).rejects.toThrow();
      await expect(access(join(tempDir, 'test.key'), constants.W_OK)).rejects.toThrow();
      
      // Normal file should still be writable
      await access(join(tempDir, 'normal.txt'), constants.W_OK);
      
      // Test unlock command
      const { stdout: unlockOutput } = await execAsync(`node "${cliPath}" unlock --verbose`);
      expect(unlockOutput).toContain('Unlocked 2 file(s)');
      expect(unlockOutput).toContain('Remember to lock these files again');
      
      // Verify files are unlocked (writable)
      await access(join(tempDir, '.env'), constants.W_OK);
      await access(join(tempDir, 'test.key'), constants.W_OK);
      
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should handle dry-run mode', async () => {
    // Create .ailock configuration
    await writeFile(join(tempDir, '.ailock'), '.env');
    await writeFile(join(tempDir, '.env'), 'API_KEY=secret');
    
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    
    try {
      // Test dry-run lock
      const { stdout } = await execAsync(`node "${cliPath}" lock --dry-run`);
      expect(stdout).toContain('would be locked');
      expect(stdout).toContain('Dry run completed');
      
      // File should still be writable after dry run
      await access(join(tempDir, '.env'), constants.W_OK);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should handle command line patterns', async () => {
    // Create test files
    await writeFile(join(tempDir, '.env'), 'API_KEY=secret');
    await writeFile(join(tempDir, 'config.json'), '{}');
    
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    
    try {
      // Lock specific files via command line
      const { stdout } = await execAsync(`node "${cliPath}" lock .env config.json --verbose`);
      expect(stdout).toContain('Found 2 file(s) to lock');
      expect(stdout).toContain('.env');
      expect(stdout).toContain('config.json');
      
      // Verify files are locked
      await expect(access(join(tempDir, '.env'), constants.W_OK)).rejects.toThrow();
      await expect(access(join(tempDir, 'config.json'), constants.W_OK)).rejects.toThrow();
      
      // Unlock files before cleanup to avoid permission errors
      await execAsync(`node "${cliPath}" unlock .env config.json`);
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should handle missing configuration gracefully', async () => {
    // No .ailock file, should use defaults
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    
    try {
      const { stdout } = await execAsync(`node "${cliPath}" lock --dry-run --verbose`);
      expect(stdout).toContain('No files found to lock');
    } finally {
      process.chdir(originalCwd);
    }
  });

  it('should handle errors gracefully', async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);
    
    try {
      // Try to lock non-existent file
      const result = await execAsync(`node "${cliPath}" lock non-existent-file.txt`).catch(e => e);
      expect(result.code).not.toBe(0);
    } finally {
      process.chdir(originalCwd);
    }
  });
});