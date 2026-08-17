export interface CompletionSubcommandSpec {
  options?: readonly string[];
}

export interface CompletionCommandSpec {
  description: string;
  options?: readonly string[];
  values?: readonly string[];
  subcommands?: Readonly<Record<string, CompletionSubcommandSpec>>;
}

export interface CompletionGlobalOptionSpec {
  flags: readonly string[];
  description: string;
}

/**
 * Canonical public root options. Tests compare these entries with the actual
 * root help output so Commander and every shell generator stay aligned.
 */
export const PUBLIC_GLOBAL_OPTIONS = [
  { flags: ['-q', '--quiet'], description: 'Suppress informational output' },
  { flags: ['-h', '--help'], description: 'Display help' },
  { flags: ['-V', '--version'], description: 'Display version' }
] as const satisfies readonly CompletionGlobalOptionSpec[];

export const PUBLIC_GLOBAL_OPTION_WORDS = PUBLIC_GLOBAL_OPTIONS.flatMap(
  option => option.flags
);

/**
 * Canonical public completion surface. The CLI registration tree remains the
 * authority; tests compare this manifest with Commander so the four generated
 * shell integrations cannot silently drift from it.
 */
export const PUBLIC_COMPLETION_SPEC = {
  init: {
    description: 'Initialize ailock configuration',
    options: ['--force', '--interactive', '--config-only', '--with-ai-docs', '--no-ai-hooks']
  },
  lock: {
    description: 'Lock files to prevent modifications',
    options: ['--all', '--verbose', '--dry-run', '--no-gitignore', '--no-hooks', '--hooks-only']
  },
  unlock: {
    description: 'Unlock files to allow modifications',
    options: ['--all', '--verbose', '--dry-run', '--no-gitignore']
  },
  protect: {
    description: 'Complete file protection (lock + hooks)',
    options: ['--all', '--verbose', '--dry-run', '--no-gitignore']
  },
  auth: {
    description: 'Redeem an authentication code',
    options: ['--verbose', '--dry-run']
  },
  quota: {
    description: 'Manage quota and preferences',
    subcommands: {
      status: {},
      sync: {},
      reset: { options: ['--force'] },
      debug: {},
      config: { options: ['--offline', '--analytics', '--privacy', '--telemetry'] },
      repair: { options: ['--auto'] }
    }
  },
  edit: {
    description: 'Temporarily unlock, edit, and relock a file',
    options: ['--editor', '--timeout', '--no-relock', '--verbose']
  },
  'emergency-unlock': {
    description: 'Recover files from orphaned locks',
    options: ['--force', '--all', '--verbose']
  },
  doctor: {
    description: 'Check ailock installation health',
    options: ['--fix', '--verbose']
  },
  status: {
    description: 'Show protection status',
    options: ['--interactive', '--verbose', '--simple', '--json', '--skip-analytics']
  },
  list: {
    description: 'List protected files',
    options: ['--long', '--locked-only', '--json']
  },
  diagnose: {
    description: 'Diagnose file protection issues',
    options: ['--verbose']
  },
  generate: {
    description: 'Generate CI/CD and container configs',
    options: ['--template', '--category', '--list', '--force', '--dry-run'],
    values: ['github-actions', 'gitlab-ci', 'docker-production', 'devcontainer', 'ci-cd', 'docker']
  },
  hooks: {
    description: 'Manage Claude Code and Git hooks',
    subcommands: {
      setup: { options: ['--force'] },
      install: { options: ['--force'] },
      uninstall: {},
      status: {},
      git: { options: ['--force'] }
    }
  },
  completion: {
    description: 'Generate shell completion script',
    options: ['--install-instructions'],
    values: ['bash', 'zsh', 'fish', 'powershell']
  },
  'setup-completion': {
    description: 'Interactive completion setup'
  },
  help: {
    description: 'Show help information'
  }
} as const satisfies Readonly<Record<string, CompletionCommandSpec>>;

export const PUBLIC_COMMAND_NAMES = Object.keys(PUBLIC_COMPLETION_SPEC);

export function completionWords(command: keyof typeof PUBLIC_COMPLETION_SPEC): string[] {
  const spec = PUBLIC_COMPLETION_SPEC[command] as CompletionCommandSpec;
  const subcommands = Object.keys(spec.subcommands || {});
  const nestedOptions = Object.values(spec.subcommands || {}).flatMap(item => item.options || []);
  return [...(spec.options || []), ...(spec.values || []), ...subcommands, ...nestedOptions];
}
