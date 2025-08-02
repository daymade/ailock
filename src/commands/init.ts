import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { InitWizard } from '../ui/components/InitWizard.js';
import { isGitRepository, installPreCommitHook, getRepoRoot } from '../core/git.js';
import { loadConfig, findProtectedFiles } from '../core/config.js';
import { getPlatformAdapter } from '../core/platform.js';

/**
 * Detect project type based on existing files
 */
function detectProjectType(): { type: string; patterns: string[] } {
  const detections = [
    {
      type: 'Node.js',
      files: ['package.json'],
      patterns: [
        '.env',
        '.env.*',
        '!.env.example',
        'config/*.json',
        'config/*.yaml',
        '**/*.key',
        '**/*.pem',
        '**/secrets.json'
      ]
    },
    {
      type: 'Docker',
      files: ['docker-compose.yml', 'docker-compose.yaml', 'Dockerfile'],
      patterns: [
        '.env',
        '.env.*',
        '!.env.example',
        'docker-compose.yml',
        'docker-compose.*.yml',
        'Dockerfile.prod',
        'k8s/**/*.yaml',
        'config/*.yaml',
        '**/*.key',
        '**/*.pem'
      ]
    },
    {
      type: 'Python',
      files: ['requirements.txt', 'pyproject.toml', 'setup.py'],
      patterns: [
        '.env',
        '.env.*',
        '!.env.example',
        'config/*.json',
        'config/*.yaml',
        '**/*.key',
        '**/*.pem',
        '**/secrets.json',
        '*.db',
        '*.sqlite'
      ]
    }
  ];

  for (const detection of detections) {
    if (detection.files.some(file => existsSync(file))) {
      return { type: detection.type, patterns: detection.patterns };
    }
  }

  // Default generic project
  return {
    type: 'Generic',
    patterns: [
      '.env',
      '.env.*',
      '!.env.example',
      '**/*.key',
      '**/*.pem',
      '**/secrets.json'
    ]
  };
}

/**
 * Generate .ailock configuration content
 */
function generateAilockConfig(projectType: string, patterns: string[]): string {
  return `# AI-Proof File Guard Configuration
# Generated for: ${projectType} project
# Protects sensitive files from accidental AI modifications

${patterns.map(pattern => pattern.startsWith('!') ? pattern : pattern).join('\n')}

# Add your own patterns below:
`;
}

/**
 * Complete project security setup
 */
async function performCompleteSetup(options: any): Promise<void> {
  console.log(chalk.blue.bold('🚀 AI-Proof File Guard - Complete Project Setup\n'));

  // Step 1: Detect project type
  console.log(chalk.cyan('📋 Step 1: Project Detection'));
  const { type, patterns } = detectProjectType();
  console.log(chalk.green(`   ✅ Detected: ${type} project`));
  console.log(chalk.gray(`   📦 Found ${patterns.length} protection patterns`));

  // Step 2: Generate .ailock config
  console.log(chalk.cyan('\n⚙️  Step 2: Configuration'));
  const configContent = generateAilockConfig(type, patterns);
  await writeFile('.ailock', configContent);
  console.log(chalk.green('   ✅ Created .ailock configuration'));

  // Step 3: Install Git hooks (if applicable)
  console.log(chalk.cyan('\n🪝 Step 3: Git Integration'));
  const isGitRepo = await isGitRepository();
  if (isGitRepo) {
    try {
      const repoRoot = await getRepoRoot();
      if (repoRoot) {
        await installPreCommitHook(repoRoot, options.force);
        console.log(chalk.green('   ✅ Installed Git pre-commit hooks'));
      }
    } catch (error) {
      console.log(chalk.yellow('   ⚠️  Git hooks installation skipped'));
      console.log(chalk.gray(`   💡 Run: ailock install-hooks (later)`));
    }
  } else {
    console.log(chalk.gray('   ℹ️  Not a Git repository - hooks skipped'));
  }

  // Step 4: Execute first protection
  console.log(chalk.cyan('\n🔒 Step 4: Initial Protection'));
  try {
    const config = await loadConfig(undefined, { includeGitignored: true });
    const filesToLock = await findProtectedFiles(config);
    
    if (filesToLock.length > 0) {
      const adapter = getPlatformAdapter();
      let lockedCount = 0;
      
      for (const file of filesToLock) {
        try {
          await adapter.lockFile(file);
          lockedCount++;
        } catch (error) {
          console.log(chalk.yellow(`   ⚠️  Could not lock: ${file}`));
        }
      }
      
      console.log(chalk.green(`   ✅ Protected ${lockedCount} sensitive files`));
    } else {
      console.log(chalk.gray('   ℹ️  No sensitive files found to protect'));
    }
  } catch (error) {
    console.log(chalk.yellow('   ⚠️  Initial protection skipped'));
    console.log(chalk.gray('   💡 Run: ailock lock (later)'));
  }

  // Step 5: Show status and next steps
  console.log(chalk.cyan('\n📊 Step 5: Project Status'));
  console.log(chalk.green('🎉 Setup Complete! Your project is now AI-proof.'));
  
  console.log(chalk.blue.bold('\n💡 Quick Commands:'));
  console.log(chalk.gray('   ailock status           # Check protection status'));
  console.log(chalk.gray('   ailock lock             # Protect more files'));
  console.log(chalk.gray('   ailock unlock [file]    # Unlock for editing'));
  
  console.log(chalk.blue.bold('\n🔍 What happened:'));
  console.log(chalk.gray('   • Detected your project type and created .ailock config'));
  console.log(chalk.gray('   • Installed Git hooks to prevent accidental commits'));
  console.log(chalk.gray('   • Protected sensitive files with OS-level locks'));
  console.log(chalk.gray('   • AI tools can read these files but cannot modify them'));
}

export const initCommand = new Command('init')
  .description('🚀 Complete project security setup - one command to protect everything')
  .option('-f, --force', 'Overwrite existing configuration and hooks')
  .option('--interactive', 'Use detailed interactive wizard for custom setup')
  .option('--config-only', 'Only create .ailock configuration file')
  .action(async (options) => {
    try {
      // Check if .ailock already exists
      if (existsSync('.ailock') && !options.force) {
        console.log(chalk.yellow('⚠️  .ailock file already exists'));
        console.log(chalk.gray('Use --force to overwrite, or run: ailock status'));
        return;
      }

      if (options.interactive) {
        // Use the existing detailed wizard
        const { waitUntilExit } = render(
          React.createElement(InitWizard, {
            onComplete: () => {
              console.log(chalk.green('\n✅ Interactive setup complete!'));
              process.exit(0);
            },
            onCancel: () => {
              console.log(chalk.gray('\nSetup cancelled'));
              process.exit(0);
            }
          })
        );
        
        await waitUntilExit();
      } else if (options.configOnly) {
        // Just create config file
        const { type, patterns } = detectProjectType();
        const configContent = generateAilockConfig(type, patterns);
        await writeFile('.ailock', configContent);
        console.log(chalk.green(`✅ Created .ailock configuration for ${type} project`));
        console.log(chalk.gray('Run: ailock lock (to start protection)'));
      } else {
        // Default: Complete setup
        await performCompleteSetup(options);
      }
    } catch (error) {
      console.error(chalk.red('Error during setup:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });