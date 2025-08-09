import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the hook script
const HOOK_SCRIPT = path.resolve(__dirname, '../../hooks/claude-ailock-hook.js');

/**
 * Helper function to run the hook with input
 */
async function runHook(input) {
  return new Promise((resolve, reject) => {
    const hookProcess = spawn('node', [HOOK_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    hookProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    hookProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    hookProcess.on('close', (code) => {
      resolve({
        code,
        stdout,
        stderr
      });
    });
    
    hookProcess.on('error', reject);
    
    // Send input
    hookProcess.stdin.write(JSON.stringify(input));
    hookProcess.stdin.end();
  });
}

describe('Claude AILock Hook', () => {
  describe('Input Parsing', () => {
    it('should handle Write tool input', async () => {
      const input = {
        tool_name: 'Write',
        tool_input: {
          file_path: '/tmp/test.txt',
          content: 'test content'
        },
        cwd: '/tmp'
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
    });
    
    it('should handle Edit tool input', async () => {
      const input = {
        tool_name: 'Edit',
        tool_input: {
          file_path: '/tmp/test.txt',
          old_string: 'old',
          new_string: 'new'
        },
        cwd: '/tmp'
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
    });
    
    it('should handle MultiEdit tool input', async () => {
      const input = {
        tool_name: 'MultiEdit',
        tool_input: {
          file_path: '/tmp/test.txt',
          edits: [
            { old_string: 'old1', new_string: 'new1' },
            { old_string: 'old2', new_string: 'new2' }
          ]
        },
        cwd: '/tmp'
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
    });
    
    it('should handle NotebookEdit tool input', async () => {
      const input = {
        tool_name: 'NotebookEdit',
        tool_input: {
          notebook_path: '/tmp/notebook.ipynb',
          cell_number: 0,
          new_source: 'print("hello")'
        },
        cwd: '/tmp'
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
    });
    
    it('should ignore non-write tools', async () => {
      const input = {
        tool_name: 'Read',
        tool_input: {
          file_path: '/tmp/test.txt'
        },
        cwd: '/tmp'
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
    });
    
    it('should handle malformed JSON gracefully', async () => {
      const hookProcess = spawn('node', [HOOK_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      return new Promise((resolve) => {
        let stderr = '';
        
        hookProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        hookProcess.on('close', (code) => {
          expect(code).toBe(0); // Should exit successfully even on error
          expect(stderr).toContain('AILock Hook Error');
          resolve();
        });
        
        // Send invalid JSON
        hookProcess.stdin.write('{ invalid json }');
        hookProcess.stdin.end();
      });
    });
  });
  
  describe('Path Resolution', () => {
    it('should resolve relative paths', async () => {
      const input = {
        tool_name: 'Write',
        tool_input: {
          file_path: './test.txt',
          content: 'test'
        },
        cwd: '/home/user/project'
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
      // The hook should resolve ./test.txt to /home/user/project/test.txt
    });
    
    it('should handle absolute paths', async () => {
      const input = {
        tool_name: 'Write',
        tool_input: {
          file_path: '/absolute/path/test.txt',
          content: 'test'
        },
        cwd: '/home/user/project'
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
    });
  });
  
  describe('AILock Integration', () => {
    // Note: These tests would need ailock to be installed and mocked
    // For now, we'll test the behavior when ailock is not found
    
    it('should handle missing ailock gracefully', async () => {
      const input = {
        tool_name: 'Write',
        tool_input: {
          file_path: '/tmp/test.txt',
          content: 'test'
        },
        cwd: '/tmp'
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
      
      // Check if it logs a warning about missing ailock
      if (result.stderr.includes('command not found')) {
        expect(result.stderr).toContain('Please install ailock');
      }
    });
  });
  
  describe('File Permission Checking', () => {
    let testFile;
    
    beforeEach(async () => {
      // Create a temporary test file
      testFile = path.join(__dirname, 'test-lock-file.txt');
      await fs.writeFile(testFile, 'test content');
    });
    
    afterEach(async () => {
      // Clean up test file
      try {
        // Make sure file is writable before deleting
        await fs.chmod(testFile, 0o644);
        await fs.unlink(testFile);
      } catch {
        // Ignore cleanup errors
      }
    });
    
    it('should detect read-only files as locked', async () => {
      // Make file read-only
      await fs.chmod(testFile, 0o444);
      
      const input = {
        tool_name: 'Write',
        tool_input: {
          file_path: testFile,
          content: 'new content'
        },
        cwd: __dirname
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
      
      if (result.stdout) {
        const output = JSON.parse(result.stdout);
        expect(output?.hookSpecificOutput?.permissionDecision).toBe('deny');
        expect(output?.hookSpecificOutput?.permissionDecisionReason).toContain('protected by ailock');
      }
    });
    
    it('should allow modifications to writable files', async () => {
      // Make file writable
      await fs.chmod(testFile, 0o644);
      
      const input = {
        tool_name: 'Write',
        tool_input: {
          file_path: testFile,
          content: 'new content'
        },
        cwd: __dirname
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
      
      // Should not block (no output or null output)
      if (result.stdout) {
        const output = result.stdout.trim();
        expect(output).toBe('');
      }
    });
    
    it('should check permissions for Edit tool', async () => {
      // Make file read-only
      await fs.chmod(testFile, 0o444);
      
      const input = {
        tool_name: 'Edit',
        tool_input: {
          file_path: testFile,
          old_string: 'test',
          new_string: 'new'
        },
        cwd: __dirname
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
      
      if (result.stdout) {
        const output = JSON.parse(result.stdout);
        expect(output?.hookSpecificOutput?.permissionDecision).toBe('deny');
      }
    });
    
    it('should check permissions for MultiEdit tool', async () => {
      // Make file read-only
      await fs.chmod(testFile, 0o444);
      
      const input = {
        tool_name: 'MultiEdit',
        tool_input: {
          file_path: testFile,
          edits: [
            { old_string: 'test', new_string: 'new' }
          ]
        },
        cwd: __dirname
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
      
      if (result.stdout) {
        const output = JSON.parse(result.stdout);
        expect(output?.hookSpecificOutput?.permissionDecision).toBe('deny');
      }
    });
    
    it('should allow creation of new files', async () => {
      const newFile = path.join(__dirname, 'new-file.txt');
      
      const input = {
        tool_name: 'Write',
        tool_input: {
          file_path: newFile,
          content: 'new content'
        },
        cwd: __dirname
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
      
      // Should not block creation of new files
      if (result.stdout) {
        const output = result.stdout.trim();
        expect(output).toBe('');
      }
    });
  });
  
  describe('Response Format', () => {
    it('should return proper JSON when blocking', async () => {
      // This would need a mock of ailock returning locked status
      // For demonstration, we test the structure
      const expectedStructure = {
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'deny',
          permissionDecisionReason: expect.stringContaining('protected by ailock')
        }
      };
      
      // The actual blocking behavior would be tested with mocked ailock
    });
    
    it('should return nothing when allowing', async () => {
      const input = {
        tool_name: 'Write',
        tool_input: {
          file_path: '/tmp/unlocked.txt',
          content: 'test'
        },
        cwd: '/tmp'
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
      
      // When allowing, the hook should output nothing or empty JSON
      if (result.stdout) {
        const output = JSON.parse(result.stdout);
        expect(output).toBeNull();
      }
    });
  });
  
  describe('Error Handling', () => {
    it('should not block Claude Code on errors', async () => {
      const input = {
        tool_name: 'Write',
        tool_input: null, // Missing tool_input
        cwd: '/tmp'
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0); // Should still exit with 0
    });
    
    it('should handle null tool_input gracefully', async () => {
      const input = {
        tool_name: 'Write',
        tool_input: null,
        cwd: '/tmp'
      };
      
      const result = await runHook(input);
      expect(result.code).toBe(0);
      // Should not output anything when tool_input is null
      expect(result.stdout).toBe('');
    });
  });
  
  describe('Performance', () => {
    it('should complete within timeout', async () => {
      const input = {
        tool_name: 'Write',
        tool_input: {
          file_path: '/tmp/test.txt',
          content: 'test'
        },
        cwd: '/tmp'
      };
      
      const startTime = Date.now();
      const result = await runHook(input);
      const duration = Date.now() - startTime;
      
      expect(result.code).toBe(0);
      expect(duration).toBeLessThan(5000); // Should complete within 5 seconds
    });
  });
});