# Add Shell Auto-Completion Support for Enhanced CLI Experience

## Summary

This PR implements comprehensive shell auto-completion support for ailock, enabling tab completion for commands, options, and file paths across bash, zsh, fish, and PowerShell. The implementation follows industry best practices with a hybrid approach combining static completion scripts and dynamic context-aware suggestions.

## Changes

### New Commands
- `ailock completion <shell>` - Generate shell-specific completion scripts
- `ailock setup-completion` - Interactive setup wizard for enabling completions
- `ailock completion-helper` - Hidden command providing dynamic completions

### New Files
- `src/commands/completion.ts` - Main completion command implementation
- `src/commands/completion-helper.ts` - Dynamic completion provider
- `src/completion/templates/bash.ts` - Bash completion script generator
- `src/completion/templates/zsh.ts` - Zsh completion script generator  
- `src/completion/templates/fish.ts` - Fish completion script generator
- `src/completion/templates/powershell.ts` - PowerShell completion script generator

### Features
- **Command completion**: Auto-complete all ailock commands (init, lock, unlock, etc.)
- **Option completion**: Context-aware option suggestions for each command
- **File path completion**: Smart file suggestions based on .ailock configuration
- **Dynamic completions**: 
  - `ailock lock <TAB>` suggests only unlocked files
  - `ailock unlock <TAB>` suggests only locked files
  - `ailock generate <TAB>` lists available templates
- **Cross-shell support**: Works on bash, zsh, fish, and PowerShell
- **Lazy loading support**: Optimized for fast shell startup
- **Fallback mechanisms**: Works even without bash-completion package

## Usage

### Quick Setup
```bash
# Auto-detect shell and show instructions
ailock setup-completion

# Generate completion for specific shell
ailock completion bash > ~/.ailock-completion
source ~/.ailock-completion
```

### Per-Shell Installation

**Bash:**
```bash
source <(ailock completion bash)
```

**Zsh:**
```bash
source <(ailock completion zsh)
```

**Fish:**
```bash
ailock completion fish > ~/.config/fish/completions/ailock.fish
```

**PowerShell:**
```powershell
ailock completion powershell | Out-String | Invoke-Expression
```

## Implementation Details

### Architecture
The completion system uses a two-tier approach:

1. **Static Completions**: Commands and options are embedded directly in shell scripts for fast response
2. **Dynamic Completions**: File paths and context-aware suggestions are fetched via the hidden `completion-helper` command

### Performance Considerations
- Shell scripts include fallbacks for systems without bash-completion utilities
- Completion helper limits suggestions to 50 items to prevent slow tab completion
- File system queries are optimized with fast-glob patterns
- Compatible with lazy loading patterns for faster shell startup

### Testing
The implementation has been tested on:
- ✅ Bash 4.4+ (macOS, Linux)
- ✅ Zsh 5.2+ (macOS, Linux)  
- ✅ Fish 3.0+
- ✅ PowerShell 5.1+ (Windows, macOS, Linux)

## Future Enhancements
- Add completion caching for improved performance
- Support for custom completion providers via plugins
- Integration with package managers for automatic setup

## Breaking Changes
None. This feature is purely additive and does not modify any existing functionality.

## Screenshots/Demo
```bash
$ ailock lo<TAB>
lock

$ ailock lock --<TAB>
--dry-run    --no-gitignore    --verbose

$ ailock unlock <TAB>
.env    config/secrets.json    docker-compose.prod.yml
```