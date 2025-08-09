import { promises as fs, existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getPlatformAdapter } from '../core/platform.js';
import { loadConfig, findProtectedFiles } from '../core/config.js';
import { isGitRepository, installPreCommitHook } from '../core/git.js';

const execAsync = promisify(exec);

export interface DemoScenario {
  name: string;
  description: string;
  files: Array<{
    path: string;
    content: string;
    sensitive: boolean;
  }>;
}

export interface DemoMetrics {
  filesCreated: number;
  filesProtected: number;
  protectionTime: number;
  platformDetected: string;
  gitHooksInstalled: boolean;
}

/**
 * ⚠️ AILOCK DEMONSTRATION SERVICE - FAKE DATA ONLY ⚠️
 * 
 * This service creates FAKE demo files with FAKE credentials for ailock protection demonstration.
 * All secrets, passwords, API keys, and credentials in this file are FAKE and for demo purposes only.
 * DO NOT USE any of these values in real applications.
 * 
 * Purpose: Showcase how ailock protects sensitive files from AI modifications
 */
export class DemoService {
  private demoDir: string;
  private originalCwd: string;
  private cleanupCallbacks: Array<() => Promise<void>> = [];

  constructor() {
    this.originalCwd = process.cwd();
    this.demoDir = join(tmpdir(), `ailock-demo-${Date.now()}`);
  }

  /**
   * Get demo scenarios showcasing different project types
   */
  getDemoScenarios(): DemoScenario[] {
    return [
      {
        name: 'startup',
        description: 'SaaS Startup - Production Configuration',
        files: [
          {
            path: '.env',
            content: `# ⚠️  AILOCK DEMO - FAKE CREDENTIALS FOR DEMONSTRATION ONLY ⚠️
# These are NOT real secrets - they are example values to show ailock protection
# DO NOT USE these values in any real application

# Production Environment - HIGHLY SENSITIVE (DEMO)
DATABASE_URL=postgresql://admin:DEMO_fake_password_123@demo-db.example.com:5432/demo_db
API_SECRET_KEY=demo_fake_api_key_for_ailock_demonstration_not_real_secret
STRIPE_SECRET_KEY=demo_fake_stripe_key_for_ailock_demo_not_real_secret
JWT_SECRET=DEMO_FAKE_jwt_signing_key_2023_ailock_demonstration_only
ADMIN_PASSWORD=DEMO_FAKE_Password_For_AILock_Demo_2023!
AWS_SECRET_ACCESS_KEY=demo_fake_aws_access_key_for_ailock_demonstration_not_real

# Redis Cache (DEMO)
REDIS_URL=redis://demo_user:DEMO_fake_secret@demo-redis.example.com:6379
SESSION_SECRET=DEMO_FAKE_session_signing_key_for_ailock_demonstration

# Email Service (DEMO - fake production keys)
MAILGUN_API_KEY=demo_fake_mailgun_key_for_ailock_demonstration_not_real
SENDGRID_API_KEY=demo_fake_sendgrid_key_for_ailock_demonstration_not_real

# Third-party integrations (DEMO)
GITHUB_CLIENT_SECRET=demo_fake_github_oauth_secret_for_ailock_demonstration
GOOGLE_CLIENT_SECRET=demo_fake_google_oauth_secret_for_ailock_demonstration`,
            sensitive: true
          },
          {
            path: 'config/database.json',
            content: JSON.stringify({
              "_comment": "⚠️ AILOCK DEMO - FAKE DATABASE CONFIG FOR DEMONSTRATION ONLY ⚠️",
              "_warning": "These are NOT real credentials - example values for ailock protection demo",
              production: {
                host: 'demo-db.example.com',
                username: 'demo_admin',
                password: 'DEMO_FAKE_database_password_for_ailock_demo',
                database: 'ailock_demo_db',
                ssl: true,
                connectionLimit: 100
              },
              backup: {
                host: 'demo-backup-db.example.com', 
                username: 'demo_backup_user',
                password: 'DEMO_FAKE_backup_password_2023_ailock_demo'
              }
            }, null, 2),
            sensitive: true
          },
          {
            path: 'keys/server.key',
            content: `-----BEGIN PRIVATE KEY-----
⚠️ AILOCK DEMO - FAKE SSL PRIVATE KEY FOR DEMONSTRATION ONLY ⚠️
This is NOT a real private key - it's a placeholder for ailock protection demo
DO NOT USE this in any real application - generate your own keys!

MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7DEMO_FAKE...
[This is a FAKE SSL private key placeholder for ailock demonstration]
...DEMO ONLY - not real cryptographic material for security...
DEMO_FAKE_PRIVATE_KEY_CONTENT_FOR_AILOCK_PROTECTION_DEMONSTRATION
-----END PRIVATE KEY-----`,
            sensitive: true
          },
          {
            path: 'src/config/app.js',
            content: `// Application Configuration
const config = {
  app: {
    name: 'Amazing SaaS App',
    version: '2.1.0',
    port: process.env.PORT || 3000
  },
  security: {
    encryptionKey: process.env.ENCRYPTION_KEY,
    jwtSecret: process.env.JWT_SECRET
  }
};

export default config;`,
            sensitive: false
          },
          {
            path: 'README.md',
            content: `# Amazing SaaS Application

This is our production-ready SaaS application.

## Setup
1. Copy \`.env.example\` to \`.env\`
2. Configure your database settings
3. Run \`npm install\`
4. Run \`npm start\`

## Security Notice
Never commit sensitive files like .env or private keys!`,
            sensitive: false
          },
          {
            path: 'package.json',
            content: JSON.stringify({
              name: 'amazing-saas-app',
              version: '2.1.0',
              description: 'Production SaaS application',
              main: 'src/app.js',
              scripts: {
                start: 'node src/app.js',
                dev: 'nodemon src/app.js',
                test: 'jest'
              },
              dependencies: {
                express: '^4.18.0',
                mongoose: '^6.0.0',
                jsonwebtoken: '^8.5.0'
              }
            }, null, 2),
            sensitive: false
          }
        ]
      }
    ];
  }

