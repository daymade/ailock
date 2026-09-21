#!/usr/bin/env node

/**
 * Claude Code Hook for AILock Protection
 * 
 * This hook integrates with Claude Code to prevent accidental modifications
 * of files protected by ailock. It intercepts write operations and checks
 * if the target file is protected before allowing the operation.
 */

import { execFileSync } from 'child_process';
import { resolve, isAbsolute, dirname } from 'path';
import { existsSync, statSync } from 'fs';
import { fileURLToPath } from 'url';

const HOOK_DIRECTORY = dirname(fileURLToPath(import.meta.url));

/**
 * Main hook function
 */
async function main() {
  let input = '';
  
  // Read JSON input from stdin
  process.stdin.setEncoding('utf8');
  
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  
  try {
    const data = JSON.parse(input);
    const result = await processHookInput(data);
    
    if (result) {
      // Output JSON response
      console.log(JSON.stringify(result));
    }
    
    // Exit successfully
    process.exit(0);
  } catch (error) {
    console.error(`AILock Hook Error: ${error instanceof Error ? error.message : String(error)}`);

    // PreToolUse exit 2 is the protocol-level fail-closed signal. If the hook
    // cannot determine protection status, do not silently allow the write.
    process.exit(2);
  }
}

/**
 * Process the hook input and determine if operation should be blocked
 */
async function processHookInput(data) {
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
  const isProtected = await checkAilockProtection(absolutePath);
  
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
async function checkAilockProtection(filePath) {
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
  // 4s. This budget used to be 15s because the CLI globbed every protected
  // pattern across the whole project; `--file` removed that walk, so the cost is
  // now Node startup + one stat and does not grow with repo size. Measured
  // 2026-09-21: 0.44s median in a 48,608-file repo, 0.47s after adding 20,000
  // more files, 0.49s in a 148-file repo — the spread is startup noise. The old
  // 15s (and the host-side 20s that matched it) was treating the symptom: it
  // kept the ETIMEDOUT from firing without making the call cheaper.
  //
  // Keep this BELOW the host-side hook timeout in settings.json. Both matter for
  // the same reason: a killed CLI throws ETIMEDOUT, the hook exits 2, and an edit
  // that would have been allowed gets blocked.
  const result = execFileSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 4000,
    cwd: projectDir,
    env: {
      ...process.env,
      CI: 'true',
      NON_INTERACTIVE: '1'
    }
  });

  const report = JSON.parse(result);
  if (!Array.isArray(report.files)) {
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
  console.error(`AILock Hook Fatal Error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
});
