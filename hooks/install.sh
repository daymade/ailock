#!/bin/bash

# AILock Claude Code Hook Installation Script
# This script installs the ailock hook for Claude Code to prevent
# accidental modifications of protected files.

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Render the same shell-safe command shape as the canonical CLI installer.
# Keeping Node and the hook path as separately quoted arguments makes package
# installation prefixes containing spaces safe.
render_settings() {
    local hook_script="$1"

    AILOCK_HOOK_SCRIPT_PATH="$hook_script" node <<'NODE'
const hookScriptPath = process.env.AILOCK_HOOK_SCRIPT_PATH;
if (!hookScriptPath) throw new Error('AILOCK_HOOK_SCRIPT_PATH is required');

const quote = (value) => {
  if (process.platform === 'win32') return `"${value}"`;
  return `'${value.replace(/'/g, `'"'"'`)}'`;
};

const settings = {
  hooks: {
    PreToolUse: [
      {
        matcher: 'Write|Edit|MultiEdit|NotebookEdit',
        hooks: [
          {
            type: 'command',
            command: [process.execPath, hookScriptPath].map(quote).join(' '),
            timeout: 5000
          }
        ]
      }
    ]
  }
};

process.stdout.write(`${JSON.stringify(settings, null, 2)}\n`);
NODE
}

# Function to merge JSON settings
merge_settings() {
    local settings_file="$1"
    local new_settings_file="$2"
    
    if [ -f "$settings_file" ]; then
        # Backup existing settings
        cp "$settings_file" "${settings_file}.backup.$(date +%Y%m%d_%H%M%S)"
        print_info "Backed up existing settings to ${settings_file}.backup.*"
        
        # Merge settings using path arguments rather than interpolating paths or
        # JSON into executable source.
        node - "$settings_file" "$new_settings_file" <<'NODE'
const fs = require('node:fs');
const settingsFile = process.argv[2];
const newSettingsFile = process.argv[3];
const existingSettings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
const newSettings = JSON.parse(fs.readFileSync(newSettingsFile, 'utf8'));

if (!existingSettings.hooks) existingSettings.hooks = {};
if (!existingSettings.hooks.PreToolUse) existingSettings.hooks.PreToolUse = [];

const hookExists = existingSettings.hooks.PreToolUse.some(
  (hook) =>
    hook.matcher === 'Write|Edit|MultiEdit|NotebookEdit' &&
    hook.hooks?.some((candidate) =>
      candidate.command?.includes('claude-ailock-hook.js')
    )
);

if (!hookExists) {
  existingSettings.hooks.PreToolUse.push(newSettings.hooks.PreToolUse[0]);
}

fs.writeFileSync(settingsFile, `${JSON.stringify(existingSettings, null, 2)}\n`);
NODE
    else
        # Create new settings file
        cp "$new_settings_file" "$settings_file"
    fi
}

echo ""
echo "🔒 AILock Claude Code Hook Installer"
echo "===================================="
echo ""

# Step 1: Check if ailock is installed
print_info "Checking ailock installation..."
if command_exists ailock; then
    print_success "ailock is installed globally"
elif [ -f "./node_modules/.bin/ailock" ]; then
    print_success "ailock is installed locally"
else
    print_error "ailock is not installed!"
    echo ""
    echo "Please install ailock first:"
    echo "  npm install -g ailock"
    echo "or"
    echo "  npm install --save-dev ailock"
    exit 1
fi

# Step 2: Check if Node.js is available
print_info "Checking Node.js installation..."
if ! command_exists node; then
    print_error "Node.js is not installed!"
    echo "Please install Node.js to use the ailock Claude Code hook."
    exit 1
fi
print_success "Node.js is available"

# Step 3: Make hook script executable
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_SCRIPT="$SCRIPT_DIR/claude-ailock-hook.js"

if [ ! -f "$HOOK_SCRIPT" ]; then
    print_error "Hook script not found at: $HOOK_SCRIPT"
    exit 1
fi

chmod +x "$HOOK_SCRIPT"
print_success "Hook script is executable"

# Step 4: Determine Claude Code settings location
print_info "Locating Claude Code settings..."

# Check for project-specific settings first
PROJECT_SETTINGS=".claude/settings.json"
USER_SETTINGS="$HOME/.claude/settings.json"
SETTINGS_FILE=""

echo ""
echo "Where would you like to install the hook?"
echo "1) Project settings (${PROJECT_SETTINGS}) - Applies to this project only"
echo "2) User settings (${USER_SETTINGS}) - Applies to all projects"
echo "3) Manual installation (show instructions)"
echo ""
read -r -p "Enter your choice (1-3): " choice

case $choice in
    1)
        SETTINGS_FILE="$PROJECT_SETTINGS"
        mkdir -p "$(dirname "$SETTINGS_FILE")"
        ;;
    2)
        SETTINGS_FILE="$USER_SETTINGS"
        mkdir -p "$(dirname "$SETTINGS_FILE")"
        ;;
    3)
        # Show manual installation instructions
        echo ""
        print_info "Manual Installation Instructions:"
        echo ""
        echo "1. Open your Claude Code settings file:"
        echo "   - Project: .claude/settings.json"
        echo "   - User: ~/.claude/settings.json"
        echo ""
        echo "2. Add the following configuration:"
        render_settings "$HOOK_SCRIPT"
        echo ""
        echo "3. Save the settings file"
        echo ""
        print_success "Installation instructions displayed"
        exit 0
        ;;
    *)
        print_error "Invalid choice"
        exit 1
        ;;
esac

# Step 5: Install the hook configuration
print_info "Installing hook configuration to $SETTINGS_FILE..."

# Render the final settings into a private temporary file so paths and JSON are
# never reinterpreted as shell or JavaScript source.
TEMPLATE_SETTINGS_FILE="$(mktemp "${TMPDIR:-/tmp}/tinkle_ailock-claude-settings.XXXXXX")"
cleanup_template_settings() {
    rm -f -- "$TEMPLATE_SETTINGS_FILE"
}
trap cleanup_template_settings EXIT
render_settings "$HOOK_SCRIPT" > "$TEMPLATE_SETTINGS_FILE"

# Merge settings
merge_settings "$SETTINGS_FILE" "$TEMPLATE_SETTINGS_FILE"
cleanup_template_settings
trap - EXIT

print_success "Hook configuration installed!"

# Step 6: Verify installation
echo ""
print_info "Verifying installation..."

if [ -f "$SETTINGS_FILE" ] && grep -q "claude-ailock-hook.js" "$SETTINGS_FILE"; then
    print_success "Installation verified successfully!"
else
    print_error "Installation verification failed"
    exit 1
fi

# Step 7: Show summary
echo ""
echo "========================================"
echo "✅ Installation Complete!"
echo ""
echo "The AILock Claude Code hook is now active."
echo ""
echo "What it does:"
echo "  • Prevents Claude Code from modifying ailock-protected files"
echo "  • Shows clear messages when operations are blocked"
echo "  • Allows read operations for AI context"
echo ""
echo "Test it:"
echo "  1. Lock a file: ailock lock test.txt"
echo "  2. Ask Claude Code to modify test.txt"
echo "  3. See the protection in action!"
echo ""
echo "Settings location: $SETTINGS_FILE"
echo ""
print_success "Happy coding with AILock protection! 🔒"
