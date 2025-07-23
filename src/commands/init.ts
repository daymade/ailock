import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import chalk from 'chalk';
import { existsSync } from 'fs';
import { InitWizard } from '../ui/components/InitWizard.js';

export const initCommand = new Command('init')
  .description('Initialize ailock configuration with interactive wizard')
  .option('-f, --force', 'Overwrite existing .ailock file')
  .option('--skip-wizard', 'Create basic .ailock file without wizard')
  .action(async (options) => {
    try {
      // Check if .ailock already exists
      if (existsSync('.ailock') && !options.force) {
        console.log(chalk.yellow('⚠️  .ailock file already exists'));
        console.log(chalk.gray('Use --force to overwrite, or edit the file manually'));
        return;
      }

      if (options.skipWizard) {
        // Create basic .ailock file
        const { writeFile } = await import('fs/promises');
        const basicContent = `# AI-Proof File Guard Configuration
# Protect sensitive files from accidental AI modifications

# Environment files
.env
.env.*
!.env.example

# Configuration files
config/*.json
config/*.yaml

# Security files
**/*.key
**/*.pem
**/secrets.json

# Add your own patterns below:
`;
        
        await writeFile('.ailock', basicContent);
        console.log(chalk.green('✅ Created basic .ailock configuration'));
        console.log(chalk.gray('Edit .ailock to customize protection patterns'));
        return;
      }

      // Start interactive wizard
      const { waitUntilExit } = render(
        React.createElement(InitWizard, {
          onComplete: () => {
            console.log(chalk.green('\n✅ Workspace initialization complete!'));
            process.exit(0);
          },
          onCancel: () => {
            console.log(chalk.gray('\nInitialization cancelled'));
            process.exit(0);
          }
        })
      );
      
      await waitUntilExit();
    } catch (error) {
      console.error(chalk.red('Error during initialization:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });