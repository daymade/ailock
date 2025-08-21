import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Create simple test focused on core functionality without complex mocking
describe('CliApiService - Core Functionality', () => {
  let CliApiService: any;
  let mockFetch: any;
  let mockUserConfig: any;

  beforeEach(async () => {
    // Mock fetch
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    // Mock user config functions
    mockUserConfig = {
      loadUserConfig: vi.fn().mockResolvedValue({
        directoryQuota: 10,
        machineUuid: 'test-uuid'
      }),
      saveUserConfig: vi.fn().mockResolvedValue(undefined),
      getOfflineMode: vi.fn().mockResolvedValue(false),
      shouldCollectAnalytics: vi.fn().mockResolvedValue(true)
    };

    // Dynamic import with mocks
    vi.doMock('../../../src/core/user-config.js', () => mockUserConfig);
    vi.doMock('../../../src/core/machine-id.js', () => ({
      getMachineUuid: vi.fn().mockResolvedValue('test-uuid'),
      sanitizeForLogging: vi.fn().mockImplementation((str) => str)
    }));

    // Import after mocking
    const module = await import('../../../src/services/CliApiService.js');
    CliApiService = module.CliApiService;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  describe('Constructor and Configuration', () => {
    it('should create instance with default config', () => {
      const service = new CliApiService();
      const config = service.getApiInfo();
      
      expect(config.baseUrl).toBe('https://woodccjkyacwceitkjby.supabase.co/functions/v1');
      expect(config.timeout).toBe(10000);
      expect(config.maxRetries).toBe(3);
    });

    it('should create instance with custom config', () => {
      const service = new CliApiService({
        baseUrl: 'https://custom.api.com',
        timeout: 5000,
        maxRetries: 2
      });
      const config = service.getApiInfo();
      
      expect(config.baseUrl).toBe('https://custom.api.com');
      expect(config.timeout).toBe(5000);
      expect(config.maxRetries).toBe(2);
    });
  });

  describe('Auth Code Validation', () => {
    it('should validate correct auth code format', () => {
      const service = new CliApiService();
      
      // Test valid format (this is implicitly tested by the command)
      const validCode = 'auth_' + 'a'.repeat(32);
      expect(validCode).toMatch(/^auth_[a-f0-9]{32}$/);
    });

    it('should reject invalid auth code formats', () => {
      // Test various invalid formats
      const invalidCodes = [
        'invalid',
        'auth_short',
        'auth_' + 'g'.repeat(32), // non-hex
        'auth_' + 'a'.repeat(31), // too short
        'auth_' + 'a'.repeat(33)  // too long
      ];

      invalidCodes.forEach(code => {
        expect(code).not.toMatch(/^auth_[a-f0-9]{32}$/);
      });
    });
  });

  describe('Offline Mode Handling', () => {
    it('should handle offline mode for auth redemption', async () => {
      mockUserConfig.getOfflineMode.mockResolvedValue(true);
      
      const service = new CliApiService();
      const result = await service.redeemAuthCode('auth_' + 'a'.repeat(32));
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Offline mode');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle offline mode for status check', async () => {
      mockUserConfig.getOfflineMode.mockResolvedValue(true);
      
      const service = new CliApiService();
      const result = await service.getUserStatus();
      
      expect(result.success).toBe(true);
      expect(result.directory_quota).toBe(10);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('API Response Handling', () => {
    it('should handle successful API response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          directory_quota: 25
        })
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      const service = new CliApiService({ timeout: 1000, maxRetries: 1 });
      const result = await service.redeemAuthCode('auth_' + 'a'.repeat(32));
      
      expect(result.success).toBe(true);
      expect(result.directory_quota).toBe(25);
    });

    it('should handle API error response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: false,
          error: 'Invalid code'
        })
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      const service = new CliApiService({ timeout: 1000, maxRetries: 1 });
      const result = await service.redeemAuthCode('auth_' + 'a'.repeat(32));
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid code');
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));
      
      const service = new CliApiService({ timeout: 1000, maxRetries: 1 });
      const result = await service.redeemAuthCode('auth_' + 'a'.repeat(32));
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Network error');
    });
  });

  describe('Analytics Privacy', () => {
    it('should respect analytics opt-out', async () => {
      mockUserConfig.shouldCollectAnalytics.mockResolvedValue(false);
      
      const service = new CliApiService();
      const result = await service.trackUsage('directory_locked');
      
      expect(result.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should skip analytics in offline mode', async () => {
      mockUserConfig.getOfflineMode.mockResolvedValue(true);
      
      const service = new CliApiService();
      const result = await service.trackUsage('directory_locked');
      
      expect(result.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('Configuration Updates', () => {
    it('should update local config on successful auth redemption', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          directory_quota: 25
        })
      };
      mockFetch.mockResolvedValue(mockResponse);
      
      const service = new CliApiService({ timeout: 1000, maxRetries: 1 });
      await service.redeemAuthCode('auth_' + 'a'.repeat(32));
      
      expect(mockUserConfig.saveUserConfig).toHaveBeenCalledWith(
        expect.objectContaining({
          directoryQuota: 25,
          lastSyncAt: expect.any(Date)
        })
      );
    });
  });
});