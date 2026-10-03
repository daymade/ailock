#!/usr/bin/env node

/**
 * Claude Code Hook for AILock Protection
 * 
 * This hook integrates with Claude Code to prevent accidental modifications
 * of files protected by ailock. It intercepts write operations and checks
 * if the target file is protected before allowing the operation.
 */

import { execFile } from 'child_process';
import { resolve, isAbsolute, dirname } from 'path';
import { existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';

const HOOK_DIRECTORY = dirname(fileURLToPath(import.meta.url));
// Milliseconds for the entire entry, including waiting for input EOF.
const HOOK_BUDGET_MS = 4000;
let activeChild;

function failClosed(message) {
  // Kill only the status-check child created by this invocation.
  if (activeChild) activeChild.kill('SIGKILL');
  console.error(`AILock Hook Error: ${message}`);
  process.exit(2);
}

/**
 * Main hook function
 */
async function main() {
  const deadline = performance.now() + HOOK_BUDGET_MS;
  const timer = setTimeout(() => failClosed('protection check deadline exceeded'), HOOK_BUDGET_MS);
  process.once('SIGTERM', () => failClosed('protection check cancelled (SIGTERM)'));
  process.once('SIGINT', () => failClosed('protection check cancelled (SIGINT)'));
  let input = '';
  try {
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) input += chunk;
    let data;
    try {
      data = JSON.parse(input);
    } catch {
      // Node's parse error can include the private input body.
      throw new Error('hook input is not valid JSON');
    }
    const result = await processHookInput(data, deadline);
    if (performance.now() >= deadline) throw new Error('protection check deadline exceeded');
    
    if (result) {
      // Output JSON response
      console.log(JSON.stringify(result));
    }
    
    // Exit successfully
    clearTimeout(timer);
    process.exit(0);
  } catch (error) {
    failClosed(error instanceof Error ? error.message : 'protection check failed');
  }
}

/**
 * Process the hook input and determine if operation should be blocked
 */
async function processHookInput(data, deadline) {
  const { tool_name, tool_input, cwd } = data;
  
  // Extract file path based on tool type
  const filePath = extractFilePath(tool_name, tool_input);
  
  if (!filePath) {
    // No file path found, allow operation
    return null;
  }
  
  // Resolve to absolute path
  const absolutePath = isAbsolute(filePath) 
    ? filePath 
    : resolve(cwd || process.cwd(), filePath);
  
  // Check if file is protected by ailock
  const isProtected = await checkAilockProtection(absolutePath, deadline);
  
  if (isProtected) {
    // Block the operation
    return {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `File is protected by ailock. Run 'ailock unlock ${filePath}' to allow modifications.`
      }
    };
  }
  
  // Allow operation
  return null;
}

/**
 * Extract file path from tool input based on tool type
 */
function extractFilePath(toolName, toolInput) {
  if (!toolInput) return null;
  
  switch (toolName) {
    case 'Write':
    case 'Edit':
      return toolInput.file_path;
    
    case 'MultiEdit':
      // MultiEdit has file_path at the root level
      return toolInput.file_path;
    
    case 'NotebookEdit':
      return toolInput.notebook_path;
    
    default:
      return null;
  }
}

/**
 * Check if a file is protected by ailock
 */
async function checkAilockProtection(filePath, deadline) {
  // First, verify the file exists. Creation of a new file is outside the
  // chmod-based lock contract and remains allowed.
  if (!existsSync(filePath)) {
    return false;
  }

  // Primary method: a read-only owner bit is a complete local proof.
  const { mode } = statSync(filePath);
  if ((mode & 0o200) === 0) {
    return true;
  }

  // Secondary method: query the exact installed package so writable files in
  // the configured locked set are still denied.
  let command;
  let commandArgs;
  // Ask about THIS file, not the whole project. `ailock list --json` globs every
  // protected pattern across the project — seconds in a large repo, on every
  // single write — while the hook only ever needs the verdict for one path.
  // `--file` answers that directly (see commands/list.ts); the CLI stays the
  // authority, only the question gets narrower. Calibrated against the full glob
  // on three corpora before this switch.
  const listArgs = ['list', '--json', '--file', filePath];
  const packagedAilock = resolve(HOOK_DIRECTORY, '../dist/index.js');

  if (existsSync(packagedAilock)) {
    command = process.execPath;
    commandArgs = [packagedAilock, ...listArgs];
  } else {
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const devAilock = resolve(projectDir, 'dist/index.js');
    const localAilock = resolve(projectDir, 'node_modules/.bin/ailock');

    if (existsSync(devAilock)) {
      command = process.execPath;
      commandArgs = [devAilock, ...listArgs];
    } else if (existsSync(localAilock)) {
      command = localAilock;
      commandArgs = listArgs;
    }
  }

  if (!command || !commandArgs) {
    throw new Error('Unable to locate the ailock CLI needed to verify protection status');
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const remaining = Math.ceil(deadline - performance.now());
  if (remaining <= 0) throw new Error('protection check deadline exceeded');
  // An asynchronous child leaves the entry timer runnable while checking status.
  const result = await new Promise((resolveResult, reject) => {
    activeChild = execFile(command, commandArgs, {
      encoding: 'utf8', timeout: remaining, killSignal: 'SIGKILL',
      cwd: projectDir,
      env: { ...process.env, CI: 'true', NON_INTERACTIVE: '1' },
    }, (error, stdout) => {
      activeChild = undefined;
      if (error) {
        // execFile errors can include private child output; expose only status.
        reject(new Error(error.killed || performance.now() >= deadline
          ? 'protection check deadline exceeded'
          : `ailock status command failed (${error.code ?? error.signal ?? 'unknown'})`));
      } else {
        resolveResult(stdout);
      }
    });
    activeChild.stdin.end();
  });

  let report;
  try {
    report = JSON.parse(result);
  } catch {
    throw new Error('ailock list returned invalid status JSON');
  }
  if (!report || !Array.isArray(report.files)) {
    throw new Error('ailock list returned no files array');
  }

  return report.files.some(file => {
    if (!file || file.locked !== true) return false;
    const listedPath = file.absolutePath || file.path;
    return typeof listedPath === 'string' && resolve(projectDir, listedPath) === filePath;
  });
}

// Run the hook
main().catch(error => {
  failClosed(error instanceof Error ? error.message : 'protection check failed');
});
