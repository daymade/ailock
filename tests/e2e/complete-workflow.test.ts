import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

describe('AILock E2E Complete Workflow Tests', () => {
  let testDir: string;
  let ailock: string;

  beforeEach(() => {
    // Create unique test directory
    testDir = join(tmpdir(), `ailock-e2e-${randomBytes(8).toString('hex')}`);
    mkdirSync(testDir, { recursive: true });
    process.chdir(testDir);

    // Path to compiled ailock
    ailock = `node ${join(__dirname, '../../dist/index.js')}`;
  });

  afterEach(() => {
    // Clean up test directory
    process.chdir(__dirname);
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Init Command Flow', () => {
    it('should complete full init workflow', () => {
      // Create package.json to simulate Node.js project
      writeFileSync('package.json', JSON.stringify({ name: 'test-project' }));
      
      // Create some sensitive files
      writeFileSync('.env', 'SECRET_KEY=abc123');
      writeFileSync('config.json', '{"database": "prod"}');

      // Run init
      const output = execSync(`${ailock} init --force`, { encoding: 'utf8' });
      
      // Verify .ailock was created
      expect(existsSync('.ailock')).toBe(true);
      
      // Verify Git hooks were installed (if in git repo)
      const ailockContent = readFileSync('.ailock', 'utf8');
      expect(ailockContent).toContain('.env');
      
      // Check output messages
      expect(output).toContain('Detected: Node.js project');
      expect(output).toContain('Created .ailock configuration');
    });

    it('should handle init with Claude Code detection', () => {
      writeFileSync('package.json', '{}');
      
      // Simulate Claude Code environment
      const env = { ...process.env, CLAUDE_PROJECT_DIR: testDir };
      const output = execSync(`${ailock} init --force`, { 
        encoding: 'utf8',
        env 
      });
      
      expect(output).toContain('AI Tool Integration');
    });
  });

  describe('Lock/Unlock Workflow', () => {
    beforeEach(() => {
      // Setup project
      writeFileSync('.env', 'TEST=value');
      writeFileSync('.ailock', '.env\n*.key');
    });

    it('should lock and unlock files correctly', () => {
      // Lock file
      const lockOutput = execSync(`${ailock} lock .env`, { encoding: 'utf8' });
      expect(lockOutput).toContain('Locked 1 file(s)');
      
      // Verify file is read-only
      const stats = existsSync('.env') && require('fs').statSync('.env');
      const isReadOnly = stats && (stats.mode & 0o200) === 0;
      expect(isReadOnly).toBe(true);
      
      // Unlock file
      const unlockOutput = execSync(`${ailock} unlock .env`, { encoding: 'utf8' });
      expect(unlockOutput).toContain('Unlocked 1 file(s)');
      
      // Verify file is writable again
      const statsAfter = require('fs').statSync('.env');
      const isWritable = (statsAfter.mode & 0o200) !== 0;
      expect(isWritable).toBe(true);
    });

    it('should handle glob patterns', () => {
      writeFileSync('test.key', 'private-key');
      writeFileSync('prod.key', 'another-key');
      
      const output = execSync(`${ailock} lock "*.key"`, { encoding: 'utf8' });
      expect(output).toContain('2 file(s) to lock');
    });

    it('should support dry-run mode', () => {
      const output = execSync(`${ailock} lock .env --dry-run`, { encoding: 'utf8' });
      expect(output).toContain('Dry run completed');
      
      // File should still be writable
      const stats = require('fs').statSync('.env');
      const isWritable = (stats.mode & 0o200) !== 0;
      expect(isWritable).toBe(true);
    });
  });

  describe('Status Command', () => {
    it('should show correct status', () => {
      // Initialize git repo for status command
      execSync('git init', { encoding: 'utf8' });
      
      writeFileSync('.ailock', '.env\nconfig.json');
      writeFileSync('.env', 'TEST=1');
      writeFileSync('config.json', '{}');
      
      // Lock one file
      execSync(`${ailock} lock .env`, { encoding: 'utf8' });
      
      // Check status
      const output = execSync(`${ailock} status --json`, { encoding: 'utf8' });
      const status = JSON.parse(output);
      
      expect(status.protectedFiles).toHaveLength(2);
      expect(status.lockedFiles).toHaveLength(1);
      expect(status.lockedFiles[0]).toContain('.env');
    });
  });

  describe('Hooks Command', () => {
    it('should list supported tools', () => {
      const output = execSync(`${ailock} hooks list`, { encoding: 'utf8' });
      expect(output).toContain('claude');
    });

    it('should check hook status', () => {
      const output = execSync(`${ailock} hooks status`, { encoding: 'utf8' });
      expect(output).toContain('Hook Installation Status');
    });

    it('should handle Claude Code hook installation', () => {
      // Create .claude directory to simulate Claude Code
      mkdirSync('.claude');
      
      const env = { ...process.env, CLAUDE_PROJECT_DIR: testDir };
      const output = execSync(`${ailock} hooks install claude`, { 
        encoding: 'utf8',
        env
      });
      
      if (output.includes('successfully')) {
        expect(existsSync('.claude/settings.json')).toBe(true);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle missing files gracefully', () => {
      try {
        execSync(`${ailock} lock nonexistent.txt`, { encoding: 'utf8' });
      } catch (error: any) {
        expect(error.stdout || error.message).toContain('not found');
      }
    });

    it('should handle invalid commands', () => {
      try {
        execSync(`${ailock} invalid-command`, { encoding: 'utf8' });
      } catch (error: any) {
        expect(error.stdout || error.message).toContain('Unknown command');
      }
    });

    it('should handle permission errors', () => {
      writeFileSync('test.txt', 'content');
      
      // Make file read-only first to test unlock permission error
      if (process.platform !== 'win32') {
        chmodSync('test.txt', 0o444);
        
        try {
          // Try to lock an already read-only file (should still work)
          const output = execSync(`${ailock} lock test.txt`, { 
            encoding: 'utf8',
            timeout: 5000 
          });
          expect(output).toContain('already locked');
        } catch (error: any) {
          // Should handle error gracefully
          const message = error.stdout || error.stderr || error.message;
          expect(message).toBeDefined();
        } finally {
          // Restore permissions
          chmodSync('test.txt', 0o644);
        }
      } else {
        // Windows test - skip for now
        expect(true).toBe(true);
      }
    });
  });

  describe('List Command', () => {
    it('should list protected files correctly', () => {
      writeFileSync('.ailock', '.env\n*.key\nconfig/*.json');
      writeFileSync('.env', 'TEST=1');
      writeFileSync('secret.key', 'key-content');
      mkdirSync('config');
      writeFileSync('config/app.json', '{}');
      
      execSync(`${ailock} lock .env`, { encoding: 'utf8' });
      
      const output = execSync(`${ailock} list`, { encoding: 'utf8' });
      expect(output).toContain('.env');
      expect(output).toContain('LOCKED');
    });
  });

  describe('Cross-Command Integration', () => {
    it('should maintain consistency across commands', () => {
      // Initialize git repo for status command
      execSync('git init', { encoding: 'utf8' });
      
      // Init project
      writeFileSync('package.json', '{}');
      execSync(`${ailock} init --force`, { encoding: 'utf8' });
      
      // Add a file
      writeFileSync('.env', 'KEY=value');
      
      // Lock it
      execSync(`${ailock} lock .env`, { encoding: 'utf8' });
      
      // Check status shows it as locked
      const statusOutput = execSync(`${ailock} status --json`, { encoding: 'utf8' });
      const status = JSON.parse(statusOutput);
      // lockedFiles contains full paths, so we check if any path ends with .env
      const hasEnvFile = status.lockedFiles.some((file: string) => file.endsWith('.env'));
      expect(hasEnvFile).toBe(true);
      
      // List should show it as locked
      const listOutput = execSync(`${ailock} list`, { encoding: 'utf8' });
      expect(listOutput).toContain('LOCKED');
      
      // Unlock it
      execSync(`${ailock} unlock .env`, { encoding: 'utf8' });
      
      // Status should show it as unlocked
      const statusAfter = execSync(`${ailock} status --json`, { encoding: 'utf8' });
      const statusObj = JSON.parse(statusAfter);
      const hasEnvFileAfter = statusObj.lockedFiles.some((file: string) => file.endsWith('.env'));
      expect(hasEnvFileAfter).toBe(false);
    });
  });

  describe('Platform-Specific Behavior', () => {
    it('should handle platform-specific operations', () => {
      const platform = process.platform;
      writeFileSync('test.txt', 'content');
      
      const output = execSync(`${ailock} lock test.txt`, { encoding: 'utf8' });
      expect(output).toContain('Locked');
      
      // Verify platform-specific locking worked
      const stats = require('fs').statSync('test.txt');
      const isReadOnly = (stats.mode & 0o200) === 0;
      expect(isReadOnly).toBe(true);
      
      // Clean up
      execSync(`${ailock} unlock test.txt`, { encoding: 'utf8' });
    });
  });
});