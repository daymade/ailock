# System Architecture

Understanding the design and structure of AI-Proof File Guard's security system.

## 🏗️ High-Level Architecture

AI-Proof File Guard follows a modular, layered security architecture designed for defense in depth.

```mermaid
graph TB
    subgraph "Application Layer"
        A[User Application]
        B[AI Agent]
        C[External System]
    end
    
    subgraph "AI-Proof File Guard"
        D[Security Gateway]
        E[Input Validation Layer]
        F[Path Security Layer]
        G[Command Security Layer]
        H[File Operation Layer]
        I[Error Handling Layer]
    end
    
    subgraph "System Resources"
        J[File System]
        K[Process Execution]
        L[System Commands]
    end
    
    A --> D
    B --> D
    C --> D
    
    D --> E
    E --> F
    F --> G
    G --> H
    H --> I
    
    H --> J
    G --> K
    G --> L
    
    I --> D
```

## 🔧 Core Components

### 1. Security Gateway
The main entry point that orchestrates all security operations.

```mermaid
classDiagram
    class SecurityGateway {
        +validateRequest(request)
        +processSecurely(operation)
        +handleResponse(result)
        -auditLog: AuditLogger
        -errorHandler: SecureErrorHandler
    }
    
    class Request {
        +operation: string
        +path: string
        +command: string
        +args: string[]
        +context: object
    }
    
    SecurityGateway --> Request : processes
```

### 2. Input Validation Layer
First line of defense against malicious input.

```mermaid
graph LR
    A[Raw Input] --> B[Type Validation]
    B --> C[Length Limits]
    C --> D[Character Filtering]
    D --> E[Pattern Matching]
    E --> F[Sanitized Input]
    
    B -->|❌| G[Reject]
    C -->|❌| G
    D -->|❌| G
    E -->|❌| G
```

**Implementation:**
```typescript
class InputValidationLayer {
  validateInput(input: any): ValidatedInput {
    // Type validation
    if (typeof input !== 'object') {
      throw new SecurityError('Invalid input type');
    }
    
    // Length limits
    if (JSON.stringify(input).length > MAX_INPUT_SIZE) {
      throw new SecurityError('Input too large');
    }
    
    // Character filtering
    const sanitized = this.sanitizeInput(input);
    
    // Pattern matching for known attacks
    this.detectAttackPatterns(sanitized);
    
    return sanitized;
  }
  
  private detectAttackPatterns(input: any): void {
    const dangerous = [
      /\.\.\//,           // Path traversal
      /[;&|`$()]/,        // Command injection
      /javascript:/i,     // Script injection
      /<script/i          // XSS attempts
    ];
    
    const inputStr = JSON.stringify(input);
    for (const pattern of dangerous) {
      if (pattern.test(inputStr)) {
        throw new SecurityError('Dangerous pattern detected');
      }
    }
  }
}
```

### 3. Path Security Layer
Handles all file path operations with comprehensive validation.

```mermaid
flowchart TD
    A[File Path] --> B{Absolute Path?}
    B -->|Yes| C{In Allowed Dirs?}
    B -->|No| D[Make Absolute]
    
    C -->|Yes| E[Path Traversal Check]
    C -->|No| F[Block - Outside Scope]
    
    D --> E
    E --> G{Contains ..?}
    G -->|Yes| H[Analyze Components]
    G -->|No| I[Character Validation]
    
    H --> J{Safe Traversal?}
    J -->|Yes| I
    J -->|No| K[Block - Traversal Attack]
    
    I --> L{Dangerous Chars?}
    L -->|Yes| M[Sanitize Characters]
    L -->|No| N[Length Validation]
    
    M --> N
    N --> O{Too Long?}
    O -->|Yes| P[Truncate/Block]
    O -->|No| Q[Validated Path]
```

**Component Structure:**
```typescript
class PathSecurityLayer {
  constructor(
    private allowedDirectories: string[],
    private options: PathValidationOptions
  ) {}
  
  async validatePath(inputPath: string): Promise<string> {
    // Step 1: Normalize and resolve
    const normalizedPath = path.resolve(inputPath);
    
    // Step 2: Check allowed directories
    this.enforceDirectoryRestrictions(normalizedPath);
    
    // Step 3: Detect traversal attempts
    this.detectTraversalAttacks(inputPath, normalizedPath);
    
    // Step 4: Validate characters and components
    this.validatePathComponents(normalizedPath);
    
    // Step 5: Platform-specific validation
    this.platformSpecificValidation(normalizedPath);
    
    return normalizedPath;
  }
  
