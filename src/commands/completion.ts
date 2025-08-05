import { Command } from 'commander';
import chalk from 'chalk';
import { generateBashCompletion } from '../completion/templates/bash.js';
import { generateZshCompletion } from '../completion/templates/zsh.js';
import { generateFishCompletion } from '../completion/templates/fish.js';
import { generatePowerShellCompletion } from '../completion/templates/powershell.js';

type Shell = 'bash' | 'zsh' | 'fish' | 'powershell';

const shellGenerators: Record<Shell, () => string> = {
  bash: generateBashCompletion,
  zsh: generateZshCompletion,
  fish: generateFishCompletion,
  powershell: generatePowerShellCompletion
};

const installInstructions: Record<Shell, string> = {
  bash: `
# Add this to your ~/.bashrc or ~/.bash_profile:
source <(ailock completion bash)

# Or save to a file and source it:
ailock completion bash > ~/.ailock-completion.bash
echo "source ~/.ailock-completion.bash" >> ~/.bashrc
`,
  zsh: `
# Add this to your ~/.zshrc:
source <(ailock completion zsh)

# Or save to completion directory:
ailock completion zsh > ~/.zsh/completions/_ailock
# Make sure ~/.zsh/completions is in your $fpath
`,
  fish: `
# Save to Fish completions directory:
ailock completion fish > ~/.config/fish/completions/ailock.fish

# Or for system-wide installation:
ailock completion fish | sudo tee /usr/share/fish/vendor_completions.d/ailock.fish
`,
  powershell: `
# Add to your PowerShell profile:
ailock completion powershell | Out-String | Invoke-Expression

# To edit your profile:
notepad $PROFILE
`
};

export const completionCommand = new Command('completion')
  .description('Generate shell completion script')
  .argument('<shell>', 'Target shell (bash, zsh, fish, powershell)')
  .option('--install-instructions', 'Show installation instructions')
  .action((shell: string, options) => {
    const targetShell = shell.toLowerCase() as Shell;
    
    if (!shellGenerators[targetShell]) {
      console.error(chalk.red(`Error: Unsupported shell "${shell}"`));
      console.error(chalk.yellow('Supported shells: bash, zsh, fish, powershell'));
      process.exit(1);
    }
    
    if (options.installInstructions) {
      console.log(chalk.blue.bold(`\n🚀 Installation Instructions for ${targetShell}:\n`));
      console.log(installInstructions[targetShell]);
      console.log(chalk.gray('\nAfter installation, restart your shell or source your config file.'));
      return;
    }
    
    try {
      const completionScript = shellGenerators[targetShell]();
      console.log(completionScript);
    } catch (error) {
      console.error(chalk.red('Error generating completion script:'), error);
      process.exit(1);
    }
  });

// Add a convenience setup command
export const setupCompletionCommand = new Command('setup-completion')
  .description('Interactive shell completion setup')
  .action(async () => {
    console.log(chalk.blue.bold('🚀 ailock Shell Completion Setup\n'));
    
    // Detect current shell
    const currentShell = detectShell();
    
    if (!currentShell) {
      console.log(chalk.yellow('Could not detect your shell automatically.'));
      console.log(chalk.gray('Please run one of the following commands:\n'));
      
      Object.keys(shellGenerators).forEach(shell => {
        console.log(chalk.cyan(`  ailock completion ${shell} --install-instructions`));
      });
      return;
    }
    
    console.log(chalk.green(`✓ Detected shell: ${currentShell}`));
    console.log(chalk.gray('\nTo enable completions, follow these steps:'));
    console.log(installInstructions[currentShell]);
    
    console.log(chalk.blue.bold('\n✨ Features:'));
    console.log(chalk.gray('  • Command completion (init, lock, unlock, etc.)'));
    console.log(chalk.gray('  • File path completion based on .ailock patterns'));
    console.log(chalk.gray('  • Option completion for each command'));
    console.log(chalk.gray('  • Context-aware suggestions (locked/unlocked files)'));
  });

function detectShell(): Shell | null {
  const shell = process.env.SHELL;
  
  if (!shell) return null;
  
  if (shell.includes('bash')) return 'bash';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('fish')) return 'fish';
  
  // Check for PowerShell on Windows
  if (process.platform === 'win32' && process.env.PSModulePath) {
    return 'powershell';
  }
  
  return null;
}