import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { authCommand } from '../../../src/commands/auth.js';

// Mock dependencies
vi.mock('../../../src/services/CliApiService.js', () => ({
  getApiService: vi.fn().mockReturnValue({
    redeemAuthCode: vi.fn()
  })
}));

vi.mock('../../../src/core/directory-tracker.js', () => ({
  initializeUserConfig: vi.fn().mockResolvedValue(undefined),
  getQuotaStatusSummary: vi.fn().mockResolvedValue('5/10 directories locked (5 remaining)')
}));

vi.mock('../../../src/utils/output.js', () => ({
  info: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  warn: vi.fn()
}));

// Mock chalk to avoid color codes in tests
vi.mock('chalk', () => ({
  default: {
    green: vi.fn().mockImplementation((text) => text),
    cyan: vi.fn().mockImplementation((text) => text),
    gray: vi.fn().mockImplementation((text) => text),
    blue: vi.fn().mockImplementation((text) => text)
  }
}));

describe('auth command', () => {
  let mockApiService: any;
  let mockOutputFunctions: any;
  let program: Command;

  beforeEach(() => {
    // Reset mocks
    const { getApiService } = require('../../../src/services/CliApiService.js');
    mockApiService = {
      redeemAuthCode: vi.fn()
    };
    getApiService.mockReturnValue(mockApiService);

    mockOutputFunctions = {
      info: vi.fn(),
      success: vi.fn(),
      error: vi.fn(),
      warn: vi.fn()
    };
    
    const outputModule = require('../../../src/utils/output.js');
    Object.assign(outputModule, mockOutputFunctions);

    // Create a new program instance for testing
    program = new Command();
    program.exitOverride(); // Prevent process.exit during tests
    
    // Clear environment variables
    delete process.env.AILOCK_DEBUG;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('command configuration', () => {
    it('should have correct command name and description', () => {
      expect(authCommand.name()).toBe('auth');
      expect(authCommand.description()).toBe('Redeem auth code to increase directory quota');
    });

    it('should require auth code argument', () => {
      const args = authCommand.args;
      expect(args).toHaveLength(1);
      expect(args[0].description).toContain('Auth code to redeem');
    });

    it('should have verbose and dry-run options', () => {
      const options = authCommand.options;
      const optionFlags = options.map(opt => opt.flags);
      
      expect(optionFlags).toContain('-v, --verbose');
      expect(optionFlags).toContain('--dry-run');
    });
  });

  describe('auth code validation', () => {
    it('should accept valid auth code format', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      mockApiService.redeemAuthCode.mockResolvedValue({
        success: true,
        directory_quota: 25,
        is_first_activation: true
      });

      await authCommand.parseAsync([validCode], { from: 'user' });

      expect(mockApiService.redeemAuthCode).toHaveBeenCalledWith(validCode);
      expect(mockOutputFunctions.success).toHaveBeenCalledWith('🎉 Auth code redeemed successfully!');
    });

    it('should reject invalid auth code format', async () => {
      const invalidCode = 'invalid_code';

      await expect(authCommand.parseAsync([invalidCode], { from: 'user' }))
        .rejects.toThrow('Invalid auth code format');

      expect(mockOutputFunctions.error).toHaveBeenCalledWith('❌ Invalid auth code format');
      expect(mockApiService.redeemAuthCode).not.toHaveBeenCalled();
    });

    it('should reject auth code with incorrect length', async () => {
      const shortCode = 'auth_abc123';

      await expect(authCommand.parseAsync([shortCode], { from: 'user' }))
        .rejects.toThrow('Invalid auth code format');

      expect(mockOutputFunctions.error).toHaveBeenCalledWith('❌ Invalid auth code format');
    });

    it('should reject auth code with non-hex characters', async () => {
      const nonHexCode = 'auth_' + 'g'.repeat(32);

      await expect(authCommand.parseAsync([nonHexCode], { from: 'user' }))
        .rejects.toThrow('Invalid auth code format');

      expect(mockOutputFunctions.error).toHaveBeenCalledWith('❌ Invalid auth code format');
    });

    it('should trim whitespace from auth code', async () => {
      const codeWithSpaces = '  auth_' + 'a'.repeat(32) + '  ';
      const trimmedCode = 'auth_' + 'a'.repeat(32);
      
      mockApiService.redeemAuthCode.mockResolvedValue({ success: true });

      await authCommand.parseAsync([codeWithSpaces], { from: 'user' });

      expect(mockApiService.redeemAuthCode).toHaveBeenCalledWith(trimmedCode);
    });
  });

  describe('dry-run mode', () => {
    it('should validate without redeeming in dry-run mode', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);

      await authCommand.parseAsync([validCode, '--dry-run'], { from: 'user' });

      expect(mockOutputFunctions.success).toHaveBeenCalledWith('✅ Auth code format is valid');
      expect(mockApiService.redeemAuthCode).not.toHaveBeenCalled();
    });

    it('should show validation error in dry-run mode', async () => {
      const invalidCode = 'invalid_code';

      await expect(authCommand.parseAsync([invalidCode, '--dry-run'], { from: 'user' }))
        .rejects.toThrow('Invalid auth code format');

      expect(mockOutputFunctions.error).toHaveBeenCalledWith('❌ Invalid auth code format');
    });
  });

  describe('successful redemption', () => {
    it('should handle first activation response', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      mockApiService.redeemAuthCode.mockResolvedValue({
        success: true,
        directory_quota: 25,
        is_first_activation: true,
        message: 'Welcome to ailock!'
      });

      await authCommand.parseAsync([validCode], { from: 'user' });

      expect(mockOutputFunctions.success).toHaveBeenCalledWith('🎉 Auth code redeemed successfully!');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('📈 Your directory quota is now: 25');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('✨ Welcome to ailock! Your account is now activated.');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('💬 Welcome to ailock!');
    });

    it('should handle quota increase response', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      mockApiService.redeemAuthCode.mockResolvedValue({
        success: true,
        directory_quota: 35,
        is_first_activation: false
      });

      await authCommand.parseAsync([validCode], { from: 'user' });

      expect(mockOutputFunctions.success).toHaveBeenCalledWith('🎉 Auth code redeemed successfully!');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('📈 Your directory quota is now: 35');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('🚀 Your quota has been increased!');
    });

    it('should display current and updated status in verbose mode', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      mockApiService.redeemAuthCode.mockResolvedValue({
        success: true,
        directory_quota: 25
      });

      const { getQuotaStatusSummary } = require('../../../src/core/directory-tracker.js');
      getQuotaStatusSummary
        .mockResolvedValueOnce('3/10 directories locked (7 remaining)')
        .mockResolvedValueOnce('3/25 directories locked (22 remaining)');

      await authCommand.parseAsync([validCode, '--verbose'], { from: 'user' });

      expect(mockOutputFunctions.info).toHaveBeenCalledWith('📊 Current Status:');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('   3/10 directories locked (7 remaining)');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('📊 Updated Status:');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('   3/25 directories locked (22 remaining)');
    });
  });

  describe('error handling', () => {
    it('should handle API failure response', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      mockApiService.redeemAuthCode.mockResolvedValue({
        success: false,
        error: 'Auth code already used'
      });

      await expect(authCommand.parseAsync([validCode], { from: 'user' }))
        .rejects.toThrow('Auth code already used');

      expect(mockOutputFunctions.error).toHaveBeenCalledWith('❌ Failed to redeem auth code');
      expect(mockOutputFunctions.warn).toHaveBeenCalledWith('   The auth code is invalid or has already been used.');
    });

    it('should handle offline mode error', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      mockApiService.redeemAuthCode.mockResolvedValue({
        success: false,
        error: 'Cannot redeem auth codes in offline mode'
      });

      await expect(authCommand.parseAsync([validCode], { from: 'user' }))
        .rejects.toThrow('Cannot redeem auth codes in offline mode');

      expect(mockOutputFunctions.warn).toHaveBeenCalledWith('   Cannot redeem auth codes in offline mode.');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('   • Run: ailock config set offline false');
    });

    it('should handle network error', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      mockApiService.redeemAuthCode.mockResolvedValue({
        success: false,
        error: 'Network timeout occurred'
      });

      await expect(authCommand.parseAsync([validCode], { from: 'user' }))
        .rejects.toThrow('Network timeout occurred');

      expect(mockOutputFunctions.warn).toHaveBeenCalledWith('   Network error occurred.');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('   • Check your internet connection');
    });

    it('should handle unknown error', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      mockApiService.redeemAuthCode.mockResolvedValue({
        success: false,
        error: 'Something went wrong'
      });

      await expect(authCommand.parseAsync([validCode], { from: 'user' }))
        .rejects.toThrow('Something went wrong');

      expect(mockOutputFunctions.warn).toHaveBeenCalledWith('   Error: Something went wrong');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('   • Contact support if the issue persists');
    });

    it('should handle API service exceptions', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      mockApiService.redeemAuthCode.mockRejectedValue(new Error('Network connection failed'));

      await expect(authCommand.parseAsync([validCode], { from: 'user' }))
        .rejects.toThrow('Network connection failed');

      expect(mockOutputFunctions.error).toHaveBeenCalledWith('❌ Unexpected error during auth code redemption');
      expect(mockOutputFunctions.warn).toHaveBeenCalledWith('   Network connection failed');
    });

    it('should sanitize error output in debug mode', async () => {
      process.env.AILOCK_DEBUG = 'true';
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();
      const validCode = 'auth_' + 'a'.repeat(32);
      
      const error = new Error('Detailed error message');
      error.stack = 'Error: Detailed error message\n    at someFunction:123\n    at anotherFunction:456';
      mockApiService.redeemAuthCode.mockRejectedValue(error);

      await expect(authCommand.parseAsync([validCode], { from: 'user' }))
        .rejects.toThrow('Detailed error message');

      expect(consoleSpy).toHaveBeenCalledWith(
        'Debug: Error details:',
        expect.objectContaining({
          message: 'Detailed error message',
          name: 'Error',
          stack: 'Error: Detailed error message'
        })
      );

      consoleSpy.mockRestore();
    });
  });

  describe('initialization', () => {
    it('should initialize user config before processing', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      mockApiService.redeemAuthCode.mockResolvedValue({ success: true });

      const { initializeUserConfig } = require('../../../src/core/directory-tracker.js');

      await authCommand.parseAsync([validCode], { from: 'user' });

      expect(initializeUserConfig).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      
      const { initializeUserConfig } = require('../../../src/core/directory-tracker.js');
      initializeUserConfig.mockRejectedValue(new Error('Config initialization failed'));

      await expect(authCommand.parseAsync([validCode], { from: 'user' }))
        .rejects.toThrow('Config initialization failed');

      expect(mockOutputFunctions.error).toHaveBeenCalledWith('❌ Unexpected error during auth code redemption');
    });
  });

  describe('output formatting', () => {
    it('should provide helpful alternative actions on failure', async () => {
      const validCode = 'auth_' + 'a'.repeat(32);
      mockApiService.redeemAuthCode.mockResolvedValue({
        success: false,
        error: 'Some error'
      });

      await expect(authCommand.parseAsync([validCode], { from: 'user' }))
        .rejects.toThrow();

      expect(mockOutputFunctions.info).toHaveBeenCalledWith('💡 Alternative actions:');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('   • Visit the web portal to get more auth codes');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('   • Share referral codes to earn bonus quota');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('   • Check your current status with: ailock status');
    });

    it('should show example auth code format on validation error', async () => {
      const invalidCode = 'invalid';

      await expect(authCommand.parseAsync([invalidCode], { from: 'user' }))
        .rejects.toThrow();

      expect(mockOutputFunctions.info).toHaveBeenCalledWith('💡 Example:');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('   auth_a1b2c3d4e5f6789012345678901234567890');
      expect(mockOutputFunctions.info).toHaveBeenCalledWith('   Get valid codes from the ailock web portal');
    });
  });
});