  private enforceDirectoryRestrictions(fullPath: string): void {
    const isAllowed = this.allowedDirectories.some(dir => 
      fullPath.startsWith(path.resolve(dir))
    );
    
    if (!isAllowed) {
      throw new SecurityError('Path outside allowed directories');
    }
  }
}
```

### 4. Command Security Layer
Secures command execution with whitelisting and argument validation.

```mermaid
sequenceDiagram
    participant App as Application
    participant CSL as Command Security Layer
    participant Whitelist as Command Whitelist
    participant ArgValidator as Argument Validator
    participant Executor as Process Executor
    
    App->>CSL: executeCommand(cmd, args)
    CSL->>Whitelist: isCommandAllowed(cmd)
    
    alt Command Allowed
        Whitelist->>CSL: ✅ Allowed
        CSL->>ArgValidator: validateArguments(args)
        
        alt Arguments Safe
            ArgValidator->>CSL: ✅ Safe
            CSL->>Executor: execute(cmd, args)
            Executor->>CSL: result
            CSL->>App: sanitized result
        else Arguments Dangerous
            ArgValidator->>CSL: ❌ Dangerous
            CSL->>App: SecurityError
        end
    else Command Blocked
        Whitelist->>CSL: ❌ Blocked
        CSL->>App: SecurityError
    end
```

**Architecture:**
```typescript
class CommandSecurityLayer {
  constructor(
    private allowedCommands: string[],
    private options: CommandExecutionOptions
  ) {}
  
  async executeCommand(
    command: string, 
    args: string[]
  ): Promise<ExecutionResult> {
    // Step 1: Command whitelist validation
    this.validateCommandAllowed(command);
    
    // Step 2: Argument validation and sanitization
    const safeArgs = this.validateArguments(args);
    
    // Step 3: Environment preparation
    const secureEnv = this.prepareSecureEnvironment();
    
    // Step 4: Execute with constraints
    const result = await this.executeWithConstraints(
      command,
      safeArgs,
      secureEnv
    );
    
    // Step 5: Output sanitization
    return this.sanitizeOutput(result);
  }
  
  private executeWithConstraints(
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv
  ): Promise<RawExecutionResult> {
    return execa(command, args, {
      shell: false,           // No shell interpretation
      timeout: this.options.timeout,
      maxBuffer: this.options.maxOutputSize,
      env: env,
      stdio: 'pipe',
      windowsHide: true
    });
  }
}
```

### 5. File Operation Layer
Provides atomic, race-condition-free file operations.

```mermaid
stateDiagram-v2
    [*] --> Idle
    
    Idle --> AcquiringLock : startOperation()
    AcquiringLock --> Locked : lockAcquired()
    AcquiringLock --> Failed : lockTimeout()
    
    Locked --> Operating : beginFileOperation()
    Operating --> Verifying : operationComplete()
    Verifying --> ReleasingLock : verificationPassed()
    Verifying --> RollingBack : verificationFailed()
    
    RollingBack --> ReleasingLock : rollbackComplete()
    ReleasingLock --> Idle : lockReleased()
    
    Failed --> [*]
    Idle --> [*]
```

**Lock Management:**
```typescript
class FileOperationLayer {
  private activeLocks = new Map<string, LockInfo>();
  
  async atomicOperation<T>(
    filePath: string,
    operation: (path: string) => Promise<T>
  ): Promise<T> {
    const lockId = await this.acquireLock(filePath);
    
    try {
      // Create backup if needed
      const backup = await this.createBackup(filePath);
      
      // Perform operation
      const result = await operation(filePath);
      
      // Verify integrity
      await this.verifyIntegrity(filePath);
      
      // Clean up backup
      await this.cleanupBackup(backup);
      
      return result;
      
    } catch (error) {
      // Restore from backup if operation failed
      await this.restoreFromBackup(filePath, backup);
      throw error;
      
    } finally {
      await this.releaseLock(filePath, lockId);
    }
  }
}
```

### 6. Error Handling Layer
Sanitizes errors to prevent information disclosure.

```mermaid
flowchart LR
    A[Raw Error] --> B[Error Classification]
    B --> C{Security Sensitive?}
    
    C -->|Yes| D[Information Redaction]
    C -->|No| E[Standard Processing]
    
    D --> F[Pattern Sanitization]
    F --> G[Context Sanitization]
    G --> H[Message Truncation]
    
    E --> I[Error Categorization]
    H --> I
    I --> J[Recovery Action]
    J --> K[Sanitized Error]
