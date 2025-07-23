import { Command } from 'commander';
import { render } from 'ink';
import React from 'react';
import { StatusDashboard } from '../ui/components/StatusDashboard.js';

export const statusInteractiveCommand = new Command('status-interactive')
  .alias('dash')
  .description('Show interactive status dashboard with real-time updates')
  .option('-v, --verbose', 'Show detailed information')
  .action(async (options) => {
    try {
      const { waitUntilExit } = render(
        React.createElement(StatusDashboard, {
          verbose: options.verbose,
          onExit: () => process.exit(0)
        })
      );
      
      await waitUntilExit();
    } catch (error) {
      console.error('Error starting interactive status:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });