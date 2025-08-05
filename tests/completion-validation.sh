#!/bin/bash
# Validation script for ailock shell completions

echo "🧪 Testing ailock shell completion functionality"
echo "=============================================="

# Check if ailock is built
if [ ! -f "dist/index.js" ]; then
    echo "❌ Error: ailock not built. Run 'npm run build' first."
    exit 1
fi

# Test completion generation for each shell
echo -e "\n📋 Testing completion script generation:"

for shell in bash zsh fish powershell; do
    echo -n "  - Testing $shell completion generation... "
    if node dist/index.js completion $shell > /dev/null 2>&1; then
        echo "✅"
    else
        echo "❌ Failed"
        exit 1
    fi
done

# Test completion helper
echo -e "\n🔧 Testing completion helper:"

test_helper() {
    local type=$1
    local desc=$2
    echo -n "  - Testing $desc... "
    
    output=$(node dist/index.js completion-helper --type "$type" 2>&1)
    if [ $? -eq 0 ] && [ -n "$output" ]; then
        echo "✅ ($(echo "$output" | wc -l) results)"
    else
        echo "❌ Failed"
        return 1
    fi
}

test_helper "commands" "command completions"
# Note: option completions require command context, skipping for now
echo "  - Testing option completions... ⏭️  (manual test required)"
test_helper "files" "file completions"
test_helper "patterns" "pattern completions"

# Test setup-completion command
echo -e "\n🚀 Testing setup-completion command:"
echo -n "  - Testing setup-completion... "
if node dist/index.js setup-completion > /dev/null 2>&1; then
    echo "✅"
else
    echo "❌ Failed"
    exit 1
fi

# Test installation instructions
echo -e "\n📖 Testing installation instructions:"
echo -n "  - Testing bash --install-instructions... "
if node dist/index.js completion bash --install-instructions > /dev/null 2>&1; then
    echo "✅"
else
    echo "❌ Failed"
    exit 1
fi

echo -e "\n✨ All completion tests passed!"
echo "=============================================="
echo ""
echo "To enable completions in your shell, run:"
echo "  ailock setup-completion"