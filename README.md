# AI-Proof File Guard (ailock)

[![npm version](https://badge.fury.io/js/ailock.svg)](https://badge.fury.io/js/ailock)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Protect sensitive files from accidental AI modifications** while keeping them readable for AI analysis.

AI-Proof File Guard (`ailock`) is a cross-platform CLI tool that provides "AI can read but not write" protection for sensitive files like `.env`, configuration files, secrets, and deployment scripts. It uses operating system-level file permissions to prevent accidental modifications by AI tools (Copilot, Claude Code, Cursor) while maintaining their ability to read and analyze the files.

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

## 🎯 Commands

### `ailock lock`

Lock files to prevent modifications.

```bash
# Lock files from .ailock configuration
ailock lock

# Lock specific files/patterns
ailock lock .env config/*.json

# Show verbose output
ailock lock --verbose

# Dry run (show what would be locked)
ailock lock --dry-run
```

**Options:**
- `-v, --verbose` - Show detailed output
- `-d, --dry-run` - Preview changes without applying

### `ailock unlock`

Unlock files to allow modifications.

```bash
# Unlock files from .ailock configuration
ailock unlock

# Unlock specific files/patterns
ailock unlock .env config/*.json

# Show verbose output
ailock unlock --verbose

# Dry run (show what would be unlocked)
ailock unlock --dry-run
```

**Options:**
- `-v, --verbose` - Show detailed output
- `-d, --dry-run` - Preview changes without applying
- `-a, --all` - Unlock all files (future feature)

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

## 🗺️ Roadmap

### Phase 1: Core CLI ✅ **COMPLETE**
- [x] Cross-platform file locking
- [x] .ailock configuration support
- [x] Basic lock/unlock commands
- [x] Comprehensive testing

### Phase 2: Git Integration 🚧 **PLANNED**
- [ ] Pre-commit hook generation
- [ ] Husky integration
- [ ] Commit-time protection

### Phase 3: Enhanced UX 📋 **PLANNED**
- [ ] Interactive terminal UI (Ink)
- [ ] Workspace initialization wizard
- [ ] Visual status indicators

### Phase 4: Enterprise Features 🔮 **FUTURE**
- [ ] CI/CD integration templates
- [ ] Dev-container support
- [ ] Team workflow tools

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