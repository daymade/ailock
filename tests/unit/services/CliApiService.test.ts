import { describe, it, expect, beforeEach, afterEach, vi, MockedFunction } from 'vitest';
import { CliApiService, getApiService, createApiService } from '../../../src/services/CliApiService.js';

// Mock global fetch
const mockFetch = vi.fn();

// Mock dependencies
vi.mock('../../../src/core/user-config.js', () => ({
  loadUserConfig: vi.fn().mockResolvedValue({
    directoryQuota: 10,
    authToken: null,
    machineUuid: 'test-machine-uuid'
  }),
  saveUserConfig: vi.fn().mockResolvedValue(undefined),
  getOfflineMode: vi.fn().mockResolvedValue(false),
  shouldCollectAnalytics: vi.fn().mockResolvedValue(true)
}));

vi.mock('../../../src/core/machine-id.js', () => ({
  getMachineUuid: vi.fn().mockResolvedValue('test-machine-uuid'),
  sanitizeForLogging: vi.fn().mockImplementation((input) => input?.toString().replace(/[^a-zA-Z0-9\-_.]/g, '_') || '')
}));

describe('CliApiService', () => {
  let apiService: CliApiService;

  beforeEach(() => {
    // Reset the mock and stub global fetch
    mockFetch.mockReset();
    vi.stubGlobal('fetch', mockFetch);
    
    apiService = new CliApiService({
      baseUrl: 'https://test-api.example.com',
      timeout: 5000,
      maxRetries: 2,
      maxRequestsPerMinute: 20
    });
    
    // Reset environment variables
    delete process.env.AILOCK_DEBUG;
    delete process.env.AILOCK_API_URL;
    delete process.env.AILOCK_ANON_KEY;
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe('constructor', () => {
    it('should use default configuration when no options provided', () => {
      const service = new CliApiService();
      const config = service.getApiInfo();
      
      expect(config.baseUrl).toBe('https://woodccjkyacwceitkjby.supabase.co/functions/v1');
      expect(config.timeout).toBe(10000);
      expect(config.maxRetries).toBe(3);
    });

    it('should override default configuration with provided options', () => {
      const service = new CliApiService({
        baseUrl: 'https://custom-api.example.com',
        timeout: 15000,
        maxRetries: 5
      });
      const config = service.getApiInfo();
      
      expect(config.baseUrl).toBe('https://custom-api.example.com');
      expect(config.timeout).toBe(15000);
      expect(config.maxRetries).toBe(5);
    });

    it('should use environment variables for configuration', () => {
      process.env.AILOCK_API_URL = 'https://env-api.example.com';
      process.env.AILOCK_ANON_KEY = 'env-anon-key';
      
      const service = new CliApiService();
      const config = service.getApiInfo();
      
      expect(config.baseUrl).toBe('https://env-api.example.com');
    });
  });

  describe('rate limiting', () => {
    it('should allow requests within rate limit', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true })
      };
      mockFetch.mockResolvedValue(mockResponse);

      // Make multiple requests within limit
      for (let i = 0; i < 5; i++) {
        const result = await apiService.redeemAuthCode('auth_' + 'a'.repeat(32));
        expect(result.success).toBe(true);
      }

      expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    it('should throw error when rate limit exceeded', async () => {
      // Create service with very low rate limit for testing
      const limitedService = new CliApiService({
        maxRequestsPerMinute: 1
      });

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true })
      };
      mockFetch.mockResolvedValue(mockResponse);

      // First request should succeed
      await limitedService.redeemAuthCode('auth_' + 'a'.repeat(32));

      // Second request should be rate limited
      await expect(limitedService.redeemAuthCode('auth_' + 'b'.repeat(32)))
        .rejects.toThrow(/Rate limit exceeded/);
    });
  });

  describe('redeemAuthCode', () => {
    it('should successfully redeem valid auth code', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          user_id: 'test-user-id',
          directory_quota: 25,
          is_first_activation: true,
          message: 'Welcome to ailock!'
        })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await apiService.redeemAuthCode('auth_' + 'a'.repeat(32));

      expect(result).toEqual({
        success: true,
        user_id: 'test-user-id',
        directory_quota: 25,
        is_first_activation: true,
        message: 'Welcome to ailock!'
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-api.example.com/cli-auth-redeem',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'Authorization': expect.stringContaining('Bearer ')
          }),
          body: JSON.stringify({
            code: 'auth_' + 'a'.repeat(32),
            machine_uuid: 'test-machine-uuid'
          })
        })
      );
    });

    it('should handle API error response', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: false,
          error: 'Invalid auth code'
        })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await apiService.redeemAuthCode('auth_invalid_code');

      expect(result).toEqual({
        success: false,
        error: 'Invalid auth code'
      });
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await apiService.redeemAuthCode('auth_' + 'a'.repeat(32));

      expect(result).toEqual({
        success: false,
        error: 'Failed to redeem auth code: Network error'
      });
    });

    it('should handle HTTP errors', async () => {
      const mockResponse = {
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await apiService.redeemAuthCode('auth_' + 'a'.repeat(32));

      expect(result).toEqual({
        success: false,
        error: 'Failed to redeem auth code: HTTP 500: Internal Server Error'
      });
    });

    it('should return offline error when in offline mode', async () => {
      const { getOfflineMode } = await import('../../../src/core/user-config.js');
      vi.mocked(getOfflineMode).mockResolvedValue(true);

      const result = await apiService.redeemAuthCode('auth_' + 'a'.repeat(32));

      expect(result).toEqual({
        success: false,
        error: 'Offline mode - cannot redeem auth code'
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should retry on transient failures', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network timeout'))
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue({ success: true })
        });

      const result = await apiService.redeemAuthCode('auth_' + 'a'.repeat(32));

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('trackUsage', () => {
    it('should successfully track usage event', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await apiService.trackUsage('directory_locked', {
        directoryPath: '/test/path',
        totalLockedCount: 5,
        metadata: { version: '1.0.0' }
      });

      expect(result.success).toBe(true);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-api.example.com/cli-usage-track',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            machine_uuid: 'test-machine-uuid',
            event_type: 'directory_locked',
            directory_path: '/test/path',
            total_locked_count: 5,
            metadata: { version: '1.0.0' }
          })
        })
      );
    });

    it('should silently succeed when analytics disabled', async () => {
      const { shouldCollectAnalytics } = await import('../../../src/core/user-config.js');
      vi.mocked(shouldCollectAnalytics).mockResolvedValue(false);

      const result = await apiService.trackUsage('directory_locked');

      expect(result.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should silently succeed in offline mode', async () => {
      const { getOfflineMode } = await import('../../../src/core/user-config.js');
      vi.mocked(getOfflineMode).mockResolvedValue(true);

      const result = await apiService.trackUsage('directory_locked');

      expect(result.success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle tracking errors gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Tracking failed'));

      const result = await apiService.trackUsage('directory_locked');

      expect(result).toEqual({
        success: false,
        error: 'Analytics tracking failed'
      });
    });
  });

  describe('getUserStatus', () => {
    it('should get status with auth code', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          directory_quota: 25,
          available_codes: 3,
          is_activated: true
        })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await apiService.getUserStatus('auth_' + 'a'.repeat(32));

      expect(result).toEqual({
        success: true,
        directory_quota: 25,
        available_codes: 3,
        is_activated: true
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-api.example.com/cli-status?code=' + encodeURIComponent('auth_' + 'a'.repeat(32)),
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should get basic status without auth code', async () => {
      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({
          success: true,
          directory_quota: 10,
          is_activated: false
        })
      };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await apiService.getUserStatus();

      expect(result).toEqual({
        success: true,
        directory_quota: 10,
        is_activated: false
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-api.example.com/cli-status',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            machine_uuid: 'test-machine-uuid'
          })
        })
      );
    });

    it('should return local config in offline mode', async () => {
      const { getOfflineMode } = await import('../../../src/core/user-config.js');
      vi.mocked(getOfflineMode).mockResolvedValue(true);

      const result = await apiService.getUserStatus();

      expect(result).toEqual({
        success: true,
        directory_quota: 10,
        available_codes: 0,
        is_activated: false
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('testConnectivity', () => {
    it('should return true when API is reachable', async () => {
      const mockResponse = { ok: true };
      mockFetch.mockResolvedValue(mockResponse);

      const result = await apiService.testConnectivity();

      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-api.example.com/cli-usage-track',
        { method: 'OPTIONS' }
      );
    });

    it('should return false when API is unreachable', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await apiService.testConnectivity();

      expect(result).toBe(false);
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance from getApiService', () => {
      const service1 = getApiService();
      const service2 = getApiService();
      
      expect(service1).toBe(service2);
    });

    it('should create new instance from createApiService', () => {
      const service1 = createApiService();
      const service2 = createApiService();
      
      expect(service1).not.toBe(service2);
    });
  });

  describe('timeout and abort handling', () => {
    it('should timeout long-running requests', async () => {
      const shortTimeoutService = new CliApiService({
        timeout: 100,
        maxRetries: 1
      });

      mockFetch.mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 200))
      );

      const result = await shortTimeoutService.redeemAuthCode('auth_' + 'a'.repeat(32));

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to redeem auth code');
    });
  });

  describe('debug mode', () => {
    it('should log debug information when AILOCK_DEBUG is enabled', async () => {
      process.env.AILOCK_DEBUG = 'true';
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation();

      const mockResponse = {
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true })
      };
      mockFetch.mockResolvedValue(mockResponse);

      await apiService.redeemAuthCode('auth_' + 'a'.repeat(32));

      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });
});