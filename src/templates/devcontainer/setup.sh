#!/bin/bash
# Dev-container setup script with ailock integration

set -e

echo "🚀 Setting up development environment with ailock protection..."

# Install project dependencies
if [ -f package.json ]; then
    echo "📦 Installing Node.js dependencies..."
    if [ -f package-lock.json ]; then
        npm ci
    else
        npm install
    fi
fi

# Initialize ailock if not already configured
if [ ! -f .ailock ]; then
    echo "⚙️  No ailock configuration found. Creating basic setup..."
    cat > .ailock << 'EOF'
# AI-Proof File Guard Configuration (Dev Container)
# Protect sensitive files from accidental AI modifications

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

# Container-specific patterns
.devcontainer/secrets/**
docker-compose.override.yml
kubernetes/secrets/**
EOF
    echo "✅ Created basic .ailock configuration"
else
    echo "✅ Found existing .ailock configuration"
fi

# Validate ailock installation
if command -v ailock &> /dev/null; then
    echo "✅ ailock is installed"
    
    # Show current status
    echo "📊 Current ailock status:"
    ailock list --json > /dev/null
    
    # Install git hooks if in a git repository
    if [ -d .git ]; then
        echo "🪝 Installing Git hooks for additional protection..."
        ailock hooks git
    fi
    
    # Lock only configured files that are currently writable.
    echo "🔒 Locking writable sensitive files..."
    TINKLE_AILOCK_LIST="$(mktemp /tmp/tinkle_ailock-list.XXXXXX.json)"
    TINKLE_AILOCK_PATHS="$(mktemp /tmp/tinkle_ailock-paths.XXXXXX.bin)"
    cleanup_ailock_reports() {
        rm -f -- "$TINKLE_AILOCK_LIST" "$TINKLE_AILOCK_PATHS"
    }
    trap cleanup_ailock_reports EXIT
    ailock list --json > "$TINKLE_AILOCK_LIST"
    node -e '
        const fs = require("node:fs");
        const report = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        for (const file of report.files) {
            const filePath = file.absolutePath || file.path;
            if (!filePath) throw new Error("ailock list entry has no path");
            process.stdout.write(filePath + "\0");
        }
    ' "$TINKLE_AILOCK_LIST" > "$TINKLE_AILOCK_PATHS"

    TINKLE_WRITABLE_FILES=()
    while IFS= read -r -d '' TINKLE_PROTECTED_FILE; do
        if [ -w "$TINKLE_PROTECTED_FILE" ]; then
            TINKLE_WRITABLE_FILES+=("$TINKLE_PROTECTED_FILE")
        fi
    done < "$TINKLE_AILOCK_PATHS"
    cleanup_ailock_reports
    trap - EXIT

    if [ "${#TINKLE_WRITABLE_FILES[@]}" -gt 0 ]; then
        ailock lock --no-hooks --verbose "${TINKLE_WRITABLE_FILES[@]}"
    else
        echo "✅ No writable configured files need locking"
    fi
    
else
    echo "❌ ailock not found - installing..."
    npm install -g ailock
fi

# Set up git configuration for container
echo "🔧 Configuring Git for container environment..."
git config --global --add safe.directory "$(pwd)"
git config --global init.defaultBranch main

# Create useful aliases
echo "🔗 Setting up helpful aliases..."
cat >> ~/.bashrc << 'EOF'

# ailock aliases for easier development
alias al='ailock'
alias als='ailock status'
alias all='ailock list'
alias ali='ailock status --interactive'
alias alock='ailock lock'
alias aunlock='ailock unlock'

# Container development helpers
alias ll='ls -la'
alias ports='ss -tulpn'
alias logs='docker-compose logs -f'
alias restart='docker-compose restart'

# Show ailock status in prompt
export PS1="\[\033[01;32m\]\u@\h\[\033[00m\]:\[\033[01;34m\]\w\[\033[00m\]$(if command -v ailock &> /dev/null && [ -f .ailock ]; then echo ' 🔒'; fi)\$ "

EOF

# Create development helpers
echo "🛠️  Creating development helpers..."

# Create a simple status script
cat > check-protection.sh << 'EOF'
#!/bin/bash
echo "🔒 AI-Proof File Guard Status Check"
echo "=================================="
echo ""

if [ -f .ailock ]; then
    echo "📄 Protected files:"
    ailock list
else
    echo "❌ No ailock configuration found"
    echo "💡 Run 'ailock init' to set up protection"
fi

echo ""
echo "🪝 Git hooks status:"
if [ -f .git/hooks/pre-commit ] && grep -q "ailock" .git/hooks/pre-commit; then
    echo "✅ Git hooks installed"
else
    echo "⚠️  Git hooks not installed - run 'ailock hooks git'"
fi
EOF
chmod +x check-protection.sh

# Create a unlock-all script for development
cat > dev-unlock-all.sh << 'EOF'
#!/bin/bash
echo "🔓 Unlocking all files for development..."
echo "⚠️  Remember to lock them again before committing!"
echo ""
ailock unlock
echo ""
echo "💡 When done editing, run: ailock lock"
EOF
chmod +x dev-unlock-all.sh

# Setup completion
echo ""
echo "🎉 Dev container setup complete!"
echo ""
echo "🔒 ailock commands available:"
echo "   ailock status          - Show protection status"
echo "   ailock list            - List all protected files"
echo "   ailock lock            - Lock sensitive files"
echo "   ailock unlock          - Unlock files for editing"
echo "   ./check-protection.sh  - Full protection status check"
echo "   ./dev-unlock-all.sh    - Unlock all files for development"
echo ""
echo "🚀 Happy secure coding!"
echo ""

# Show final status
if command -v ailock &> /dev/null; then
    echo "📊 Final status:"
    ailock list --json > /dev/null
fi
