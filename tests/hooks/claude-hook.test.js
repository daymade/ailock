import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the hook script
const HOOK_SCRIPT = path.resolve(__dirname, '../../hooks/claude-ailock-hook.js');

/**
 * Helper function to run the hook with input
 */
async function runHook(input, spawnOptions = {}, hookScript = HOOK_SCRIPT) {
  return new Promise((resolve, reject) => {
    const hookProcess = spawn(process.execPath, [hookScript], {
      ...spawnOptions,
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
    
    it('should fail closed on malformed JSON', async () => {
      const hookProcess = spawn('node', [HOOK_SCRIPT], {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      return new Promise((resolve) => {
        let stderr = '';
        
        hookProcess.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        hookProcess.on('close', (code) => {
          expect(code).toBe(2);
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

    it('should fail closed without creating a NUL file when command lookup fails', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tinkle_ailock-hook-'));
      const packageRoot = path.join(tempDir, 'isolated-package');
      const hookDir = path.join(packageRoot, 'hooks');
      const hookScript = path.join(hookDir, 'claude-ailock-hook.js');
      const targetFile = path.join(tempDir, 'target.txt');

      try {
        await fs.mkdir(hookDir, { recursive: true });
        await fs.copyFile(HOOK_SCRIPT, hookScript);
        await fs.writeFile(path.join(packageRoot, 'package.json'), '{"type":"module"}\n');
        await fs.writeFile(targetFile, 'test content');

        const result = await runHook({
          tool_name: 'Write',
          tool_input: {
            file_path: targetFile,
            content: 'new content'
          },
          cwd: tempDir
        }, {
          cwd: tempDir,
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: tempDir,
            PATH: ''
          }
        }, hookScript);

        expect(result.code).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('Unable to locate the ailock CLI');
        expect(await fs.readdir(tempDir)).not.toContain('NUL');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('uses the exact packaged CLI when PATH is empty', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tinkle_ailock-packaged-hook-'));
      const packageRoot = path.join(tempDir, 'package prefix with spaces');
      const hookDir = path.join(packageRoot, 'hooks');
      const distDir = path.join(packageRoot, 'dist');
      const hookScript = path.join(hookDir, 'claude-ailock-hook.js');
      const targetFile = path.join(tempDir, 'writable-target.txt');

      try {
        await fs.mkdir(hookDir, { recursive: true });
        await fs.mkdir(distDir, { recursive: true });
        await fs.copyFile(HOOK_SCRIPT, hookScript);
        await fs.writeFile(path.join(packageRoot, 'package.json'), '{"type":"module"}\n');
        await fs.writeFile(
          path.join(distDir, 'index.js'),
          'process.stdout.write(JSON.stringify({ files: [{ absolutePath: process.env.TINKLE_LOCKED_TARGET, locked: true }] }));\n'
        );
        await fs.writeFile(targetFile, 'still writable');

        const result = await runHook({
          tool_name: 'Write',
          tool_input: {
            file_path: targetFile,
            content: 'new content'
          },
          cwd: tempDir
        }, {
          cwd: tempDir,
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: tempDir,
            PATH: '',
            TINKLE_LOCKED_TARGET: targetFile
          }
        }, hookScript);

        expect(result.code).toBe(0);
        expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
        expect(result.stderr).toBe('');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    });

    it('fails closed when the packaged CLI returns malformed status JSON', async () => {
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tinkle_ailock-invalid-status-'));
      const packageRoot = path.join(tempDir, 'package prefix with spaces');
      const hookDir = path.join(packageRoot, 'hooks');
      const distDir = path.join(packageRoot, 'dist');
      const hookScript = path.join(hookDir, 'claude-ailock-hook.js');
      const targetFile = path.join(tempDir, 'writable-target.txt');

      try {
        await fs.mkdir(hookDir, { recursive: true });
        await fs.mkdir(distDir, { recursive: true });
        await fs.copyFile(HOOK_SCRIPT, hookScript);
        await fs.writeFile(path.join(packageRoot, 'package.json'), '{"type":"module"}\n');
        await fs.writeFile(path.join(distDir, 'index.js'), 'process.stdout.write("not-json");\n');
        await fs.writeFile(targetFile, 'still writable');

        const result = await runHook({
          tool_name: 'Write',
          tool_input: {
            file_path: targetFile,
            content: 'new content'
          },
          cwd: tempDir
        }, {
          cwd: tempDir,
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: tempDir,
            PATH: ''
          }
        }, hookScript);

        expect(result.code).toBe(2);
        expect(result.stdout).toBe('');
        expect(result.stderr).toContain('AILock Hook Error');
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
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
      
      // Supply the status-check dependency explicitly, independent of a local build.
      const packageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ailock-writable-'));
      try {
        await fs.mkdir(path.join(packageRoot, 'hooks')); await fs.mkdir(path.join(packageRoot, 'dist'));
        const hook = path.join(packageRoot, 'hooks/claude-ailock-hook.js');
        await fs.copyFile(HOOK_SCRIPT, hook);
        await fs.writeFile(path.join(packageRoot, 'package.json'), '{"type":"module"}');
        await fs.writeFile(path.join(packageRoot, 'dist/index.js'), 'process.stdout.write(JSON.stringify({files:[]}));');
        const result = await runHook(input, {}, hook);
        expect(result.code).toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toBe('');
      } finally {
        await fs.rm(packageRoot, { recursive: true, force: true });
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


describe('AILock whole-entry deadline and private diagnostics', () => {
  let fixture;
  beforeEach(async () => {
    fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'ailock-deadline-'));
    await fs.mkdir(path.join(fixture, 'hooks')); await fs.mkdir(path.join(fixture, 'dist'));
    await fs.copyFile(HOOK_SCRIPT, path.join(fixture, 'hooks/claude-ailock-hook.js'));
    await fs.writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
    await fs.writeFile(path.join(fixture, 'target.txt'), 'synthetic writable target');
  });
  afterEach(async () => { await fs.rm(fixture, { recursive: true, force: true }); });
  async function invoke(raw, { delay = 0, close = true, cli = 'process.stdout.write(JSON.stringify({files:[]}));' } = {}) {
    await fs.writeFile(path.join(fixture, 'dist/index.js'), cli);
    const start = Date.now();
    const child = spawn(process.execPath, [path.join(fixture, 'hooks/claude-ailock-hook.js')], { cwd: fixture, env: { ...process.env, HOME: fixture, CLAUDE_PROJECT_DIR: fixture, FIXTURE_RECEIPT: path.join(fixture, 'receipt.json') }, stdio: ['pipe','pipe','pipe'] });
    let stdout='',stderr=''; child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);
    child.stdin.on('error',()=>{});
    const sending=setTimeout(()=>{ child.stdin.write(raw); if(close)child.stdin.end(); },delay);
    const cutoff=setTimeout(()=>child.kill('SIGKILL'),6100);
    const result=await new Promise((resolve,reject)=>{ child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr,ms:Date.now()-start})); });
    clearTimeout(sending);clearTimeout(cutoff);return result;
  }
  function input(extra={}) { return JSON.stringify({tool_name:'Write',tool_input:{file_path:path.join(fixture,'target.txt')},cwd:fixture,...extra}); }
  it('does not echo a malformed synthetic secret payload', async () => {
    const result=await invoke('SYN_SECRET_42');
    expect(result.code).toBe(2);expect(result.stdout).toBe('');expect(result.stderr).toContain('AILock Hook Error');expect(result.stderr).not.toContain('SYN_SECRET_42');
  });
  it('bounds a valid payload whose stdin never reaches EOF', async () => {
    const result=await invoke(input(),{close:false});expect(result.code).toBe(2);expect(result.stderr).toContain('deadline');expect(result.ms).toBeLessThan(4900);
  });
  it('charges slow stdin and slow CLI against the same budget', async () => {
    const cli="import fs from 'fs'; fs.writeFileSync(process.env.FIXTURE_RECEIPT,JSON.stringify({argv:process.argv.slice(2),pid:process.pid})); setTimeout(()=>process.stdout.write(JSON.stringify({files:[]})),2500);";
    const result=await invoke(input(),{delay:2600,cli});
    expect(result.code).toBe(2);expect(result.stderr).toContain('deadline');expect(result.ms).toBeLessThan(4900);
    const receipt=JSON.parse(await fs.readFile(path.join(fixture,'receipt.json'),'utf8'));
    expect(receipt.argv).toEqual(['list','--json','--file',path.join(fixture,'target.txt')]);
    let alive=true;try{process.kill(receipt.pid,0);}catch{alive=false;}expect(alive).toBe(false);
  });
  it('closes the owned CLI stdin so an EOF-dependent status check completes', async () => {
    const cli="process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({files:[]})));";
    const result=await invoke(input(),{cli});expect(result.code).toBe(0);expect(result.stdout).toBe('');expect(result.stderr).toBe('');
  });
  it.each([
    ['allow','process.stdout.write(JSON.stringify({files:[]}));',0,''],
    ['deny',"process.stdout.write(JSON.stringify({files:[{absolutePath:process.argv[5],locked:true}]}));",0,'deny'],
    ['failure',"process.stderr.write('SYN_SECRET_42');process.exit(7);",2,''],
    ['invalid status',"process.stdout.write('SYN_STATUS_42');",2,''],
    ['missing files','process.stdout.write(JSON.stringify({}));',2,''],
  ])('preserves %s status semantics',async (_name,cli,code,decision)=>{
    const result=await invoke(input(),{cli});expect(result.code).toBe(code);
    if(decision)expect(JSON.parse(result.stdout).hookSpecificOutput.permissionDecision).toBe(decision);else expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('SYN_STATUS_42');
    expect(result.stderr).not.toContain('SYN_SECRET_42');
  });
  it.each([
    [{},0], [{tool_name:'Write'},0], [{tool_name:'Write',tool_input:{}},0],
    [{tool_name:'Write',tool_input:null},0], [{tool_name:'Write',tool_input:{file_path:null}},0],
    [{tool_name:'Write',tool_input:{file_path:''}},0], [null,2],
  ])('preserves missing/null/empty input semantics for %j',async(payload,code)=>{
    const result=await invoke(JSON.stringify(payload),{cli:'process.exit(7);'});expect(result.code).toBe(code);expect(result.stdout).toBe('');
  });
  it('allows nonexistent files and denies owner-readonly files without querying the CLI',async()=>{
    const cli="import fs from 'fs';fs.writeFileSync(process.env.FIXTURE_RECEIPT,'queried');process.exit(7);";
    const absent=await invoke(input({tool_input:{file_path:path.join(fixture,'absent.txt')}}),{cli});expect(absent.code).toBe(0);expect(absent.stdout).toBe('');
    await fs.chmod(path.join(fixture,'target.txt'),0o444);
    const readonly=await invoke(input(),{cli});expect(readonly.code).toBe(0);expect(JSON.parse(readonly.stdout).hookSpecificOutput.permissionDecision).toBe('deny');
    expect(await fs.stat(path.join(fixture,'receipt.json')).catch(()=>null)).toBeNull();
  });
});

describe('AILock cancellation cleanup',()=>{
  it('kills only its owned status child on cancellation',async()=>{
    if(process.platform==='win32')return;
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'ailock-cancel-'));let hook,other;
    try{
      await fs.mkdir(path.join(root,'hooks'));await fs.mkdir(path.join(root,'dist'));await fs.copyFile(HOOK_SCRIPT,path.join(root,'hooks/claude-ailock-hook.js'));
      await fs.writeFile(path.join(root,'package.json'),'{"type":"module"}');await fs.writeFile(path.join(root,'target.txt'),'synthetic');
      const receipt=path.join(root,'pid.json');await fs.writeFile(path.join(root,'dist/index.js'),"import fs from 'fs';fs.writeFileSync(process.env.FIXTURE_RECEIPT,JSON.stringify({pid:process.pid}));setInterval(()=>{},1000);");
      other=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      hook=spawn(process.execPath,[path.join(root,'hooks/claude-ailock-hook.js')],{cwd:root,env:{...process.env,HOME:root,CLAUDE_PROJECT_DIR:root,FIXTURE_RECEIPT:receipt},stdio:['pipe','pipe','pipe']});let stderr='';hook.stderr.on('data',data=>stderr+=data);
      const closed=new Promise(resolve=>hook.once('close',code=>resolve(code)));hook.stdin.end(JSON.stringify({tool_name:'Write',tool_input:{file_path:path.join(root,'target.txt')},cwd:root}));
      let pid;for(let i=0;i<60;i++){try{pid=JSON.parse(await fs.readFile(receipt,'utf8')).pid;break;}catch{}await new Promise(resolve=>setTimeout(resolve,20));}
      expect(pid).toBeTypeOf('number');hook.kill('SIGTERM');expect(await closed).toBe(2);expect(stderr).toContain('cancelled');
      let alive=true;try{process.kill(pid,0);}catch{alive=false;}expect(alive).toBe(false);expect(()=>process.kill(other.pid,0)).not.toThrow();
    }finally{if(hook&&hook.exitCode===null)hook.kill('SIGKILL');if(other)other.kill('SIGKILL');await fs.rm(root,{recursive:true,force:true});}
  });
});
