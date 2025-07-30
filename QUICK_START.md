# AI-Proof File Guard - Quick Start Guide

> ⚠️ **Current Status**: The basic lock/unlock functionality described below is currently being stabilized. The core architecture and security framework are complete, but some CLI commands may not work as expected. See [Current Status Report](CURRENT_STATUS_REPORT.md) for details.

## 🚀 **Get Started in 30 Seconds** (When Fully Functional)

### **Simplest Usage - Just Lock a File**

```bash
# Lock your .env file immediately (no setup needed)
ailock lock .env
✅ Locked: .env (protected from AI modifications)

# That's it! Your file is now protected.
```

**What happens?**
- ✅ File becomes read-only (AI can read it but cannot modify it)
- ✅ Your AI coding assistant can still use it for context
- ✅ You're protected from accidental AI modifications

## 📋 **Common Entry-Level Commands**

### **Lock Single Files**
```bash
ailock lock .env                    # Lock environment file
ailock lock config/secrets.json    # Lock API secrets
ailock lock private.key            # Lock SSH/SSL keys
```

### **Lock Multiple Files**
```bash
ailock lock .env secrets.json *.key
# Locks all specified files in one command
```

### **Check Status**
```bash
ailock status
📊 Status: 3 files locked and protected
```

### **Unlock for Editing**
```bash
ailock unlock .env
⚠️  Temporarily unlocked: .env
# Edit your file...
ailock lock .env
✅ Re-locked: .env
```

## 💡 **Progressive Learning Path**

### **Level 1: Basic File Protection**
Start here if you just want to protect specific files:

```bash
# Protect your most sensitive file
ailock lock .env

# Check it worked
ailock status

# Edit when needed
ailock unlock .env
# ... make changes ...
ailock lock .env
```

### **Level 2: Automatic Pattern Protection**
When you want to protect multiple files automatically:

```bash
# Initialize with smart defaults
ailock init
# Creates .ailock file with common patterns like .env*, *.key, secrets.json

# Now protect all matching files
ailock lock
✅ Locked 8 file(s) based on patterns
```

### **Level 3: Git Integration**
Add commit-time protection:

```bash
# Install Git hooks
ailock install-hooks
✅ Git hooks installed

# Now Git blocks commits of locked files
git add .env && git commit -m "update"
🔒 Commit blocked: .env is locked and protected
```

### **Level 4: Team & Enterprise**
Full team collaboration features:

```bash
# Use project templates
ailock init --template node-js-backend
ailock generate --template github-actions
# Advanced CI/CD and team features
```

## 🎯 **Most Common Use Cases**

### **"I'm using AI to help code and want to protect my .env"**
```bash
ailock lock .env
# Done! AI can read your .env for context but cannot modify it
```

### **"I want to protect multiple secret files"**
```bash
ailock lock .env config/api-keys.json *.pem
# All your secret files are now protected
```

### **"I want automatic protection for my project"**
```bash
ailock init     # Creates configuration with smart defaults
ailock lock     # Protects all files matching patterns
```

### **"I want to prevent accidental Git commits of secrets"**
```bash
ailock lock .env            # Protect the file
ailock install-hooks        # Install Git protection
# Now Git blocks commits of protected files with helpful messages
```

## ❓ **FAQ**

### **Q: Do I need to create configuration files?**
A: No! `ailock lock .env` works immediately without any setup.

### **Q: Can AI still read my protected files?**
A: Yes! Files remain readable for AI context, they're just write-protected.

### **Q: What if I need to edit a locked file?**
A: Use `ailock unlock filename`, edit it, then `ailock lock filename` again.

### **Q: How do I see what's protected?**
A: Use `ailock status` to see all locked files and protection status.

### **Q: What happens if I try to edit a locked file?**
A: Your editor will show it as read-only. Some editors may ask for permission to override.

### **Q: Can I lock files outside my project directory?**
A: Yes! `ailock lock ~/.ssh/id_rsa` works for any file you can access.

## 🔧 **Installation**

```bash
# Install globally
npm install -g ailock

# Or use with npx (no installation needed)
npx ailock lock .env
```

## 🆘 **Need Help?**

```bash
# Get help anytime
ailock --help
ailock lock --help
ailock status --help

# Check version
ailock --version
```

## 🎉 **That's It!**

You now know everything you need to start protecting your sensitive files from AI modifications while keeping them readable for AI context.

**Remember**: Start simple with `ailock lock .env` and add more features as you need them!

---

💡 **Pro Tip**: The beauty of AI-Proof File Guard is that it grows with you. Start with a single file, then add patterns, Git integration, and team features when you're ready.