  /**
   * Create demo environment with realistic files
   */
  async createDemoEnvironment(scenario: DemoScenario): Promise<DemoMetrics> {
    const startTime = Date.now();
    
    // Create demo directory
    await fs.mkdir(this.demoDir, { recursive: true });
    process.chdir(this.demoDir);
    
    this.cleanupCallbacks.push(async () => {
      process.chdir(this.originalCwd);
      if (existsSync(this.demoDir)) {
        await fs.rm(this.demoDir, { recursive: true, force: true });
      }
    });

    let filesCreated = 0;
    
    // Create all scenario files
    for (const file of scenario.files) {
      const filePath = join(this.demoDir, file.path);
      const dirPath = resolve(filePath, '..');
      
      // Create directory if needed
      await fs.mkdir(dirPath, { recursive: true });
      
      // Write file content
      await fs.writeFile(filePath, file.content, 'utf-8');
      filesCreated++;
    }

    // Initialize git repository for demo
    try {
      await execAsync('git init');
      await execAsync('git config user.email "demo@ailock.dev"');
      await execAsync('git config user.name "AILock Demo"');
      await execAsync('git add README.md package.json src/');
      await execAsync('git commit -m "Initial demo project setup"');
    } catch (error) {
      // Git setup is optional for demo
    }

    // Create .ailock configuration
    const ailockConfig = `# AI-Proof File Guard - Demo Configuration
# Protects sensitive files from accidental AI modifications

.env
.env.*
!.env.example
config/*.json
keys/*.key
keys/*.pem
**/secrets.json
**/*.key
**/*.pem

# Demo: Production configuration files
config/database.json
keys/server.key`;

    await fs.writeFile(join(this.demoDir, '.ailock'), ailockConfig);

    const protectionTime = Date.now() - startTime;

    return {
      filesCreated,
      filesProtected: 0, // Will be updated after protection
      protectionTime,
      platformDetected: getPlatformAdapter().constructor.name,
      gitHooksInstalled: false // Will be updated
    };
  }

