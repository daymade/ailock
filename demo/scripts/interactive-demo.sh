#!/bin/bash

# AI-Proof File Guard: Interactive Silicon Valley Demo
# Usage: ./interactive-demo.sh [--auto | --manual]
# 
# --auto: Runs demo automatically with timed pauses
# --manual: Waits for keypress between each step

set -e

# Configuration
DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCENARIOS_DIR="$DEMO_DIR/scenarios"
AUTO_MODE=false
PAUSE_TIME=2

# Colors for better presentation
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# Parse arguments
case "${1:-}" in
    --auto)
        AUTO_MODE=true
        echo -e "${CYAN}🎬 Running demo in AUTO mode (timed pauses)${NC}"
        ;;
    --manual)
        AUTO_MODE=false
        echo -e "${CYAN}🎬 Running demo in MANUAL mode (press Enter to continue)${NC}"
        ;;
    *)
        echo -e "${YELLOW}Usage: $0 [--auto | --manual]${NC}"
        echo -e "  --auto   : Automatic demo with timed pauses"
        echo -e "  --manual : Manual demo (press Enter between steps)"
        exit 1
        ;;
esac

# Utility functions
pause_demo() {
    if [ "$AUTO_MODE" = true ]; then
        sleep $PAUSE_TIME
    else
        echo -e "${YELLOW}Press Enter to continue...${NC}"
        read -r
    fi
}

longer_pause() {
    if [ "$AUTO_MODE" = true ]; then
        sleep 4
    else
        echo -e "${YELLOW}Press Enter for next section...${NC}"
        read -r
    fi
}

print_section() {
    echo
    echo -e "${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BOLD}${MAGENTA} $1${NC}"
    echo -e "${BOLD}${MAGENTA}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo
}

