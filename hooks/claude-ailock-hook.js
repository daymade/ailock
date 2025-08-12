#!/usr/bin/env node

/**
 * Claude Code Hook for AILock Protection
 * 
 * This hook integrates with Claude Code to prevent accidental modifications
 * of files protected by ailock. It intercepts write operations and checks
 * if the target file is protected before allowing the operation.
 */

import { execSync } from 'child_process';
import { resolve, isAbsolute } from 'path';
import { existsSync, statSync } from 'fs';

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
    // Log error to stderr for debugging
    console.error(`AILock Hook Error: ${error.message}`);
    
    // Exit successfully to not block operations on error
    process.exit(0);
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
  try {
    // First, verify the file exists
    if (!existsSync(filePath)) {
      // File doesn't exist yet, allow creation
      return false;
    }
    
    // Primary method: Check file permissions directly
    // This is the most reliable way to detect if a file is locked
    try {
      const { mode } = statSync(filePath);
      
      // Check if file is read-only (no write permissions for owner)
      const isReadOnly = (mode & 0o200) === 0;
      
      if (isReadOnly) {
        // File is locked (read-only)
        return true;
      }
    } catch (error) {
      // Can't check permissions, continue to other methods
    }
    
    // Secondary method: Use ailock status to check protected files
    // This catches files that are in .ailock config and locked
    try {
      // Determine which ailock command to use
      let ailockCmd = 'ailock';
      
      // Check if global ailock exists
      try {
        execSync('which ailock 2>/dev/null || where ailock 2>NUL', { stdio: 'pipe' });
      } catch {
        // Try to use local installation
        const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
        
        // First check if we're in the ailock project itself
        const devAilock = resolve(projectDir, 'dist/index.js');
        const localAilock = resolve(projectDir, 'node_modules/.bin/ailock');
        
        if (existsSync(devAilock)) {
          // We're in the ailock development directory
          ailockCmd = `node ${devAilock}`;
        } else if (existsSync(localAilock)) {
          // Local installation exists
          ailockCmd = localAilock;
        } else {
          // Try npx as fallback
          ailockCmd = 'npx ailock';
        }
      }
      
      // Get ailock status
      const result = execSync(`${ailockCmd} status --json`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      const status = JSON.parse(result);
      
      // Check if file is in lockedFiles array
      if (status.lockedFiles && Array.isArray(status.lockedFiles)) {
        return status.lockedFiles.includes(filePath);
      }
    } catch {
      // ailock command failed, but we already checked permissions
    }
    
    return false;
  } catch (error) {
    // If any unexpected errors occur, allow operation
    // This ensures the hook doesn't break Claude Code
    
    // Check if it's a command not found error
    if (error.message && (error.message.includes('command not found') || error.message.includes('not recognized'))) {
      console.error('AILock Hook: ailock command not found. Please install ailock globally: npm install -g ailock');
    }
    
    return false;
  }
}

// Run the hook
main().catch(error => {
  console.error(`AILock Hook Fatal Error: ${error.message}`);
  process.exit(0); // Still exit successfully to not break Claude Code
});