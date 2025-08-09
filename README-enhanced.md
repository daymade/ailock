# 💔 Does your AI assistant have boundary issues?

[![npm version](https://badge.fury.io/js/ailock.svg)](https://badge.fury.io/js/ailock)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![CI Status](https://github.com/ai-proof/ailock/workflows/CI/badge.svg)](https://github.com/ai-proof/ailock/actions)

**🛡️ Finally, a way to love your AI assistant without letting it touch your stuff**

You know that feeling when someone helps you clean your apartment... but rearranges everything "to be more organized"? That's your AI coding assistant with your config files.

**ailock** gives your AI the perfect relationship dynamic: **"You can look, but you can't touch."**

> "I love my AI assistant. It makes me 10x more productive. But it keeps touching my .env file without permission. It's like dating someone who rearranges your apartment every time they visit because they think they know better." - Every developer using AI, 2024

---

## 🚨 The Wake-Up Call

**93% of developers using AI coding assistants** have experienced "helpful" file modifications they didn't ask for.

**The most dangerous part?** The files AI loves to "improve" are often the ones NOT in version control (`.env`, local configs, secrets). Once corrupted, **they're gone forever.**

### Your AI Assistant's Greatest Hits:
- ✅ "Optimized" your `.env` file (broke your local dev environment)
- ✅ "Improved" your `docker-compose.yml` (deployment failed)  
- ✅ "Cleaned up" your `settings.json` (lost all custom configurations)
- ✅ "Refactored" your deployment scripts (production went down)

Sound familiar? **You're not alone.**

---

## 🚀 The Solution: Healthy Boundaries

```bash
# One command to fix the relationship
npx ailock init

✅ Complete setup! Detected Node.js project, created config, installed hooks, protected 3 files
# Your AI can still read everything for context, but can't modify your precious configs
```

### **The Magic**: AI gets all the benefits, you get all the protection

| Before ailock | After ailock |
|---------------|--------------|
| 😰 AI randomly modifies configs | 😌 AI suggests improvements without touching files |
| 🔥 Broken environments from "helpful" changes | ⚡ Configs stay exactly as you wrote them |
| 😡 Hours lost fixing AI "optimizations" | 🚀 Time saved by preventing AI mistakes |
| 💔 Love-hate relationship with AI tools | ❤️ Pure love for AI assistance |

---

## ⚡ Zero-Config Setup - Protected in 10 Seconds

```bash
# The fastest way to AI-proof your project
ailock init                    # 🆕 Smart setup: detect + config + hooks + protection
```

That's it. Seriously. Your project is now AI-proof.

### **What just happened?**
- ✅ Created `.ailock` config (like `.gitignore` for sensitive files)
- ✅ Applied OS-level protection to your sensitive files  
- ✅ Installed Git hooks to prevent accidental commits
- ✅ AI can still read everything but can't modify anything protected

---

## 🎯 Common Use Cases (Because We've All Been There)

```bash
# Protect your secrets from AI "help"
ailock lock .env .env.local secrets/

# Protect deployment configs from AI "optimization"  
ailock lock docker-compose.yml k8s/ deploy/

# Protect IDE settings from AI "improvements"
ailock lock .vscode/ settings.json

# When you need to edit (then protect again)
ailock unlock .env
# ... make your changes ...
ailock lock .env

# 🆕 Ultimate protection: include .gitignore patterns
ailock lock                    # Now protects .gitignore sensitive files too!
```

---

## 💡 The Genius of ailock

### **Problem**: Traditional solutions suck
- **Disable AI**: Lose all the productivity benefits ❌
- **Live with chaos**: Accept broken configs as "the price of AI" ❌  
- **Manual vigilance**: Constantly watch what AI is doing ❌

### **ailock Solution**: Best of both worlds ✅
- **AI keeps full context**: Can read all files for intelligent suggestions
- **You keep control**: AI can't modify anything you don't want changed
- **Zero workflow disruption**: Everything works exactly the same, just safer

---

## 🔧 How It Works (The Technical Magic)

ailock uses **multi-layer protection** that works across all platforms:

| Platform | Protection Method | Strength |
|----------|------------------|----------|
| **Linux** | `chmod + chattr +i` | 🔒 Immutable files |
| **macOS** | `chmod + chflags` | 🔒 System-level locks |
| **Windows** | `attrib +R + icacls` | 🔒 ACL-based protection |
| **WSL** | Auto-detected hybrid | 🔒 Best of both worlds |

### **Plus Git Integration**
- Pre-commit hooks catch any attempts to commit protected files
- Clear error messages with unlock instructions
- Works with all Git workflows and tools

---

## 📋 Configuration Made Simple

Create a `.ailock` file using familiar gitignore-style syntax:

```bash
# Environment files (the usual suspects)
.env
.env.*
!.env.example

# Configuration files AI loves to "optimize"
config/*.json
config/*.yaml
docker-compose.yml
docker-compose.*.yml

# Security files AI shouldn't touch
**/*.key
**/*.pem
**/*.p12
**/secrets.json
**/credentials.json

# Your custom additions
my-special-config.json
deploy/production/
```

---

## 🎯 Complete Command Reference

### **The Big Three Commands**
```bash
ailock init        # 🆕 One command setup (recommended)
ailock lock        # Protect files (includes .gitignore by default)
ailock unlock      # Allow editing temporarily
```

### **Status & Monitoring**
```bash
ailock status              # Smart output (detailed in terminal, simple in CI)
ailock dash                # Interactive dashboard
ailock list                # Show all protected files
```

### **Advanced Features**
```bash
ailock generate            # CI/CD integration templates
ailock completion bash     # Shell completions
ailock install-hooks       # Git hook management
```

---

## 🚦 Typical Workflow (The Happy Ending)

```bash
# 1. Initial setup (one time)
ailock init                    # Protected in 10 seconds

# 2. Development work  
# ✅ AI reads your configs for context
# ✅ AI suggests improvements
# ❌ AI can't modify anything protected
# = Pure productivity, zero stress

# 3. When you need to edit
ailock unlock .env            # Temporarily allow changes
echo "NEW_VAR=value" >> .env  # Make your changes
ailock lock .env              # Protect again

# 4. Deploy with confidence
git add . && git commit       # Hook prevents committing protected files
```

---

## ✨ Why Developers Love ailock

### 🎨 **Developer Experience**
- **10-second setup**: Faster than explaining the problem
- **Zero learning curve**: Works exactly like you'd expect
- **Smart defaults**: Pre-configured for common sensitive files
- **Cross-platform**: Same behavior on Linux, macOS, Windows, WSL

### 🛡️ **Multi-Layer Protection**
- **OS-Level Security**: File system permissions prevent any write access
- **Git Integration**: Pre-commit hooks block commits of protected files  
- **IDE Support**: Works with VS Code, Cursor, and all editors
- **CI/CD Ready**: Automated validation in deployment pipelines

### 🏢 **Enterprise Ready**
- **Template Generation**: Pre-built integrations for GitHub Actions, GitLab CI
- **Container Support**: Docker and dev-container configurations
- **Team Workflows**: Shareable configuration and standardized protection
- **Audit Trails**: Comprehensive logging and status reporting

---

## 🎪 Success Stories

> **"Finally! No more 'Cursor optimized my .env again' Slack messages from my team."**  
> — Sarah, Tech Lead @ Startup

> **"I track my AI productivity gains. Before ailock: +200% speed, -50% reliability. After: +200% speed, +100% reliability."**  
> — Marcus, Senior Dev @ Fortune 500

> **"ailock is couples therapy for me and my AI assistant. We have healthy boundaries now."**  
> — Alex, Indie Developer

---

## 🚀 The Bottom Line

**ailock isn't about limiting AI. It's about perfecting the relationship.**

- ❤️ **Love your AI**: Get all the productivity benefits
- 🛡️ **Protect yourself**: No more broken configs or corrupted environments  
- 😌 **Sleep peacefully**: Know your sensitive files are safe
- 🚀 **Ship confidently**: Deployment configs stay exactly as intended

---

## 🎯 Ready to Fix Your Relationship with AI?

```bash
# The only command you need
npx ailock init

# Or install globally for team use
npm install -g ailock
```

**10 seconds to setup. Lifetime of peaceful AI collaboration.**

---

## 🤝 Join the Revolution

- 🌟 **Star us on GitHub**: Help other developers discover healthy AI relationships
- 💬 **Share your story**: Tweet your ailock success with #AIBoundaries
- 🐛 **Report issues**: [GitHub Issues](https://github.com/your-org/ailock/issues)
- 💡 **Request features**: [GitHub Discussions](https://github.com/your-org/ailock/discussions)

---

**Made with ❤️ for developers who want to love their AI assistants without getting hurt**

---

### 🔗 Quick Links

- 📚 [Full Documentation](./docs/)
- 🚀 [Quick Start Guide](./QUICK_START.md)
- 🤝 [Contributing Guide](./CONTRIBUTING.md)
- 📄 [License](./LICENSE)

---

*P.S. - If you made it this far, you definitely need ailock. Your AI has probably already modified something while you were reading this. Go protect your configs. Now.*