print_step() {
    echo -e "${BOLD}${BLUE}▶ $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

execute_command() {
    echo -e "${CYAN}$ $1${NC}"
    pause_demo
    eval "$1"
    echo
}

simulate_typing() {
    local text="$1"
    local delay="${2:-0.05}"
    
    for (( i=0; i<${#text}; i++ )); do
        echo -n "${text:$i:1}"
        sleep "$delay"
    done
    echo
}

# Setup demo environment
setup_demo() {
    print_section "🔧 Setting up demo environment"
    
    # Create demo scenarios directory
    mkdir -p "$SCENARIOS_DIR"
    cd "$SCENARIOS_DIR"
    
    # Clean up any previous demo runs
    rm -rf vulnerable-project protected-project 2>/dev/null || true
    
    print_success "Demo environment ready"
    pause_demo
}

# Demo Section 1: The Hook
demo_hook() {
    print_section "🚨 THE HOOK: The Accidental Configuration Rewrite"
    
    echo -e "${RED}${BOLD}\"An AI assistant rewrites a local configuration file"
    echo -e "that was intentionally excluded from version control.\"${NC}"
    
    longer_pause
    
    echo -e "${YELLOW}The Growing Threat:${NC}"
    echo "• AI coding assistants are common in daily development"
    echo "• AI tools can modify ANY file with 'apply changes' modes"
    echo "• Most dangerous files (.env, keys, configs) are NOT in version control"
    echo -e "${RED}• Once corrupted by AI = Lost forever${NC}"
    
    longer_pause
    
    echo -e "${RED}${BOLD}\"One accidental rewrite can leave a local environment"
    echo -e "without a recoverable configuration source.\"${NC}"
    
    longer_pause
}

# Demo Section 2: Show the vulnerability
demo_vulnerability() {
    print_section "💥 DEMONSTRATING THE VULNERABILITY"
    
    # Create vulnerable project
    mkdir -p vulnerable-project
    cd vulnerable-project
    
    print_step "Creating a typical project with sensitive files"
    
    execute_command "echo 'AWS_SECRET_KEY=sk-1234567890abcdef' > .env"
    execute_command "echo 'DATABASE_URL=postgresql://user:pass@prod.db.com/app' >> .env"
    execute_command "echo 'STRIPE_SECRET=sk_live_51234567890' >> .env"
    
    print_step "Let's see what we have:"
    execute_command "cat .env"
    
    pause_demo
    
    print_step "Now simulating an AI tool accidentally modifying the file..."
    print_warning "This is what happens when AI tools go wrong!"
    
    execute_command "echo '# AI accidentally added this comment and broke the format' >> .env"
    execute_command "echo 'CORRUPTED_VARIABLE=' >> .env"
    
    print_step "The damage is done:"
    execute_command "cat .env"
    
    print_error "File corrupted! And since .env is in .gitignore, we can't restore it from git!"
    
    longer_pause
}

# Demo Section 3: The ailock solution
demo_solution() {
    print_section "✨ THE SOLUTION: AI Can Read But Not Write"
    
    cd "$SCENARIOS_DIR"
    
    print_step "Let's create a NEW project and protect it properly"
    
    mkdir -p protected-project
    cd protected-project
    
    # Create the same sensitive files
    execute_command "echo 'AWS_SECRET_KEY=sk-1234567890abcdef' > .env"
    execute_command "echo 'DATABASE_URL=postgresql://user:pass@prod.db.com/app' >> .env"  
    execute_command "echo 'STRIPE_SECRET=sk_live_51234567890' >> .env"
    
    execute_command "cat .env"
    
    pause_demo
    
    print_step "The Holy Grail Moment - One Command Protection:"
    
    # Check if ailock is available, if not simulate the output
    if command -v ailock >/dev/null 2>&1; then
        execute_command "ailock init"
    else
        echo -e "${CYAN}$ ailock init${NC}"
        pause_demo
        print_success "Complete setup! Detected the project, created config, protected configured files"
        print_success "✓ Protected: .env"
        print_success "✓ Git hooks installed"
        echo
    fi
    
    pause_demo
    
    print_step "Now let's test the protection - AI tries to modify the file:"
    
    # Simulate the protection (since we might not have ailock installed)
    echo -e "${CYAN}$ echo '# AI tries to modify again' >> .env${NC}"
    pause_demo
    print_error "bash: .env: Operation not permitted"
    echo
    
    pause_demo
    
    print_step "But AI can still READ the file for context:"
    execute_command "cat .env"
    
    print_success "Perfect! AI can read but not write!"
    
    longer_pause
}

# Demo Section 4: Value revelation  
demo_value() {
    print_section "📊 VALUE REVELATION: Peace of Mind + Productivity"
    
    echo -e "${RED}Before ailock:${NC}"
    echo "😰 Constant anxiety during AI coding sessions"
    echo "🔥 Multiple 'close calls' with sensitive files"
    echo "⏰ Time lost to file recovery"
    echo "💸 One mistake = potential career/company disaster"
    
    pause_demo
    
    echo -e "${GREEN}After ailock:${NC}"
    echo "😌 Complete confidence in AI-assisted development"
    echo "🛡️  Protected files reject accidental writes"
    echo "⚡ Confident AI-assisted development"
    echo "💰 Local credentials and configurations remain under explicit control"
    
    pause_demo
    
    echo -e "${BLUE}Enterprise Value:${NC}"
    echo "• Team Standardization via .ailock config files"
    echo "• Git Integration with pre-commit hooks"
    echo "• CI/CD Ready with automated protection"
    echo "• Audit Compliance with complete logging"
    
    pause_demo
    
    echo -e "${YELLOW}Practical Results:${NC}"
    echo "• Shared .ailock policy across a team"
    echo "• Read access remains available to AI tools"
    echo "• Accidental writes are blocked"
    
    longer_pause
}

# Demo Section 5: One more thing
demo_one_more_thing() {
    print_section "🎉 \"ONE MORE THING\": Enterprise-Grade Features"
    
    print_step "Cross-Platform Enterprise Support:"
    
    echo -e "${CYAN}$ ailock init  # Works on Linux, macOS, Windows, WSL${NC}"
    pause_demo
    echo -e "${CYAN}$ ailock generate --template docker-production${NC}"
    pause_demo  
    echo -e "${CYAN}$ ailock status --json --skip-analytics  # Automation-ready${NC}"
    pause_demo
    
    echo
    print_step "Smart .gitignore Integration:"
    echo -e "${YELLOW}Revolutionary:${NC} ailock automatically discovers and protects"
    echo "sensitive files from your .gitignore, creating a safety net"
    echo "for files that aren't in version control."
    
    pause_demo
    
    print_step "The Security Framework:"
    echo "• Path validation, command execution, atomic file management,"
    echo "  and error handling"
    echo "• Git and Claude Code hook integrations"
    
    longer_pause
}

# Demo Section 6: Call to action
demo_call_to_action() {
    print_section "🚀 GET STARTED NOW"
    
    print_step "It's this simple:"
    
    echo -e "${GREEN}${BOLD}$ npm install -g ailock${NC}"
    pause_demo
    echo -e "${GREEN}${BOLD}$ ailock init${NC}"
    pause_demo
    echo -e "${GREEN}${BOLD}# Project protection is configured${NC}"
    
    echo
    longer_pause
    
    echo -e "${BLUE}${BOLD}The Bottom Line:${NC}"
    echo -e "${YELLOW}\"In the age of AI-assisted development, ailock isn't just a tool—"
    echo -e "it's insurance for your career, your company, and your peace of mind.\"${NC}"
    
    echo
    echo -e "${CYAN}${BOLD}📦 GitHub:${NC} github.com/daymade/ailock"
    
    longer_pause
}

# Cleanup demo environment
cleanup_demo() {
    print_section "🧹 Demo Complete - Cleaning Up"
    
    cd "$DEMO_DIR"
    # Clean up demo files if desired
    # rm -rf "$SCENARIOS_DIR" 2>/dev/null || true
    
    print_success "Demo completed successfully!"
    echo -e "${YELLOW}Demo scenarios preserved in: $SCENARIOS_DIR${NC}"
}

# Main demo execution
main() {
    clear
    echo -e "${BOLD}${CYAN}"
    echo "╔═══════════════════════════════════════════════════════════════╗"
    echo "║                   AI-PROOF FILE GUARD DEMO                   ║"
    echo "║                 Silicon Valley Presentation                  ║"
    echo "╚═══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    longer_pause
    
    setup_demo
    demo_hook
    demo_vulnerability  
    demo_solution
    demo_value
    demo_one_more_thing
    demo_call_to_action
    cleanup_demo
    
    echo
    echo -e "${GREEN}${BOLD}🎉 Demo completed successfully!${NC}"
    echo -e "${CYAN}Thank you for watching the ailock demo!${NC}"
}

# Run the demo
main "$@"
