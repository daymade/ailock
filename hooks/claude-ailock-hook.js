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
  const listArgs = ['list', '--json'];
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
  const result = execFileSync(command, commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 5000,
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
