import { execa, ExecaError, Options as ExecaOptions } from 'execa';
import { quote } from 'shell-quote';
import path from 'path';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  command: string;
  args: string[];
}

export interface SecureCommandOptions {
  timeout?: number;
  cwd?: string;
  env?: Record<string, string>;
  input?: string;
  allowedCommands?: string[];
  maxOutputSize?: number;
}

/**
 * Secure command executor that prevents injection attacks and provides
 * comprehensive security controls for external command execution
 */
export class SecureCommandExecutor {
  private readonly defaultTimeout = 30000; // 30 seconds
  private readonly maxOutputSize = 1024 * 1024; // 1MB
  private readonly allowedCommands: Set<string>;

  constructor(allowedCommands: string[] = []) {
    // Default allowed commands for file operations
    const defaultAllowed = [
      'chmod', 'chattr', 'chflags', 'attrib', 'icacls',
      'xattr', 'getfattr', 'setfattr', 'lsattr',
      'git', 'ls', 'stat', 'test', 'find'
    ];
    
    this.allowedCommands = new Set([...defaultAllowed, ...allowedCommands]);
  }

  /**
   * Executes a command securely with argument validation and output limits
   */
  async executeCommand(
    command: string,
    args: string[],
    options: SecureCommandOptions = {}
  ): Promise<CommandResult> {
    // Validate command is allowed
    this.validateCommand(command);

    // Validate and sanitize arguments
    const sanitizedArgs = this.sanitizeArguments(args);

    // Prepare execution options
    const execOptions: ExecaOptions = {
      timeout: options.timeout || this.defaultTimeout,
      cwd: options.cwd ? path.resolve(options.cwd) : process.cwd(),
      env: this.createSecureEnvironment(options.env),
      input: options.input,
      stdio: 'pipe',
      shell: false, // CRITICAL: Never use shell
      stripFinalNewline: false,
      buffer: true,
      maxBuffer: options.maxOutputSize || this.maxOutputSize,
      windowsHide: true, // Hide window on Windows
      killSignal: 'SIGTERM',
    };

    try {
      const result = await execa(command, sanitizedArgs, execOptions);
      
      return {
        stdout: String(result.stdout || ''),
        stderr: String(result.stderr || ''),
        exitCode: result.exitCode || 0,
        command,
        args: sanitizedArgs
      };
    } catch (error) {
      if (error instanceof ExecaError) {
        // Handle specific execution errors
        if (error.timedOut) {
          throw new Error(`Command timed out after ${execOptions.timeout}ms: ${command}`);
        }
        
        if (error.signal) {
          throw new Error(`Command was killed with signal ${error.signal}: ${command}`);
        }

        if (error.exitCode !== undefined) {
          return {
            stdout: String(error.stdout || ''),
            stderr: String(error.stderr || ''),
            exitCode: error.exitCode,
            command,
            args: sanitizedArgs
          };
        }
      }

      throw new Error(`Command execution failed: ${error}`);
    }
  }

  /**
   * Executes a command and returns only success/failure
   */
  async executeCommandSilent(
    command: string,
    args: string[],
    options: SecureCommandOptions = {}
  ): Promise<boolean> {
    try {
      const result = await this.executeCommand(command, args, options);
      return result.exitCode === 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Creates a safe shell command string for logging purposes only
   * DO NOT USE THIS FOR ACTUAL EXECUTION
   */
  createSafeCommandString(command: string, args: string[]): string {
    return quote([command, ...args]);
  }

  /**
   * Validates that a command is in the allowed list
   */
  private validateCommand(command: string): void {
    if (!command || typeof command !== 'string') {
      throw new Error('Invalid command: must be a non-empty string');
    }

    // Extract base command name without path
    const baseCommand = path.basename(command);
    
    if (!this.allowedCommands.has(baseCommand)) {
      throw new Error(`Command not allowed: ${baseCommand}`);
    }

    // Additional validation for command paths
    if (command.includes('/') || command.includes('\\')) {
      // Allow only commands in system PATH or specific trusted locations
      const trustedPaths = [
        '/bin', '/usr/bin', '/usr/local/bin',
        '/sbin', '/usr/sbin',
        'C:\\Windows\\System32', 'C:\\Windows\\SysWOW64'
      ];

      const commandDir = path.dirname(path.resolve(command));
      const isTrusted = trustedPaths.some(trusted => 
        commandDir.startsWith(trusted)
      );

      if (!isTrusted) {
        throw new Error(`Command path not trusted: ${command}`);
      }
    }
  }

  /**
   * Sanitizes command arguments to prevent injection
   */
  private sanitizeArguments(args: string[]): string[] {
    if (!Array.isArray(args)) {
      throw new Error('Arguments must be an array');
    }

    return args.map((arg, index) => {
      if (typeof arg !== 'string') {
        throw new Error(`Argument ${index} must be a string, got ${typeof arg}`);
      }

      // Check for dangerous characters that could be used for injection
      const dangerousChars = /[;&|`$(){}[\]<>]/;
      if (dangerousChars.test(arg)) {
        throw new Error(`Dangerous characters in argument ${index}: ${arg}`);
      }

      // Limit argument length
      if (arg.length > 4096) {
        throw new Error(`Argument ${index} too long: maximum 4096 characters`);
      }

      return arg;
    });
  }

  /**
   * Creates a secure environment for command execution
   */
  private createSecureEnvironment(customEnv?: Record<string, string>): Record<string, string> {
    // Start with minimal environment
    const secureEnv: Record<string, string> = {
      PATH: process.env.PATH || '',
      HOME: process.env.HOME || '',
      USER: process.env.USER || '',
      LANG: process.env.LANG || 'C',
    };

    // Add platform-specific environment variables
    if (process.platform === 'win32') {
      secureEnv.SYSTEMROOT = process.env.SYSTEMROOT || 'C:\\Windows';
      secureEnv.WINDIR = process.env.WINDIR || 'C:\\Windows';
      secureEnv.USERPROFILE = process.env.USERPROFILE || '';
    }

    // Merge custom environment variables (with validation)
    if (customEnv) {
      for (const [key, value] of Object.entries(customEnv)) {
        if (typeof key !== 'string' || typeof value !== 'string') {
          throw new Error(`Invalid environment variable: ${key}=${value}`);
        }
        
        // Prevent environment variable injection
        if (key.includes('=') || key.includes('\0') || value.includes('\0')) {
          throw new Error(`Dangerous environment variable: ${key}=${value}`);
        }

        secureEnv[key] = value;
      }
    }

    return secureEnv;
  }

  /**
   * Adds an allowed command to the whitelist
   */
  addAllowedCommand(command: string): void {
    if (command && typeof command === 'string') {
      this.allowedCommands.add(path.basename(command));
    }
  }

  /**
   * Removes a command from the whitelist
   */
  removeAllowedCommand(command: string): void {
    this.allowedCommands.delete(path.basename(command));
  }

  /**
   * Gets the list of allowed commands
   */
  getAllowedCommands(): string[] {
    return Array.from(this.allowedCommands).sort();
  }
}