```

## 🔄 Data Flow Architecture

### Request Processing Flow
```mermaid
sequenceDiagram
    participant Client
    participant Gateway as Security Gateway
    participant Validator as Input Validator
    participant PathSec as Path Security
    participant CmdSec as Command Security
    participant FileSys as File System
    participant ErrorHandler as Error Handler
    
    Client->>Gateway: Request
    Gateway->>Validator: Validate Input
    
    alt Valid Input
        Validator->>PathSec: Validate Paths
        
        alt Valid Paths
            PathSec->>CmdSec: Validate Commands
            
            alt Valid Commands
                CmdSec->>FileSys: Execute Operation
                FileSys->>Gateway: Result
                Gateway->>Client: Sanitized Response
            else Invalid Commands
                CmdSec->>ErrorHandler: Command Error
                ErrorHandler->>Gateway: Safe Error
                Gateway->>Client: Error Response
            end
        else Invalid Paths
            PathSec->>ErrorHandler: Path Error
            ErrorHandler->>Gateway: Safe Error
            Gateway->>Client: Error Response
        end
    else Invalid Input
        Validator->>ErrorHandler: Input Error
        ErrorHandler->>Gateway: Safe Error
        Gateway->>Client: Error Response
    end
```

## 🏛️ Architectural Patterns

### 1. Defense in Depth
Multiple independent security layers that each provide protection:

```typescript
class DefenseInDepthProcessor {
  async processRequest(request: any): Promise<any> {
    // Layer 1: Input validation
    const validatedInput = await this.inputValidator.validate(request);
    
    // Layer 2: Path security
    const safePaths = await this.pathValidator.validatePaths(
      validatedInput.paths
    );
    
    // Layer 3: Command security
    const safeCommands = await this.commandValidator.validateCommands(
      validatedInput.commands
    );
    
    // Layer 4: Execution security
    const result = await this.secureExecutor.execute(
      safeCommands,
      safePaths
    );
    
    // Layer 5: Output sanitization
    return await this.outputSanitizer.sanitize(result);
  }
}
```

### 2. Fail-Safe Design
Default to secure behavior when uncertain:

```typescript
class FailSafeValidator {
  validateOperation(operation: unknown): boolean {
    try {
      // Attempt validation
      return this.strictValidation(operation);
    } catch (error) {
      // When in doubt, fail safely
      this.logSecurityEvent('validation_failed', { operation, error });
      return false;
    }
  }
}
```

### 3. Immutable Security State
Security configurations cannot be modified at runtime:

```typescript
class ImmutableSecurityConfig {
  private readonly config: SecurityConfiguration;
  
  constructor(config: SecurityConfiguration) {
    // Deep freeze to prevent modification
    this.config = Object.freeze(JSON.parse(JSON.stringify(config)));
  }
  
  // Only read operations allowed
  getConfiguration(): Readonly<SecurityConfiguration> {
    return this.config;
  }
}
```

## 📊 Performance Architecture

### Caching Strategy
```mermaid
graph TD
    A[Request] --> B{Cache Hit?}
    B -->|Yes| C[Return Cached]
    B -->|No| D[Validate & Process]
    D --> E[Cache Result]
    E --> F[Return Result]
    
    G[Cache TTL] --> H[Invalidate Cache]
    H --> I[Fresh Validation]
```

### Resource Management
```typescript
class ResourceManager {
  private operationLimits = {
    maxConcurrentOperations: 100,
    maxMemoryUsage: 512 * 1024 * 1024, // 512MB
    maxExecutionTime: 30000, // 30 seconds
  };
  
  async executeWithLimits<T>(
    operation: () => Promise<T>
  ): Promise<T> {
    // Check resource availability
    await this.checkResourceLimits();
    
    // Track resource usage
    const tracker = this.startResourceTracking();
    
    try {
      return await Promise.race([
        operation(),
        this.timeoutPromise(this.operationLimits.maxExecutionTime)
      ]);
    } finally {
      tracker.stop();
    }
  }
}
```

## 🔍 Monitoring & Observability

### Metrics Collection
```mermaid
graph LR
    A[Security Events] --> B[Metrics Collector]
    B --> C[Aggregator]
    C --> D[Dashboard]
    C --> E[Alerts]
    
    F[Performance Data] --> B
    G[Error Logs] --> B
```

### Health Checks
```typescript
class SecurityHealthMonitor {
  async performHealthCheck(): Promise<HealthStatus> {
    const checks = await Promise.allSettled([
      this.checkInputValidation(),
      this.checkPathSecurity(),
      this.checkCommandSecurity(),
      this.checkFileOperations(),
      this.checkErrorHandling()
    ]);
    
    return {
      overall: checks.every(c => c.status === 'fulfilled') ? 'healthy' : 'degraded',
      components: this.summarizeChecks(checks),
      timestamp: new Date().toISOString()
    };
  }
}
```

---

*🏗️ This architecture ensures robust security while maintaining performance and extensibility.*