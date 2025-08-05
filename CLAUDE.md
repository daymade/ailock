# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ailock is a CLI tool that protects sensitive files from accidental AI modifications. It provides "AI can read but not write" protection through OS-level file locking mechanisms, Git hooks, and smart .gitignore integration.

## Common Development Commands

### Building and Development
```bash
npm run build        # Compile TypeScript to JavaScript (dist/)
npm run dev         # Run TypeScript directly with tsx (development)
```

### Testing Shell Completions
```bash
# Generate and test completion scripts
node dist/index.js completion bash    # Generate bash completion
node dist/index.js completion zsh     # Generate zsh completion
node dist/index.js completion-helper --type commands  # Test completion helper

# Test completion functionality
source <(node dist/index.js completion bash)
# Then type: ailock <TAB> to test
```

### Testing
```bash
npm test            # Run all tests with vitest
npm run test:run    # Run tests once (CI mode)

# Run specific test file
npx vitest tests/unit/config.test.ts

# Run tests in watch mode (default)
npm test
```

### Publishing
```bash
npm run prepublishOnly  # Automatically runs build before publishing
npm publish             # Publish to npm registry
```

## High-Level Architecture

### Core Design Principles
1. **Cross-platform compatibility**: The tool must work consistently across Linux, macOS, Windows, and WSL
2. **Graceful degradation**: If advanced locking fails, fall back to basic read-only protection
3. **AI-friendly**: Protected files remain readable for AI context but cannot be modified

### Key Components

#### Command System (`src/commands/`)
- Each command is a separate module exporting a Commander.js command
- Commands handle CLI interaction and delegate to core functionality
- Interactive commands use Ink (React) for terminal UI

#### Core Functionality (`src/core/`)
- `platform.ts`: Cross-platform file locking/unlocking abstraction
  - Linux: chmod + chattr (immutable flag)
  - macOS: chmod + chflags (uchg flag)
  - Windows: attrib + icacls (ACL-based)
- `config.ts`: Configuration loading and pattern parsing
  - Supports .ailock files with gitignore syntax
  - Smart .gitignore integration for sensitive file discovery
- `git.ts`: Git repository operations and hook management

#### Security Layer (`src/security/`)
- `AtomicFileManager.ts`: Safe file operations with atomic writes
- `CommandExecutor.ts`: Secure command execution with validation
- `PathValidator.ts`: Path validation and security checks
- `ErrorHandler.ts`: Centralized error handling with recovery

#### UI Components (`src/ui/components/`)
- `InitWizard.tsx`: Interactive setup wizard using Ink
- `StatusDashboard.tsx`: Real-time status monitoring dashboard

#### Shell Completion System (`src/completion/`)
- `commands/completion.ts`: Main completion command that generates shell scripts
- `commands/completion-helper.ts`: Hidden command providing dynamic completions
- `completion/templates/`: Shell-specific completion scripts (bash, zsh, fish, PowerShell)

The completion system uses a two-tier approach:
1. **Static completions**: Commands and options are embedded in shell scripts
2. **Dynamic completions**: File paths and context-aware suggestions are fetched via `completion-helper`

### File Protection Strategy

1. **Discovery**: Find files via .ailock config or .gitignore patterns
2. **Validation**: Ensure files exist and are within project bounds
3. **Locking**: Apply OS-specific protection mechanisms
4. **Verification**: Confirm protection was applied successfully

### Git Integration

The tool installs pre-commit hooks that:
1. Check if any staged files are protected
2. Prevent commits of protected files
3. Provide clear error messages with unlock instructions

## Development Workflow

1. **Making Changes**: Edit TypeScript files in `src/`
2. **Testing Locally**: Use `npm run dev` to test changes without building
3. **Running Tests**: Use `npm test` to ensure changes don't break functionality
4. **Building**: Run `npm run build` to compile to JavaScript
5. **Testing Built Version**: Test the compiled version in `dist/`

## Important Considerations

### Platform-Specific Behavior
- Always test file locking changes on all platforms
- Windows requires special handling for permissions
- WSL detection is crucial for proper filesystem operations

### Error Handling
- All commands should provide helpful error messages
- Include recovery suggestions when operations fail
- Never leave files in an inconsistent state

### Performance
- File operations should be batched when possible
- Use fast-glob for pattern matching efficiency
- Minimize filesystem calls in hot paths

### Security
- Validate all file paths to prevent directory traversal
- Use atomic file operations for configuration changes
- Never expose or log sensitive file contents

## Testing Approach

Tests are organized into:
- `tests/unit/`: Unit tests for individual functions
- `tests/integration/`: Integration tests for command workflows

Key test scenarios:
- Cross-platform file operations
- Configuration parsing edge cases
- Git hook installation and execution
- Error recovery mechanisms

Use `vitest` for all testing needs. Tests can be run individually or in watch mode for development.