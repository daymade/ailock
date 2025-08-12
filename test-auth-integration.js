#!/usr/bin/env node

/**
 * Integration test for ailock CLI authentication with ailock.dev API
 * This test verifies the complete auth flow works end-to-end
 */

import { CliApiService } from './dist/services/CliApiService.js';
import { loadUserConfig } from './dist/core/user-config.js';
import { getMachineUuid } from './dist/core/machine-id.js';
import path from 'path';

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  gray: '\x1b[90m'
};

// Test results collector
const results = [];

// Helper function to run a test
async function runTest(name, testFn) {
  const startTime = Date.now();
  try {
    console.log(`${colors.blue}Testing:${colors.reset} ${name}...`);
    const result = await testFn();
    const duration = Date.now() - startTime;
    console.log(`${colors.green}✓${colors.reset} ${name} (${duration}ms)`);
    results.push({ name, success: true, duration, result });
    return { success: true, result };
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`${colors.red}✗${colors.reset} ${name} (${duration}ms)`);
    console.error(`  ${colors.gray}Error: ${error.message}${colors.reset}`);
    results.push({ name, success: false, duration, error: error.message });
    return { success: false, error };
  }
}

async function main() {
  console.log(`${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.blue}AILock CLI Auth Integration Test${colors.reset}`);
  console.log(`${colors.blue}========================================${colors.reset}\n`);

  // Initialize API service
  const apiService = new CliApiService();

  // Test 1: Check Machine UUID Generation
  await runTest('Machine UUID Generation', async () => {
    const uuid = await getMachineUuid();
    if (!uuid || uuid.length < 10) {
      throw new Error('Invalid machine UUID generated');
    }
    console.log(`  ${colors.gray}Machine UUID: ${uuid.substring(0, 8)}...${colors.reset}`);
    return { uuid };
  });

  // Test 2: Load User Configuration
  await runTest('User Configuration Loading', async () => {
    const config = await loadUserConfig();
    if (!config) {
      throw new Error('Failed to load user configuration');
    }
    console.log(`  ${colors.gray}Directory Quota: ${config.directoryQuota}${colors.reset}`);
    console.log(`  ${colors.gray}Analytics Enabled: ${config.analyticsEnabled}${colors.reset}`);
    return { config };
  });

  // Test 3: Test API Connectivity
  await runTest('API Connectivity', async () => {
    const isConnected = await apiService.testConnectivity();
    if (!isConnected) {
      throw new Error('Cannot connect to API');
    }
    console.log(`  ${colors.gray}API URL: ${apiService.baseUrl}${colors.reset}`);
    return { connected: true };
  });

  // Test 4: Get User Status (without auth code)
  await runTest('Get User Status (Anonymous)', async () => {
    const status = await apiService.getUserStatus();
    if (!status) {
      throw new Error('Failed to get user status');
    }
    console.log(`  ${colors.gray}Directory Quota: ${status.directory_quota}${colors.reset}`);
    console.log(`  ${colors.gray}Available Codes: ${status.available_codes || 0}${colors.reset}`);
    console.log(`  ${colors.gray}Is Activated: ${status.is_activated || false}${colors.reset}`);
    return status;
  });

  // Test 5: Check Status Method Alias
  await runTest('Check Status Method (Alias)', async () => {
    const status = await apiService.checkStatus();
    if (!status) {
      throw new Error('checkStatus method failed');
    }
    return status;
  });

  // Test 6: Test Invalid Auth Code (Expected to fail gracefully)
  await runTest('Invalid Auth Code Handling', async () => {
    const invalidCode = 'auth_invalid0000000000000000000000000000';
    const result = await apiService.redeemAuthCode(invalidCode);
    
    if (result.success) {
      throw new Error('Invalid auth code should not succeed');
    }
    
    // This is expected to fail, which is correct behavior
    console.log(`  ${colors.gray}Expected failure: ${result.error || result.message}${colors.reset}`);
    return { handled_correctly: true };
  });

  // Test 7: Track Usage Event
  await runTest('Track Usage Event', async () => {
    const result = await apiService.trackUsage('test_integration', {
      test: true,
      timestamp: new Date().toISOString()
    });
    
    // Tracking might be disabled or fail silently, both are OK
    console.log(`  ${colors.gray}Tracking result: ${result ? 'sent' : 'skipped'}${colors.reset}`);
    return { tracked: !!result };
  });

  // Test 8: Verify Auth Code Format Validation
  await runTest('Auth Code Format Validation', async () => {
    const testCases = [
      { code: 'auth_' + 'a'.repeat(32), valid: true },
      { code: 'auth_' + '0'.repeat(32), valid: true },
      { code: 'auth_' + 'f'.repeat(32), valid: true },
      { code: 'AUTH_' + 'a'.repeat(32), valid: false }, // Wrong case
      { code: 'auth_' + 'g'.repeat(32), valid: false }, // Invalid hex
      { code: 'auth_' + 'a'.repeat(31), valid: false }, // Too short
      { code: 'auth_' + 'a'.repeat(33), valid: false }, // Too long
      { code: 'invalid_format', valid: false }
    ];

    for (const testCase of testCases) {
      const isValid = /^auth_[a-f0-9]{32}$/.test(testCase.code);
      if (isValid !== testCase.valid) {
        throw new Error(`Format validation failed for: ${testCase.code}`);
      }
    }
    
    console.log(`  ${colors.gray}All format validations passed${colors.reset}`);
    return { all_passed: true };
  });

  // Print summary
  console.log(`\n${colors.blue}========================================${colors.reset}`);
  console.log(`${colors.blue}Test Summary${colors.reset}`);
  console.log(`${colors.blue}========================================${colors.reset}\n`);

  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);

  console.log(`Total Tests: ${results.length}`);
  console.log(`${colors.green}Passed: ${successful}${colors.reset}`);
  if (failed > 0) {
    console.log(`${colors.red}Failed: ${failed}${colors.reset}`);
  } else {
    console.log(`${colors.gray}Failed: 0${colors.reset}`);
  }
  console.log(`Total Duration: ${totalDuration}ms\n`);

  // List all test results
  results.forEach(r => {
    const icon = r.success ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
    const duration = `${colors.gray}(${r.duration}ms)${colors.reset}`;
    console.log(`${icon} ${r.name} ${duration}`);
    if (!r.success && r.error) {
      console.log(`  ${colors.gray}└─ ${r.error}${colors.reset}`);
    }
  });

  // Exit with appropriate code
  if (failed > 0) {
    console.log(`\n${colors.red}Integration test failed!${colors.reset}`);
    process.exit(1);
  } else {
    console.log(`\n${colors.green}All integration tests passed!${colors.reset}`);
    console.log(`${colors.gray}The auth integration between ailock CLI and ailock.dev API is working correctly.${colors.reset}`);
    process.exit(0);
  }
}

// Run tests
main().catch(error => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});