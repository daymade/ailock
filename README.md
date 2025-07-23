# AI-Proof File Guard (ailock) v1.0.0

[![npm version](https://badge.fury.io/js/ailock.svg)](https://badge.fury.io/js/ailock)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI Status](https://github.com/ai-proof/ailock/workflows/CI/badge.svg)](https://github.com/ai-proof/ailock/actions)

**🔒 Enterprise-grade protection for sensitive files from accidental AI modifications**

AI-Proof File Guard (`ailock`) is a production-ready, cross-platform CLI tool that provides comprehensive "AI can read but not write" protection for sensitive files like `.env`, configuration files, secrets, and deployment scripts. With multi-layer security, interactive workflows, CI/CD integration, and enterprise features, ailock ensures your sensitive files remain safe while keeping them accessible for AI analysis and code assistance.

## 🚀 Quick Start

### Installation

```bash
# Install globally via npm
npm install -g ailock

# Or run directly with npx
npx ailock --help
```

### Basic Usage

```bash
# Lock files based on .ailock configuration
ailock lock

# Lock specific files
ailock lock .env secrets.json

# Unlock files for editing
ailock unlock

# Check what would be locked (dry run)
ailock lock --dry-run --verbose
```

## 🛡️ Why ailock?

### The Problem
AI coding assistants (GitHub Copilot, Claude Code, Cursor Agent) with "apply changes" modes can accidentally modify sensitive files during automated refactoring or code generation, potentially causing:

- 🔓 **Leaked secrets** in .env files
- 🔥 **Broken deployments** from modified config files  
- 💥 **Service outages** from altered infrastructure scripts
- 🚨 **Security vulnerabilities** from changed access controls

### The Solution
ailock provides **multi-layer protection**:

1. **OS-level locks** - Files become read-only at the filesystem level
2. **Git hooks** - Prevents accidental commits of protected files (Phase 2)
3. **IDE integration** - Visual indicators and editor-level protection (Phase 3)

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

## 🎯 Complete Command Reference

### Core Commands

#### `ailock init`
Initialize ailock configuration with interactive wizard.
```bash
ailock init                 # Interactive setup wizard
ailock init --skip-wizard   # Create basic .ailock file
ailock init --force        # Overwrite existing configuration
```

#### `ailock lock`
Lock files to prevent modifications.
```bash
ailock lock                 # Lock files from .ailock configuration
ailock lock .env secrets/*  # Lock specific files/patterns
ailock lock --verbose       # Show detailed output
ailock lock --dry-run      # Preview changes without applying
```

#### `ailock unlock`
Unlock files to allow modifications.
```bash
ailock unlock              # Unlock files from configuration
ailock unlock .env         # Unlock specific files
ailock unlock --verbose    # Show detailed output
ailock unlock --dry-run    # Preview changes without applying
```

### Status & Monitoring

#### `ailock status`
Show current protection status.
```bash
ailock status              # Basic status overview
ailock status --verbose    # Detailed information
ailock status --json       # JSON output for scripts
```

#### `ailock status-interactive` (alias: `dash`)
Launch interactive real-time status dashboard.
```bash
ailock dash                # Interactive dashboard
ailock dash --verbose      # Detailed dashboard view
```

#### `ailock list` (alias: `ls`)
List all protected files and their status.
```bash
ailock list                # Show all protected files
ailock list --long         # Detailed file information
ailock list --locked-only  # Show only locked files
ailock list --json         # JSON output
```

### Git Integration

#### `ailock install-hooks`
Install Git pre-commit hooks for protection.
```bash
ailock install-hooks       # Interactive installation
ailock install-hooks --yes # Skip prompts
ailock install-hooks --force # Overwrite existing hooks
```

### Enterprise Features

#### `ailock generate` (alias: `gen`)
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

## 🔧 Cross-Platform Support

ailock works consistently across all major platforms:

| Platform | Lock Method | Immutable Support |
|----------|-------------|-------------------|
| **Linux** | `chmod + chattr +i` | ✅ Full support |
| **macOS** | `chmod + chflags` | ✅ Partial support |
| **Windows** | `attrib +R + icacls` | ⚠️ ACL-based |
| **WSL** | Hybrid detection | ⚠️ Filesystem-dependent |

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

## 🧪 Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Setup

```bash
# Clone and install
git clone https://github.com/your-org/ailock.git
cd ailock
npm install

# Build
npm run build

# Test
npm test

# Run locally
npm run dev lock --help
```

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

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

## 🏆 Project Status - v1.0.0 COMPLETE

All planned features have been successfully implemented and tested:

### ✅ Phase 1: Core CLI (Complete)
- Cross-platform file locking (chmod, chattr, icacls)
- .ailock configuration with gitignore syntax
- Basic lock/unlock commands with comprehensive options
- Full test coverage and CI/CD validation

### ✅ Phase 2: Git Integration (Complete)
- Pre-commit hook generation and installation
- Husky framework integration
- Commit-time protection with helpful error messages
- Git repository status monitoring

### ✅ Phase 3: Enhanced UX (Complete)
- Interactive terminal UI with Ink framework
- Workspace initialization wizard with project templates
- Real-time status dashboard with auto-refresh
- Enhanced file discovery and management

### ✅ Phase 4: Enterprise Features (Complete)
- CI/CD integration templates (GitHub Actions, GitLab CI)
- Production Docker configurations with security
- VS Code Dev Container templates and setup
- Team workflow standardization tools

## 🚀 Production Ready
ailock v1.0.0 is now production-ready with enterprise-grade features, comprehensive testing, and battle-tested security mechanisms.

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

- 📚 **Documentation**: [Full docs](https://your-docs-site.com)
- 🐛 **Bug reports**: [GitHub Issues](https://github.com/your-org/ailock/issues)
- 💡 **Feature requests**: [GitHub Discussions](https://github.com/your-org/ailock/discussions)
- 💬 **Community**: [Discord](https://discord.gg/ailock)

---

**Made with ❤️ for developers who want to safely use AI coding assistants**