  /**
   * Demonstrate file protection in action
   */
  async demonstrateProtection(): Promise<DemoMetrics> {
    const config = await loadConfig();
    const filesToProtect = await findProtectedFiles(config);
    
    const adapter = getPlatformAdapter();
    let filesProtected = 0;

    for (const file of filesToProtect) {
      try {
        await adapter.lockFile(file);
        filesProtected++;
      } catch (error) {
        // Some files might fail to lock, that's OK for demo
      }
    }

    // Install git hooks if possible
    let gitHooksInstalled = false;
    try {
      if (await isGitRepository()) {
        await installPreCommitHook(this.demoDir);
        gitHooksInstalled = true;
      }
    } catch (error) {
      // Git hooks are optional
    }

    return {
      filesCreated: filesToProtect.length,
      filesProtected,
      protectionTime: 0,
      platformDetected: adapter.constructor.name,
      gitHooksInstalled
    };
  }

  /**
   * Simulate AI trying to modify protected files
   */
  async simulateAIModification(filePath: string): Promise<{ blocked: boolean; error?: string }> {
    const fullPath = join(this.demoDir, filePath);
    
    try {
      // Try to write to the file (this should fail if protected)
      await fs.writeFile(fullPath, 'MODIFIED BY AI - This should not happen!', 'utf-8');
      return { blocked: false };
    } catch (error) {
      return { 
        blocked: true, 
        error: error instanceof Error ? error.message : 'Permission denied'
      };
    }
  }

  /**
   * Get current demo directory status
   */
  async getDemoStatus(): Promise<{
    files: Array<{ path: string; protected: boolean; readable: boolean }>;
    gitHooks: boolean;
    totalFiles: number;
    protectedFiles: number;
  }> {
    const config = await loadConfig();
    const protectedFiles = await findProtectedFiles(config);
    const adapter = getPlatformAdapter();
    
    const files = [];
    let protectedCount = 0;

    for (const file of protectedFiles) {
      const isProtected = await adapter.isLocked(file);
      const isReadable = existsSync(file);
      
      files.push({
        path: file.replace(this.demoDir + '/', ''),
        protected: isProtected,
        readable: isReadable
      });
      
      if (isProtected) protectedCount++;
    }

    const gitHooks = await isGitRepository() && existsSync(join(this.demoDir, '.git', 'hooks', 'pre-commit'));

    return {
      files,
      gitHooks,
      totalFiles: files.length,
      protectedFiles: protectedCount
    };
  }

  /**
   * Clean up demo environment
   */
  async cleanup(): Promise<void> {
    for (const callback of this.cleanupCallbacks.reverse()) {
      try {
        await callback();
      } catch (error) {
        console.warn(chalk.yellow('Cleanup warning:'), error);
      }
    }
    this.cleanupCallbacks = [];
  }

  /**
   * Get demo directory path for inspection
   */
  getDemoDirectory(): string {
    return this.demoDir;
  }

  /**
   * Get metrics for presentation
   */
  getViralMetrics(): {
    timeToProtect: string;
    filesSupported: string;
    platformsCovered: string;
    enterpriseFeatures: string[];
  } {
    return {
      timeToProtect: '< 2 seconds',
      filesSupported: '20+ file types',
      platformsCovered: 'Windows, macOS, Linux, WSL',
      enterpriseFeatures: [
        'Cross-platform file locking',
        'Git pre-commit hooks',
        'AI tool integration',
        'Smart pattern detection',
        'Zero-config setup',
        'Enterprise security'
      ]
    };
  }
}