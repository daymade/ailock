#!/usr/bin/env node

// Test with absolute paths to verify security mechanisms work properly
import { writeFile, unlink, chmod, access, constants } from 'fs/promises';
import { getPlatformAdapter } from './dist/core/platform.js';
import path from 'path';

async function testSecurityWithAbsolutePath() {
  console.log('🔒 Testing Robust Security Mechanisms (Absolute Paths)\n');
  
  const testFile = path.resolve('./test-absolute-security-file.txt');
  const adapter = getPlatformAdapter();
  
  try {
    // 1. Create test file
    console.log('1. Creating test file...');
    await writeFile(testFile, 'This is a test file for security verification.\n');
    await chmod(testFile, 0o644); // Make it writable initially
    console.log('✅ Test file created at:', testFile);
    
    // 2. Test locking with absolute path
    console.log('\n2. Testing secure file locking with absolute path...');
    try {
      await adapter.lockFile(testFile);
      console.log('✅ File locked successfully with security improvements');
      
      // Verify it's actually locked
      const isLocked = await adapter.isLocked(testFile);
      console.log(`   Lock status: ${isLocked ? '🔒 Locked' : '🔓 Unlocked'}`);
      
      // Test write protection
      try {
        await access(testFile, constants.W_OK);
        console.log('⚠️  File is still writable (normal on some systems without immutable support)');
      } catch {
        console.log('✅ File is properly write-protected');
      }
      
    } catch (error) {
      console.log(`❌ Locking failed: ${error.message}`);
    }
    
    // 3. Test security info
    console.log('\n3. Testing security information...');
    try {
      if (adapter.getSecurityInfo) {
        const securityInfo = await adapter.getSecurityInfo(testFile);
        console.log('✅ Security info retrieved:');
        console.log(`   - Read-only: ${securityInfo.isReadOnly}`);
        console.log(`   - Immutable: ${securityInfo.isImmutable}`);
        console.log(`   - Permissions: ${securityInfo.permissions}`);
        console.log(`   - Platform: ${securityInfo.platform}`);
        console.log(`   - Last Modified: ${securityInfo.lastModified}`);
      }
    } catch (error) {
      console.log(`   Security info failed: ${error.message}`);
    }
    
    // 4. Test unlocking
    console.log('\n4. Testing secure file unlocking...');
    try {
      await adapter.unlockFile(testFile);
      console.log('✅ File unlocked successfully');
      
      const isUnlocked = await adapter.isLocked(testFile);
      console.log(`   Lock status after unlock: ${isUnlocked ? '🔒 Still Locked' : '🔓 Unlocked'}`);
      
    } catch (error) {
      console.log(`❌ Unlocking failed: ${error.message}`);
    }
    
    console.log('\n🎉 Security testing with absolute paths completed!');
    
  } catch (error) {
    console.error('❌ Security test failed:', error.message);
  } finally {
    // Cleanup
    try {
      await adapter.unlockFile(testFile).catch(() => {});
      await unlink(testFile).catch(() => {});
      console.log('\n🧹 Cleanup completed');
    } catch {
      // Ignore cleanup errors
    }
  }
}

testSecurityWithAbsolutePath().catch(console.error);