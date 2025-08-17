# Migration Guide: Directory-Based to Project-Based Quota System

## Overview

AILock has evolved from a directory-based quota system to a more intelligent project-based system. This migration brings several benefits:

- **Smarter Git Integration**: Git repositories are now treated as single projects, regardless of how many files you protect within them
- **Better Resource Management**: Projects are the unit of quota, making it easier to understand and manage your protected resources
- **Automatic Consolidation**: Files in the same Git repository are automatically grouped together
- **Performance Improvements**: Git repository detection is now cached for better performance

## What's Changed

### Before (Directory-Based System)
- Each protected file counted against your directory quota
- Files in the same Git repository were counted separately
- No intelligent grouping of related files

### After (Project-Based System)
- Files in the same Git repository count as one project
- Standalone directories are treated as individual projects
- Automatic migration preserves all your protected files
- Better organization and visibility of protected resources

## Migration Process

The migration happens automatically when you update to version 1.5.0 or later. Here's what happens:

1. **Automatic Detection**: When AILock starts, it detects if you have legacy directory configurations
2. **Smart Grouping**: Files are analyzed to determine if they belong to Git repositories
3. **Project Creation**: 
   - Files in Git repositories are grouped into Git projects
   - Standalone directories become directory projects
4. **Quota Transfer**: Your directory quota is converted to project quota
5. **Preservation**: All your protected files remain protected

## API Changes

### New Methods

```typescript
// Check project quota
const quotaInfo = userConfig.getProjectQuotaUsage();
// Returns: { used: number, total: number, remaining: number, percentage: number }

// Check if a file can be protected
const canProtect = await userConfig.canLockProject(filePath);

// Track project protection
await userConfig.trackProjectFileLocked(filePath, project);
await userConfig.trackProjectFileUnlocked(filePath);
```

### Deprecated Methods (Still Supported)

These methods continue to work but are deprecated:

```typescript
// Old directory-based methods
userConfig.canLockFile(filePath);  // Use canLockProject() instead
userConfig.trackFileLocked(filePath);  // Use trackProjectFileLocked() instead
userConfig.trackFileUnlocked(filePath);  // Use trackProjectFileUnlocked() instead
```

## Command Changes

The CLI commands work the same way, but now display project-based information:

```bash
# Status now shows projects instead of individual files
ailock status

# Output example:
📊 Quota Status
  Projects: 3/5 (60%)
  ████████████░░░░░░░░ 

🔒 Protected Projects:
  📁 my-app (Git Repository)
     Root: ~/projects/my-app
     Protected: 5 files
  
  📂 config-files (Directory)
     Root: ~/important/configs
     Protected: 3 files
```

## Troubleshooting

### Migration Issues

If you experience issues during migration:

1. **Check your config version**:
   ```bash
   cat ~/.ailock/config.json | jq .version
   ```
   Should show `"2"` after migration

2. **Manual migration trigger**:
   If automatic migration didn't occur, run any ailock command to trigger it:
   ```bash
   ailock status
   ```

3. **Reset if needed**:
   If you encounter persistent issues:
   ```bash
   # Backup your config first
   cp ~/.ailock/config.json ~/.ailock/config.backup.json
   
   # Reset and re-protect your files
   rm ~/.ailock/config.json
   ailock init
   ```

### Quota Issues

If you're seeing "quota exceeded" errors:

1. **Check your project count**:
   ```bash
   ailock status
   ```

2. **Consolidate projects**:
   Files in the same Git repository should be one project. If they're not:
   ```bash
   # Unlock and re-lock to consolidate
   ailock unlock <file>
   ailock lock <file>
   ```

3. **Increase quota**:
   Consider upgrading your plan for more project slots

## Benefits of the New System

1. **Better Organization**: Projects provide logical grouping of related files
2. **Clearer Quotas**: Understanding "5 projects" is clearer than "5 directories"
3. **Git-Aware**: Respects repository boundaries automatically
4. **Performance**: Cached Git detection reduces filesystem operations
5. **Future-Ready**: Foundation for advanced features like project templates and workspace management