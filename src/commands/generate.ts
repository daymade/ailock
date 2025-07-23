import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

interface Template {
  name: string;
  description: string;
  category: 'ci-cd' | 'docker' | 'devcontainer';
  files: {
    source: string;
    target: string;
    description: string;
  }[];
  instructions?: string[];
}

const TEMPLATES: Template[] = [
  {
    name: 'github-actions',
    description: 'GitHub Actions workflow for ailock protection validation',
    category: 'ci-cd',
    files: [
      {
        source: 'ci-cd/github-actions.yml',
        target: '.github/workflows/ailock-protection.yml',
        description: 'GitHub Actions workflow file'
      }
    ],
    instructions: [
      'Commit and push the workflow file to enable automated protection checks',
      'The workflow will run on every push and pull request',
      'Check the Actions tab in your GitHub repository for results'
    ]
  },
  {
    name: 'gitlab-ci',
    description: 'GitLab CI/CD pipeline for ailock protection validation',
    category: 'ci-cd',
    files: [
      {
        source: 'ci-cd/gitlab-ci.yml',
        target: '.gitlab-ci.yml',
        description: 'GitLab CI/CD configuration (will merge with existing)'
      }
    ],
    instructions: [
      'Review and merge with any existing .gitlab-ci.yml configuration',
      'Commit and push to trigger the pipeline',
      'Check the CI/CD section in your GitLab project for results'
    ]
  },
  {
    name: 'docker-production',
    description: 'Production Dockerfile with ailock integration',
    category: 'docker',
    files: [
      {
        source: 'docker/Dockerfile.prod',
        target: 'Dockerfile.prod',
        description: 'Production Dockerfile with ailock protection'
      },
      {
        source: 'docker/docker-compose.yml',
        target: 'docker-compose.prod.yml',
        description: 'Production docker-compose configuration'
      }
    ],
    instructions: [
      'Review and customize the Dockerfile for your application',
      'Update docker-compose.prod.yml with your specific services',
      'Build with: docker build -f Dockerfile.prod -t myapp:prod .',
      'Run with: docker-compose -f docker-compose.prod.yml up'
    ]
  },
  {
    name: 'devcontainer',
    description: 'VS Code Dev Container with ailock integration',
    category: 'devcontainer',
    files: [
      {
        source: 'devcontainer/devcontainer.json',
        target: '.devcontainer/devcontainer.json',
        description: 'VS Code Dev Container configuration'
      },
      {
        source: 'devcontainer/setup.sh',
        target: '.devcontainer/setup.sh',
        description: 'Container setup script with ailock integration'
      }
    ],
    instructions: [
      'Open the project in VS Code',
      'Install the Dev Containers extension if not already installed',
      'Click "Reopen in Container" when prompted',
      'The container will automatically set up ailock protection'
    ]
  }
];

