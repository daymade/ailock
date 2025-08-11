#!/usr/bin/env node

/**
 * Integration test script to verify CLI-Web API communication
 * Tests the connection between AILock CLI and the web backend
 */

import chalk from 'chalk';
import { CliApiService } from '../dist/services/CliApiService.js';

const API_URL = process.env.AILOCK_API_URL || 'https://woodccjkyacwceitkjby.supabase.co/functions/v1';

console.log(chalk.blue('🔧 AILock CLI-Web Integration Test\n'));
console.log(`API URL: ${chalk.yellow(API_URL)}\n`);

const apiService = new CliApiService({ baseUrl: API_URL });

async function testEndpoint(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    const result = await testFn();
    console.log(chalk.green('✓ PASS'));
    if (result) {
      console.log(chalk.gray(`  Response: ${JSON.stringify(result, null, 2).substring(0, 100)}...`));
    }
    return true;
  } catch (error) {
    console.log(chalk.red('✗ FAIL'));
    console.log(chalk.red(`  Error: ${error.message}`));
    return false;
  }
}

async function runTests() {
  const results = [];
  
  // Test 1: Connectivity
  results.push(await testEndpoint('API Connectivity', async () => {
    const response = await fetch(API_URL.replace('/functions/v1', ''));
    if (!response.ok && response.status !== 404) {
      throw new Error(`HTTP ${response.status}`);
    }
    return { status: response.status };
  }));
  
  // Test 2: Auth Code Status (with invalid code - should return proper error)
  results.push(await testEndpoint('Auth Code Status Check', async () => {
    try {
      const result = await apiService.checkStatus('TEST-INVALID-CODE');
      return result;
    } catch (error) {
      // Expected to fail with invalid code, but should be a proper API error
      if (error.message.includes('fetch') || error.message.includes('network')) {
        throw error; // Re-throw network errors
      }
      return { expected_error: error.message };
    }
  }));
  
  // Test 3: Usage Tracking (should accept the request even without auth)
  results.push(await testEndpoint('Usage Tracking', async () => {
    const result = await apiService.trackUsage('status_check', {
      metadata: {
        test: true,
        timestamp: new Date().toISOString()
      }
    });
    return result;
  }));
  
  // Test 4: Check Edge Functions are deployed
  results.push(await testEndpoint('Edge Function: cli-auth-redeem', async () => {
    const response = await fetch(`${API_URL}/cli-auth-redeem`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'TEST' })
    });
    // We expect 400 or 404 for invalid code, not 500 or network error
    if (response.status >= 500) {
      throw new Error(`Server error: ${response.status}`);
    }
    return { status: response.status };
  }));
  
  results.push(await testEndpoint('Edge Function: cli-usage-track', async () => {
    const response = await fetch(`${API_URL}/cli-usage-track`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'test',
        event_data: { test: true }
      })
    });
    if (response.status >= 500) {
      throw new Error(`Server error: ${response.status}`);
    }
    return { status: response.status };
  }));
  
  results.push(await testEndpoint('Edge Function: cli-status', async () => {
    const response = await fetch(`${API_URL}/cli-status?code=TEST`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    if (response.status >= 500) {
      throw new Error(`Server error: ${response.status}`);
    }
    return { status: response.status };
  }));
  
  // Summary
  console.log('\n' + chalk.blue('═'.repeat(50)));
  const passed = results.filter(r => r).length;
  const failed = results.filter(r => !r).length;
  
  if (failed === 0) {
    console.log(chalk.green(`✅ All tests passed! (${passed}/${results.length})`));
    console.log(chalk.green('CLI-Web integration is working correctly.'));
  } else {
    console.log(chalk.yellow(`⚠️  Some tests failed: ${passed} passed, ${failed} failed`));
    console.log(chalk.yellow('Please check the errors above and ensure:'));
    console.log('  1. The web backend is deployed and running');
    console.log('  2. Edge functions are properly deployed');
    console.log('  3. The API URL is correct');
  }
  
  process.exit(failed === 0 ? 0 : 1);
}

// Run tests
runTests().catch(error => {
  console.error(chalk.red('\n❌ Test suite failed:'), error);
  process.exit(1);
});