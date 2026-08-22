# AI-Proof File Guard (ailock)

[![npm version](https://badge.fury.io/js/ailock.svg)](https://badge.fury.io/js/ailock)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI Status](https://github.com/daymade/ailock/actions/workflows/ci.yml/badge.svg)](https://github.com/daymade/ailock/actions/workflows/ci.yml)

**🛡️ Protect your local configs from AI coding assistants' well-meaning modifications**

AI-Proof File Guard (`ailock`) is a developer-friendly CLI tool that prevents AI coding assistants (Cursor, GitHub Copilot, Claude, etc.) from accidentally modifying your local configuration files. It provides "AI can read but not write" protection for files like `.env`, `docker-compose.yml`, `settings.json`, and other configs you don't want AI to touch. Keep all the benefits of AI assistance while protecting your local development environment.

## 🚀 Quick Start

### Installation

```bash
# Install globally via npm
npm install -g ailock

# Or run directly with npx (no installation needed)
npx ailock lock .env
```

### **🚀 Project Setup**

```bash
# One command to protect your entire project
ailock init

# That's it! Your project is now AI-proof
# AI can still read sensitive files for context, but cannot modify them
```

### **Progressive Enhancement**

```bash
# Level 1: Complete project setup (recommended)
ailock init                    # Smart setup: config + hooks + protection

# Level 2: Manual file protection
ailock lock .env secrets.json  # Lock specific files
ailock lock                    # Lock all configured files (includes .gitignore)

# Level 3: Advanced usage
ailock lock --no-gitignore     # Exclude .gitignore integration
ailock status                  # Smart status (detailed in terminal, simple in CI)
ailock unlock .env             # Unlock for editing
```

### **Common Use Cases**

```bash
# Protect environment files during AI coding
ailock lock .env .env.local

# Protect API keys and secrets
ailock lock config/api-keys.json secrets/

# Protect production configurations
ailock lock docker-compose.prod.yml k8s/

# Protect SSH keys and certificates
ailock lock ~/.ssh/id_rsa *.pem

# Unlock when you need to edit, then re-lock
ailock unlock .env
# ... make your changes ...
ailock lock .env

# One-Command Project Setup
ailock init                    # Complete security setup for your project

# Smart .gitignore integration
ailock lock                    # Automatically includes .gitignore sensitive files
ailock lock --verbose          # See exactly what's being protected
```

## 🛡️ Why ailock?

### The Problem

AI coding assistants (GitHub Copilot, Claude Code, Cursor Agent) with "apply changes" modes can accidentally modify sensitive files during automated refactoring or code generation, potentially causing:

- 🔓 **Leaked secrets** in .env files
- 🔥 **Broken deployments** from modified config files
- 💥 **Service outages** from altered infrastructure scripts
- 🚨 **Security vulnerabilities** from changed access controls

**But here's the critical insight**: The most dangerous files are often **not in version control** (listed in `.gitignore`). Once these files are corrupted by AI tools, **you can't restore them from git** - they're simply lost forever.

### 💡 Developer-Friendly Design Philosophy

ailock uses **smart .gitignore integration** based on a simple but powerful observation:

> **Files in `.gitignore` are intentionally excluded from version control, making them unrecoverable if accidentally modified.**

Our design philosophy prioritizes **developer experience** without sacrificing security:

1. **Zero Configuration**: `ailock lock` works immediately without setup
2. **Smart Filtering**: Only protects _actually sensitive_ files from `.gitignore` (`.env`, `*.key`, etc.)
3. **Predictable Behavior**: Clear verbose output shows exactly what's being protected and why
4. **Non-Intrusive**: Existing workflows remain unchanged, new protection is opt-in

This approach respects the intelligence of `.gitignore` as a security boundary while providing the safety net that AI-assisted development demands.

### The Solution

ailock provides **multi-layer protection**:

1. **OS-level locks** - Files become read-only at the filesystem level
2. **Git hooks** - Prevents accidental commits of protected files
3. **IDE integration** - Works with editors through the same filesystem protection

**Key benefit**: AI tools can still **read and analyze** protected files for context, but **cannot modify** them.

## 📋 Configuration

### .ailock File

Create a `.ailock` file in your project root using gitignore-style syntax:

```bash
# Environment files
.env
.env.*
!.env.example

# Configuration files
config/*.json
config/*.yaml
config/*.yml

# Security files
**/*.key
**/*.pem
**/*.p12
**/*.crt
**/secrets.json
**/credentials.json

# Deployment scripts
scripts/deploy/**
docker-compose.production.yml
Dockerfile.prod

# Service definitions
services/**/*.yaml
k8s/**/*.yaml
```

### Default Patterns

If no `.ailock` file exists, these patterns are protected by default:

- `.env`
- `.env.*`
- `**/*.key`
- `**/*.pem`
- `**/secrets.json`

## 🎯 Core Command Reference

### Core Commands

#### `ailock init`

🚀 Complete project security setup - one command to protect everything.

```bash
ailock init                 # Smart setup: detect project + config + hooks + protection
ailock init --interactive   # Use detailed wizard for custom setup
ailock init --config-only   # Only create .ailock configuration file
ailock init --force        # Overwrite existing configuration and hooks
```

`ailock init` detects the project type, creates appropriate configuration, installs Git hooks, and protects sensitive files.

#### `ailock lock`

Lock files to prevent modifications.

```bash
ailock lock                       # Lock files (includes .gitignore by default)
ailock lock .env secrets/*        # Lock specific files/patterns
ailock lock --verbose             # Show detailed output
ailock lock --dry-run            # Preview changes without applying
ailock lock --no-gitignore       # Exclude .gitignore sensitive files
```

`.gitignore` integration is enabled by default. Use `--no-gitignore` to disable it.

#### `ailock unlock`

Unlock files to allow modifications.

```bash
ailock unlock                     # Unlock files (includes .gitignore by default)
ailock unlock .env               # Unlock specific files
ailock unlock --verbose          # Show detailed output
ailock unlock --dry-run         # Preview changes without applying
ailock unlock --no-gitignore     # Exclude .gitignore sensitive files
```

### Status & Monitoring

#### `ailock status`

Show current protection status with smart output detection.

```bash
ailock status              # Smart output (detailed in terminal, simple in CI)
ailock status --verbose    # Force detailed information
ailock status --simple     # Force simple output for scripts
ailock status --json --skip-analytics # Side-effect-free JSON output for automation
```

#### `ailock status --interactive`

Launch interactive real-time status dashboard.

```bash
ailock status --interactive           # Interactive dashboard
ailock status --interactive --verbose # Detailed dashboard view
```

#### `ailock list`

List all protected files and their status.

```bash
ailock list                # Show all protected files
ailock list --long         # Detailed file information
ailock list --locked-only  # Show only locked files
ailock list --json         # JSON output
```

### Git Integration

#### `ailock hooks`

Manage Git and AI-tool protection hooks.

```bash
ailock hooks setup          # Install Git and detected AI-tool hooks
ailock hooks git            # Install the Git pre-commit hook only
ailock hooks git --force    # Overwrite an existing Git hook
ailock hooks install claude # Install Claude Code hooks only
ailock hooks status         # Check installed AI-tool hooks
```

### Enterprise Features

#### `ailock generate`

Generate integration templates for CI/CD and development environments.

```bash
ailock generate                           # Interactive template selection
ailock generate --list                    # List all available templates
ailock generate --template github-actions # Generate specific template
ailock generate --category ci-cd          # Generate all CI/CD templates
ailock generate --dry-run                 # Preview without creating files
```

**Available Templates:**

- `github-actions` - GitHub Actions workflow for protection validation
- `gitlab-ci` - GitLab CI/CD pipeline integration
- `docker-production` - Production Dockerfile with ailock integration
- `devcontainer` - VS Code Dev Container with ailock setup

#### `ailock completion`

Generate shell completion scripts for enhanced CLI experience.

```bash
ailock completion bash                    # Generate bash completion script
ailock completion zsh                     # Generate zsh completion script
ailock completion fish                    # Generate fish completion script
ailock completion powershell              # Generate PowerShell completion script
ailock completion bash --install-instructions  # Show installation instructions
```

#### `ailock setup-completion`

Interactive setup for shell completions.

```bash
ailock setup-completion    # Auto-detect shell and show setup instructions
```

**Shell Completion Features:**

- **Command completion**: Auto-complete all ailock commands
- **Option completion**: Smart suggestions for command options
- **File path completion**: Context-aware file suggestions based on .ailock patterns
- **Dynamic completions**:
  - `ailock lock <TAB>` suggests unlocked files
  - `ailock unlock <TAB>` suggests locked files
  - `ailock generate <TAB>` suggests available templates

**Installation Examples:**

Bash:

```bash
# Add to ~/.bashrc
source <(ailock completion bash)
```

Zsh:

```bash
# Add to ~/.zshrc
source <(ailock completion zsh)
```

Fish:

```bash
# Save to completions directory
ailock completion fish > ~/.config/fish/completions/ailock.fish
```

PowerShell:

```powershell
# Add to $PROFILE
ailock completion powershell | Out-String | Invoke-Expression
```

## 🔧 Cross-Platform Support

ailock works consistently across all major platforms:

| Platform    | Lock Method          | Immutable Support       |
| ----------- | -------------------- | ----------------------- |
| **Linux**   | `chmod + chattr +i`  | ✅ Full support         |
| **macOS**   | `chmod + chflags`    | ✅ Partial support      |
| **Windows** | `attrib +R + icacls` | ⚠️ ACL-based            |
| **WSL**     | Hybrid detection     | ⚠️ Filesystem-dependent |

### Platform-Specific Notes

**Linux**: Uses `chattr +i` for immutable files when supported by filesystem (ext2/3/4, XFS, etc.)

**Windows**: Falls back to `icacls` for advanced permission scenarios. Some operations may require administrator privileges.

**WSL**: Automatically detects underlying filesystem and uses appropriate locking mechanism.

## 🚦 Workflow Integration

### Typical Development Flow

```bash
# 1. Initial setup
ailock lock                    # Lock sensitive files

# 2. Development work
# AI tools can read locked files for context
# but cannot modify them accidentally

# 3. When you need to edit protected files
ailock unlock .env            # Unlock specific file
echo "NEW_VAR=value" >> .env  # Make changes
ailock lock .env              # Lock again

# 4. Or unlock all, edit, then lock all
ailock unlock
# ... make changes ...
ailock lock
```

### Safety Features

- **Graceful degradation**: If advanced locking fails, falls back to basic read-only
- **Clear error messages**: Helpful suggestions when operations fail
- **Permission validation**: Warns about insufficient permissions
- **Idempotent operations**: Safe to run lock/unlock multiple times

## 🤖 Claude Code Integration

AILock now includes **automatic Claude Code integration** that prevents accidental AI modifications of protected files.

### Quick Setup

```bash
# Claude Code hooks are automatically installed during init!
ailock init

# That's it! Claude Code protection is now active
```

**Manual installation** (if needed):

```bash
# Install the project-scoped Claude Code hook
ailock hooks install claude
```

### How It Works

The integration uses Claude Code's PreToolUse hooks to:

- **Intercept** file modification attempts (Write, Edit, MultiEdit)
- **Check** protection status via the local `ailock list --json` report
- **Block** modifications to locked files with clear feedback
- **Allow** read operations for AI context understanding

When Claude Code tries to modify a protected file, you'll see:

```
🔒 File is protected by ailock. Run 'ailock unlock config.json' to allow modifications.
```

### Benefits

- ✅ **Zero-effort protection**: Works automatically once installed
- ✅ **Clear feedback**: Know exactly why operations are blocked
- ✅ **Maintains context**: AI can still read files for understanding
- ✅ **Fail-closed protection**: Malformed hook input or an unavailable protection check blocks the write and surfaces the error

## 🧪 Development

### Prerequisites

- A Node.js version supported by the `engines` contract in `package.json`
- npm

### Setup

```bash
# Clone and install
git clone https://github.com/daymade/ailock.git
cd ailock
npm ci

# Build
npm run build

# Run the maintained merge gate
npm run test:ci

# Run locally
npm run dev -- lock --help
```

### Testing

```bash
# Run the maintained cross-platform merge gate
npm run test:ci

# Run the full test inventory in watch mode
npm test

# Run the full test inventory once for legacy-debt triage
npm run test:run

# Run specific test file
npx vitest tests/unit/config.test.ts
```

### Project Structure

```
ailock/
├── src/
│   ├── commands/         # CLI command implementations
│   ├── core/            # Core functionality
│   │   ├── config.ts    # Configuration loading
│   │   └── platform.ts  # Cross-platform file operations
│   ├── utils/           # Utility functions
│   └── index.ts         # CLI entry point
├── tests/
│   ├── unit/           # Unit tests
│   └── integration/    # Integration tests
├── .ailock             # Example configuration
└── README.md
```

## ✨ Key Features

### 🛡️ Multi-Layer Protection

- **OS-Level Security**: File system permissions prevent any write access
- **Git Integration**: Pre-commit hooks block commits of protected files
- **IDE Support**: Works seamlessly with VS Code, Cursor, and other editors
- **CI/CD Integration**: Automated validation in your deployment pipeline

### 🎨 Developer Experience

- **Interactive Setup**: Guided wizard for project initialization
- **Real-time Dashboard**: Live status monitoring with auto-refresh
- **Smart Defaults**: Pre-configured protection for common sensitive files
- **Cross-Platform**: Consistent behavior on Linux, macOS, Windows, and WSL

### 🏢 Enterprise Ready

- **Template Generation**: Pre-built integrations for popular CI/CD platforms
- **Container Support**: Docker and dev-container configurations included
- **Team Workflows**: Shareable configuration and standardized protection
- **Audit Trails**: Comprehensive logging and status reporting

### 🔄 Workflow Integration

- **GitHub Actions**: Automated protection validation workflows
- **GitLab CI/CD**: Pipeline integration with detailed reporting
- **Docker**: Production-ready containerization with file protection
- **Dev Containers**: Isolated development environments with security

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

### Development Principles

- **Security first**: Never compromise on protection mechanisms
- **Cross-platform**: Ensure consistent behavior across OS
- **Developer experience**: Intuitive CLI with helpful error messages
- **Battle-tested**: Comprehensive tests for all scenarios

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🆘 Support

- 🐛 **Bug reports**: [GitHub Issues](https://github.com/daymade/ailock/issues)
- 💡 **Feature requests**: [GitHub Discussions](https://github.com/daymade/ailock/discussions)

---

**Made with ❤️ for developers who want to safely use AI coding assistants**