export const generateCommand = new Command('generate')
  .alias('gen')
  .description('Generate integration templates for CI/CD, Docker, and development environments')
  .option('-t, --template <name>', 'Generate specific template by name')
  .option('-c, --category <category>', 'Generate all templates in category (ci-cd, docker, devcontainer)')
  .option('-l, --list', 'List all available templates')
  .option('-f, --force', 'Overwrite existing files')
  .option('--dry-run', 'Show what would be generated without creating files')
  .action(async (options) => {
    try {
      if (options.list) {
        await listTemplates();
        return;
      }

      let templatesToGenerate: Template[] = [];

      if (options.template) {
        const template = TEMPLATES.find(t => t.name === options.template);
        if (!template) {
          console.error(chalk.red(`Template "${options.template}" not found`));
          console.log(chalk.gray('Available templates:'));
          TEMPLATES.forEach(t => console.log(chalk.gray(`  - ${t.name}`)));
          process.exit(1);
        }
        templatesToGenerate = [template];
      } else if (options.category) {
        templatesToGenerate = TEMPLATES.filter(t => t.category === options.category);
        if (templatesToGenerate.length === 0) {
          console.error(chalk.red(`No templates found in category "${options.category}"`));
          process.exit(1);
        }
      } else {
        // Interactive selection
        const { selectedTemplates } = await inquirer.prompt([
          {
            type: 'checkbox',
            name: 'selectedTemplates',
            message: 'Select templates to generate:',
            choices: TEMPLATES.map(t => ({
              name: `${t.name} - ${t.description}`,
              value: t.name,
              checked: false
            }))
          }
        ]);

        if (selectedTemplates.length === 0) {
          console.log(chalk.yellow('No templates selected'));
          return;
        }

        templatesToGenerate = TEMPLATES.filter(t => selectedTemplates.includes(t.name));
      }

      // Generate selected templates
      for (const template of templatesToGenerate) {
        await generateTemplate(template, options);
      }

    } catch (error) {
      console.error(chalk.red('Error generating templates:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

async function listTemplates() {
  console.log(chalk.blue.bold('📋 Available ailock Templates\n'));

  const categories = ['ci-cd', 'docker', 'devcontainer'] as const;
  
  for (const category of categories) {
    const categoryTemplates = TEMPLATES.filter(t => t.category === category);
    if (categoryTemplates.length === 0) continue;

    console.log(chalk.yellow.bold(`${category.toUpperCase()} Templates:`));
    
    for (const template of categoryTemplates) {
      console.log(chalk.green(`  📄 ${template.name}`));
      console.log(chalk.gray(`     ${template.description}`));
      console.log(chalk.gray(`     Files: ${template.files.map(f => f.target).join(', ')}`));
      console.log();
    }
  }

  console.log(chalk.blue('💡 Usage examples:'));
  console.log(chalk.gray('  ailock generate --template github-actions'));
  console.log(chalk.gray('  ailock generate --category ci-cd'));
  console.log(chalk.gray('  ailock generate  # Interactive selection'));
}

async function generateTemplate(template: Template, options: any) {
  console.log(chalk.blue(`\n📄 Generating template: ${template.name}`));
  console.log(chalk.gray(`Description: ${template.description}\n`));

  // Check for existing files
  const existingFiles = template.files.filter(f => existsSync(f.target));
  
  if (existingFiles.length > 0 && !options.force) {
    console.log(chalk.yellow('⚠️  The following files already exist:'));
    existingFiles.forEach(f => console.log(chalk.yellow(`   ${f.target}`)));
    
    if (!options.dryRun) {
      const { shouldOverwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'shouldOverwrite',
          message: 'Overwrite existing files?',
          default: false
        }
      ]);

      if (!shouldOverwrite) {
        console.log(chalk.gray('Skipping template generation'));
        return;
      }
    }
  }

  // Generate files
  for (const file of template.files) {
    if (options.dryRun) {
      console.log(chalk.cyan(`  📝 Would create: ${file.target}`));
      console.log(chalk.gray(`     ${file.description}`));
      continue;
    }

    try {
      // Read template content
      const templatePath = path.join(__dirname, '..', 'templates', file.source);
      const templateContent = await readFile(templatePath, 'utf-8');
      
      // Ensure target directory exists
      const targetDir = path.dirname(file.target);
      if (targetDir !== '.') {
        await mkdir(targetDir, { recursive: true });
      }
      
      // Handle special cases for file merging
      let finalContent = templateContent;
      
      if (file.target === '.gitlab-ci.yml' && existsSync(file.target)) {
        // Merge with existing GitLab CI configuration
        const existingContent = await readFile(file.target, 'utf-8');
        finalContent = mergeGitLabCI(existingContent, templateContent);
        console.log(chalk.yellow(`  🔀 Merged with existing ${file.target}`));
      }
      
      // Write file
      await writeFile(file.target, finalContent);
      console.log(chalk.green(`  ✅ Created ${file.target}`));
      console.log(chalk.gray(`     ${file.description}`));
      
    } catch (error) {
      console.error(chalk.red(`  ❌ Failed to create ${file.target}:`), error instanceof Error ? error.message : String(error));
    }
  }

  // Show instructions
  if (template.instructions && template.instructions.length > 0) {
    console.log(chalk.blue('\n💡 Next Steps:'));
    template.instructions.forEach((instruction, index) => {
      console.log(chalk.gray(`   ${index + 1}. ${instruction}`));
    });
  }
}

function mergeGitLabCI(existing: string, template: string): string {
  // Simple merge strategy: append ailock jobs to existing configuration
  // In a production implementation, you'd want proper YAML parsing and merging
  
  const separator = '\n\n# === AI-Proof File Guard Integration ===\n';
  
  // Extract just the job definitions from template (skip the header)
  const templateLines = template.split('\n');
  let jobStart = templateLines.findIndex(line => line.includes('ailock-protection:'));
  
  if (jobStart === -1) {
    return existing + separator + template;
  }
  
  const templateJobs = templateLines.slice(jobStart).join('\n');
  
  return existing + separator + templateJobs;
}