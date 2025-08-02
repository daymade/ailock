# Changelog

All notable changes to the AI-Proof File Guard (ailock) project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2025-01-08

### 🆕 Added - Smart .gitignore Integration
- **Developer-Friendly Design**: Automatic discovery and protection of sensitive files from `.gitignore`
- **Smart Filtering**: Intelligent pattern recognition that only protects truly sensitive files (`.env`, `*.key`, `*secret*`, etc.) while ignoring development artifacts (`node_modules/`, `.vscode/`, etc.)
- **Zero Configuration**: Works immediately with `--include-gitignored` flag without requiring additional setup
- **Enhanced CLI Options**:
  - `ailock lock --include-gitignored` - Include sensitive files from .gitignore
  - `ailock unlock --include-gitignored` - Include sensitive files from .gitignore when unlocking
  - Verbose output shows both `.ailock` and `.gitignore` patterns for transparency

### 🧠 Design Philosophy
This release embodies our core principle: **Files in `.gitignore` are intentionally excluded from version control, making them unrecoverable if accidentally modified by AI tools**. The integration provides a safety net for the most vulnerable files in your project.

### 🔧 Technical Improvements
- Enhanced `AilockConfig` interface with `includeGitignored` and `gitIgnorePatterns` options
- New `parseGitignoreContent()` function with intelligent sensitivity detection
- Improved `loadConfig()` function supporting configuration merging and deduplication
- Git repository integration using existing `simple-git` dependency

## [0.1.0] - 2024-01-XX

### Added
- 🎉 Initial release of AI-Proof File Guard CLI
- ✅ **Core CLI Framework**
  - Commander.js-based CLI with TypeScript
  - Cross-platform support (Linux, macOS, Windows, WSL)
  - Global NPM package installation (`npm install -g ailock`)

- 🔒 **File Locking System**
  - `ailock lock` command to protect files from modifications
  - `ailock unlock` command to restore file write permissions
  - Cross-platform file permission management:
    - Linux: `chmod` + `chattr +i` for immutable files
    - macOS: `chmod` + `chflags` for extended attributes
    - Windows: `attrib +R` + `icacls` for ACL management
    - WSL: Hybrid filesystem detection with fallback

- ⚙️ **Configuration System**
  - `.ailock` configuration file with gitignore-style syntax
  - Hierarchical configuration discovery (project → parent directories)
  - Default protection patterns for common sensitive files
  - Support for glob patterns (`**/*.key`, `config/*.json`, etc.)
  - Comment and whitespace handling in configuration files

- 🎛️ **Command Features**
  - `--verbose` flag for detailed operation output
  - `--dry-run` flag for preview mode without applying changes
  - Command-line pattern override (bypass .ailock configuration)
  - Comprehensive error handling with helpful messages
  - File status reporting (locked/unlocked state)

- 🧪 **Testing Infrastructure**
  - Vitest-based testing framework
  - Unit tests for configuration parsing and platform adapters
  - Integration tests for full CLI workflows
  - Cross-platform test matrix
  - Mock filesystem for isolated testing

- 📚 **Documentation**
  - Comprehensive README with usage examples
  - Technical specification documents (PRD, PROPOSAL, BACKGROUND)
  - API documentation for all core modules
  - Cross-platform installation and usage guides

### Technical Details
- **Dependencies**: Commander.js 14.0, fast-glob 3.3, chalk 5.4
- **Build System**: TypeScript 5.8 with ES2022 target
- **Platform Support**: Node.js 18+ with ESM modules
- **File Operations**: Native fs.promises with platform-specific command execution
- **Pattern Matching**: fast-glob for high-performance file discovery

### Security Features
- Path traversal protection with input validation
- Symlink handling with explicit configuration options
- Permission elevation detection and user prompts
- Graceful degradation when advanced features unavailable
- Fail-secure operation mode (abort on locking failures)

### Performance
- Batch file operations for improved efficiency
- Async/await throughout for non-blocking operations
- Smart caching of file status to avoid repeated system calls
- Optimized glob patterns with built-in ignore lists

## [0.0.1] - 2024-01-XX

### Added
- Initial project setup and planning
- Technical architecture design
- Market research and competitive analysis
- Development roadmap and phase planning