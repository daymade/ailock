import React, { useState, useEffect } from 'react';
import { Box, Text, Spacer } from 'ink';
import Spinner from 'ink-spinner';
// Removed ink-table due to compatibility issues
import chalk from 'chalk';
import path from 'path';
import { getRepoStatus, RepoStatus } from '../../core/git.js';

interface StatusDashboardProps {
  verbose?: boolean;
  onExit?: () => void;
}

interface FileStatusRow {
  file: string;
  status: string;
  protected: string;
}

export const StatusDashboard: React.FC<StatusDashboardProps> = ({ verbose = false, onExit }) => {
  const [status, setStatus] = useState<RepoStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        setLoading(true);
        const repoStatus = await getRepoStatus();
        setStatus(repoStatus);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };

    loadStatus();
    
    // Auto-refresh every 2 seconds
    const interval = setInterval(loadStatus, 2000);
    
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <Box flexDirection="column">
        <Box>
          <Spinner type="dots" />
          <Text> Loading ailock status...</Text>
        </Box>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">❌ Error: {error}</Text>
        <Text color="gray">Press Ctrl+C to exit</Text>
      </Box>
    );
  }

  if (!status) {
    return (
      <Box flexDirection="column">
        <Text color="yellow">⚠️  No status available</Text>
        <Text color="gray">Press Ctrl+C to exit</Text>
      </Box>
    );
  }

  // Prepare file status data for table
  const fileRows: FileStatusRow[] = status.protectedFiles.map(file => {
    const relativePath = path.relative(process.cwd(), file);
    const isLocked = status.lockedFiles.includes(file);
    
    return {
      file: relativePath,
      status: isLocked ? chalk.green('🔒 Locked') : chalk.yellow('🔓 Unlocked'),
      protected: chalk.blue('✅ Yes')
    };
  });

  const totalProtected = status.protectedFiles.length;
  const totalLocked = status.lockedFiles.length;
  const unlockedCount = totalProtected - totalLocked;

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="blue">🔒 AI-Proof File Guard - Interactive Status</Text>
        <Spacer />
        <Text color="gray">[Auto-refresh: 2s]</Text>
      </Box>

      {/* Repository Status */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="blue">📁 Repository Status</Text>
        <Box marginLeft={2}>
          <Text>Git Repository: </Text>
          <Text color={status.isGitRepo ? 'green' : 'gray'}>
            {status.isGitRepo ? '✅ Detected' : '❌ Not detected'}
          </Text>
        </Box>
        
        {status.isGitRepo && (
          <Box marginLeft={2}>
            <Text>Pre-commit Hook: </Text>
            <Text color={status.hasAilockHook ? 'green' : 'yellow'}>
              {status.hasAilockHook ? '✅ Installed' : '⚠️  Not installed'}
            </Text>
          </Box>
        )}
      </Box>

      {/* Protection Summary */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="blue">📋 Protection Summary</Text>
        <Box marginLeft={2}>
          <Text>🔒 Locked files: </Text>
          <Text color="green" bold>{totalLocked}</Text>
        </Box>
        
        {unlockedCount > 0 && (
          <Box marginLeft={2}>
            <Text>🔓 Unlocked files: </Text>
            <Text color="yellow" bold>{unlockedCount}</Text>
          </Box>
        )}
        
        <Box marginLeft={2}>
          <Text>📄 Total protected: </Text>
          <Text color="blue" bold>{totalProtected}</Text>
        </Box>
      </Box>

      {/* File Details List */}
      {totalProtected > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="blue">📄 Protected Files</Text>
          {fileRows.map((row, index) => (
            <Box key={index} marginLeft={2}>
              <Text>{row.status} {row.file}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* No files message */}
      {totalProtected === 0 && (
        <Box marginBottom={1}>
          <Text color="gray">ℹ️  No protected files found</Text>
          <Text color="gray">💡 Create .ailock file to define protection patterns</Text>
        </Box>
      )}

      {/* Verbose details */}
      {verbose && status.hookInfo && (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color="blue">🪝 Git Hook Details</Text>
          <Box marginLeft={2}>
            <Text color="gray">Path: {status.hookInfo.hookPath}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="gray">Exists: {status.hookInfo.exists ? 'Yes' : 'No'}</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="gray">Ailock managed: {status.hookInfo.isAilockManaged ? 'Yes' : 'No'}</Text>
          </Box>
        </Box>
      )}

      {/* Recommendations */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="blue">💡 Recommendations</Text>
        
        {!status.isGitRepo && (
          <Box marginLeft={2}>
            <Text color="gray">• Initialize Git repository for enhanced protection</Text>
          </Box>
        )}
        
        {status.isGitRepo && !status.hasAilockHook && (
          <Box marginLeft={2}>
            <Text color="yellow">• Install pre-commit hook: ailock install-hooks</Text>
          </Box>
        )}
        
        {unlockedCount > 0 && (
          <Box marginLeft={2}>
            <Text color="yellow">• Lock unprotected files: ailock lock</Text>
          </Box>
        )}
        
        {totalProtected === 0 && (
          <Box marginLeft={2}>
            <Text color="gray">• Create .ailock file to define protection patterns</Text>
          </Box>
        )}
      </Box>

      {/* Overall Status */}
      <Box marginBottom={1}>
        {status.isGitRepo && status.hasAilockHook && unlockedCount === 0 ? (
          <Text bold color="green">✅ All protection mechanisms are active</Text>
        ) : (
          <Text bold color="yellow">⚠️  Some protection mechanisms are not active</Text>
        )}
      </Box>

      {/* Controls */}
      <Box>
        <Text color="gray">Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
};