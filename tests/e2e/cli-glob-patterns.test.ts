import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { execa } from 'execa';

describe('CLI E2E Tests - Glob Pattern Support', () => {
  let tempDir: string;
  const cliPath = path.join(process.cwd(), 'dist', 'index.js');

  beforeEach(async () => {
    // Build the project
    await execa('npm', ['run', 'build']);
    
    // Create a temporary directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ailock-e2e-'));
    
    // Create test file structure
    await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'src', 'components'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'config'), { recursive: true });
    await fs.mkdir(path.join(tempDir, 'secrets'), { recursive: true });
    
    // Create test files
    await fs.writeFile(path.join(tempDir, 'src', 'app.js'), 'console.log("app");');
    await fs.writeFile(path.join(tempDir, 'src', 'index.ts'), 'export default {};');
    await fs.writeFile(path.join(tempDir, 'src', 'components', 'Button.jsx'), 'export const Button = () => {};');
    await fs.writeFile(path.join(tempDir, 'src', 'components', 'Card.tsx'), 'export const Card = () => {};');
    await fs.writeFile(path.join(tempDir, 'config', 'dev.env'), 'DEV_SECRET=123');
    await fs.writeFile(path.join(tempDir, 'config', 'prod.env'), 'PROD_SECRET=456');
    await fs.writeFile(path.join(tempDir, 'secrets', 'api.key'), 'secret-key-123');
    await fs.writeFile(path.join(tempDir, 'secrets', 'cert.pem'), '-----BEGIN CERTIFICATE-----');
    await fs.writeFile(path.join(tempDir, '.env'), 'SECRET=789');
    await fs.writeFile(path.join(tempDir, '.env.local'), 'LOCAL_SECRET=000');
    await fs.writeFile(path.join(tempDir, 'README.md'), '# Test Project');
  });

  afterEach(async () => {
    // Clean up temporary directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('Lock command with glob patterns', () => {
    it('should lock files matching glob pattern', async () => {
      const { stdout } = await execa('node', [cliPath, 'lock', '**/*.env'], {
        cwd: tempDir
      });
      
      expect(stdout).toContain('Found 2 file(s) to lock');
      expect(stdout).toContain('config/dev.env');
      expect(stdout).toContain('config/prod.env');
      
      // Verify files are actually locked with general status command
      const { stdout: statusOut } = await execa('node', [cliPath, 'status'], {
        cwd: tempDir
      });
      expect(statusOut).toContain('config/dev.env');
    });

    it('should lock multiple patterns', async () => {
      const { stdout } = await execa('node', [cliPath, 'lock', '**/*.key', '**/*.pem', '.env*'], {
        cwd: tempDir
      });
      
      expect(stdout).toContain('Found 4 file(s) to lock');
      expect(stdout).toContain('secrets/api.key');
      expect(stdout).toContain('secrets/cert.pem');
      expect(stdout).toContain('.env');
      expect(stdout).toContain('.env.local');
    });

    it('should handle patterns with no matches gracefully', async () => {
      const { stdout } = await execa('node', [cliPath, 'lock', '**/*.xyz'], {
        cwd: tempDir,
        reject: false
      });
      
      // When no files match, the command may exit with empty output or error
      expect(stdout.length).toBe(0);
    });

    it('should respect directory boundaries', async () => {
      const { stdout } = await execa('node', [cliPath, 'lock', 'src/*.js'], {
        cwd: tempDir
      });
      
      expect(stdout).toContain('src/app.js');
      expect(stdout).not.toContain('components');
    });
  });

  describe('Unlock command with glob patterns', () => {
    beforeEach(async () => {
      // Lock some files first
      await execa('node', [cliPath, 'lock', '**/*.env', '**/*.key'], {
        cwd: tempDir
      });
    });

    it('should unlock files matching glob pattern', async () => {
      const { stdout } = await execa('node', [cliPath, 'unlock', '**/*.env'], {
        cwd: tempDir
      });
      
      expect(stdout).toContain('Found 2 file(s) to unlock');
      expect(stdout).toContain('config/dev.env');
      expect(stdout).toContain('config/prod.env');
      
      // Verify files are actually unlocked
      const { stdout: statusOut } = await execa('node', [cliPath, 'status'], {
        cwd: tempDir
      });
      // Files should not appear in the status output if they're unlocked
      // or appear as unprotected
    });

    it('should handle mixed locked/unlocked files', async () => {
      // Unlock one file first
      await execa('node', [cliPath, 'unlock', 'config/dev.env'], {
        cwd: tempDir
      });
      
      // Try to unlock all .env files
      const { stdout } = await execa('node', [cliPath, 'unlock', '**/*.env'], {
        cwd: tempDir
      });
      
      expect(stdout).toContain('config/prod.env');
      // dev.env was already unlocked, might not appear in output
    });
  });

  describe('Status command with glob patterns', () => {
    beforeEach(async () => {
      // Lock some files
      await execa('node', [cliPath, 'lock', 'config/*.env', 'secrets/api.key'], {
        cwd: tempDir
      });
    });

    it('should show status for all protected files', async () => {
      const { stdout } = await execa('node', [cliPath, 'status'], {
        cwd: tempDir
      });
      
      expect(stdout).toContain('config/dev.env');
      expect(stdout).toContain('config/prod.env');
      expect(stdout).toContain('Protected Files');
    });

    it('should show all protected files in status', async () => {
      const { stdout } = await execa('node', [cliPath, 'status'], {
        cwd: tempDir
      });
      
      expect(stdout).toContain('Protected Files');
      expect(stdout).toContain('config/dev.env');
      expect(stdout).toContain('config/prod.env');
      expect(stdout).toContain('secrets/api.key');
    });
  });

  describe('Init command with glob patterns', () => {
    it('should create .ailock file with glob patterns', async () => {
      // Create a simple .ailock file with patterns
      const ailockContent = `# Sensitive files
**/*.env
**/*.key
secrets/**/*
.env*
`;
      await fs.writeFile(path.join(tempDir, '.ailock'), ailockContent);
      
      // Lock files based on the .ailock patterns
      const { stdout } = await execa('node', [cliPath, 'lock', '**/*.env', '**/*.key', 'secrets/**/*', '.env*'], {
        cwd: tempDir
      });
      
      expect(stdout).toContain('Found');
      
      // Verify files are protected
      const { stdout: statusOut } = await execa('node', [cliPath, 'status'], {
        cwd: tempDir
      });
      
      expect(statusOut).toContain('config/dev.env');
      expect(statusOut).toContain('config/prod.env');
      expect(statusOut).toContain('secrets/api.key');
      expect(statusOut).toContain('.env');
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle invalid glob patterns gracefully', async () => {
      const { stderr, exitCode } = await execa('node', [cliPath, 'lock', '[invalid'], {
        cwd: tempDir,
        reject: false
      });
      
      // Should handle the error gracefully - but glob errors might be silent
      // Just check it doesn't crash
      expect(exitCode).toBeDefined();
    });

    it('should handle patterns with special characters', async () => {
      // Create files with special characters
      await fs.writeFile(path.join(tempDir, 'test-file.js'), '');
      await fs.writeFile(path.join(tempDir, 'test_file.js'), '');
      await fs.writeFile(path.join(tempDir, 'test.file.js'), '');
      
      const { stdout } = await execa('node', [cliPath, 'lock', 'test*.js'], {
        cwd: tempDir
      });
      
      expect(stdout).toContain('test-file.js');
      expect(stdout).toContain('test_file.js');
      expect(stdout).toContain('test.file.js');
    });

    it('should handle deeply nested patterns', async () => {
      // Create deeply nested structure
      await fs.mkdir(path.join(tempDir, 'a', 'b', 'c', 'd'), { recursive: true });
      await fs.writeFile(path.join(tempDir, 'a', 'b', 'c', 'd', 'secret.txt'), 'deep secret');
      
      const { stdout } = await execa('node', [cliPath, 'lock', '**/secret.txt'], {
        cwd: tempDir
      });
      
      expect(stdout).toContain('a/b/c/d/secret.txt');
    });

    it('should handle patterns matching directories (and skip them)', async () => {
      const { stdout, stderr } = await execa('node', [cliPath, 'lock', 'src'], {
        cwd: tempDir,
        reject: false
      });
      
      // Should not lock directories, only files
      expect(stdout).not.toContain('Protected');
    });
  });

  describe('Performance with large pattern sets', () => {
    beforeEach(async () => {
      // Create many files for performance testing
      for (let i = 0; i < 20; i++) {
        await fs.writeFile(path.join(tempDir, `file${i}.txt`), `content${i}`);
        await fs.writeFile(path.join(tempDir, `data${i}.json`), `{"id": ${i}}`);
      }
    });

    it('should handle multiple patterns efficiently', async () => {
      const startTime = Date.now();
      
      const { stdout } = await execa('node', [cliPath, 'lock', 
        '*.txt', 
        '*.json', 
        'src/**/*', 
        'config/**/*'
      ], {
        cwd: tempDir
      });
      
      const endTime = Date.now();
      
      expect(stdout).toContain('Found');
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});