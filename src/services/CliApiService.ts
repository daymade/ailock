import fetch from 'node-fetch';
import { loadUserConfig, saveUserConfig, getOfflineMode, shouldCollectAnalytics } from '../core/user-config.js';
import { getMachineUuid, sanitizeForLogging } from '../core/machine-id.js';

/**
 * API response interfaces matching the ailock-web Edge Functions
 */
export interface AuthRedeemResponse {
  success: boolean;
  error?: string;
  user_id?: string;
  directory_quota?: number;
  is_first_activation?: boolean;
  message?: string;
}

export interface UsageTrackingResponse {
  success: boolean;
  error?: string;
}

export interface UserStatusResponse {
  success: boolean;
  error?: string;
  directory_quota?: number;
  available_codes?: number;
  is_activated?: boolean;
}

/**
 * Event types for usage tracking
 */
export type UsageEventType = 
  | 'lock_attempt_blocked'
  | 'directory_locked' 
  | 'directory_unlocked'
  | 'status_check';

/**
 * CLI API service for integration with ailock-web growth system
 */
export class CliApiService {
  private baseUrl: string;
  private timeout: number;
  private maxRetries: number;

  constructor(options?: {
    baseUrl?: string;
    timeout?: number;
    maxRetries?: number;
  }) {
    // Default to ailock-web production URL, can be overridden via environment
    this.baseUrl = options?.baseUrl || 
      process.env.AILOCK_API_URL || 
      'https://woodccjkyacwceitkjby.supabase.co/functions/v1';
    this.timeout = options?.timeout || 10000; // 10 seconds
    this.maxRetries = options?.maxRetries || 3;
  }

  /**
   * Check if we're in offline mode or should skip API calls
   */
  private async shouldSkipApiCall(): Promise<boolean> {
    const isOffline = await getOfflineMode();
    const debugMode = process.env.AILOCK_DEBUG === 'true';
    
    if (isOffline && debugMode) {
      console.log('Debug: Skipping API call (offline mode)');
    }
    
    return isOffline;
  }

  /**
   * Make HTTP request with timeout and retry logic
   */
  private async makeRequest(
    endpoint: string, 
    options: {
      method: 'GET' | 'POST';
      body?: any;
      headers?: Record<string, string>;
    }
  ): Promise<any> {
    const url = `${this.baseUrl}/${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        if (process.env.AILOCK_DEBUG === 'true') {
          console.log(`Debug: API request to ${sanitizeForLogging(url)} (attempt ${attempt + 1}/${this.maxRetries})`);
        }

        const response = await fetch(url, {
          method: options.method,
          headers: {
            'Content-Type': 'application/json',
            ...options.headers
          },
          body: options.body ? JSON.stringify(options.body) : undefined,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        return data;

      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        
        if (process.env.AILOCK_DEBUG === 'true') {
          console.log(`Debug: API request failed (attempt ${attempt + 1}): ${sanitizeForLogging(lastError.message)}`);
        }

        // Don't retry on timeout or abort
        if (lastError.name === 'AbortError') {
          break;
        }

        // Wait before retry (exponential backoff)
        if (attempt < this.maxRetries - 1) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    clearTimeout(timeoutId);
    throw lastError || new Error('Request failed');
  }

  /**
   * Redeem an auth code to increase directory quota
   */
  async redeemAuthCode(code: string): Promise<AuthRedeemResponse> {
    if (await this.shouldSkipApiCall()) {
      return {
        success: false,
        error: 'Offline mode - cannot redeem auth code'
      };
    }

    try {
      const machineUuid = await getMachineUuid();
      
      const response = await this.makeRequest('cli-auth-redeem', {
        method: 'POST',
        body: {
          code: code.trim(),
          machine_uuid: machineUuid
        }
      });

      // Update local config if redemption was successful
      if (response.success && response.directory_quota) {
        const config = await loadUserConfig();
        config.directoryQuota = response.directory_quota;
        config.lastSyncAt = new Date();
        await saveUserConfig(config);
      }

      return response as AuthRedeemResponse;

    } catch (error) {
      return {
        success: false,
        error: `Failed to redeem auth code: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Track usage events for analytics
   */
  async trackUsage(
    eventType: UsageEventType,
    data?: {
      directoryPath?: string;
      totalLockedCount?: number;
      metadata?: Record<string, any>;
    }
  ): Promise<UsageTrackingResponse> {
    if (await this.shouldSkipApiCall()) {
      // Don't log in offline mode unless debug is enabled
      if (process.env.AILOCK_DEBUG === 'true') {
        console.log(`Debug: Would track event ${sanitizeForLogging(eventType)} (offline mode)`);
      }
      return { success: true }; // Silently succeed in offline mode
    }

    // Check privacy settings before tracking
    if (!(await shouldCollectAnalytics())) {
      if (process.env.AILOCK_DEBUG === 'true') {
        console.log(`Debug: Analytics disabled by privacy settings, skipping event ${sanitizeForLogging(eventType)}`);
      }
      return { success: true }; // Silently succeed when analytics disabled
    }

    try {
      const machineUuid = await getMachineUuid();
      
      const response = await this.makeRequest('cli-usage-track', {
        method: 'POST',
        body: {
          machine_uuid: machineUuid,
          event_type: eventType,
          directory_path: data?.directoryPath, // Web side will handle hashing for privacy
          total_locked_count: data?.totalLockedCount,
          metadata: data?.metadata
        }
      });

      return response as UsageTrackingResponse;

    } catch (error) {
      // Don't fail the main operation if analytics fail
      if (process.env.AILOCK_DEBUG === 'true') {
        console.log(`Debug: Failed to track usage event: ${sanitizeForLogging(error instanceof Error ? error.message : String(error))}`);
      }
      return { success: false, error: 'Analytics tracking failed' };
    }
  }

  /**
   * Get user status including quota and available codes
   */
  async getUserStatus(authCode?: string): Promise<UserStatusResponse> {
    if (await this.shouldSkipApiCall()) {
      // Return local config data in offline mode
      const config = await loadUserConfig();
      return {
        success: true,
        directory_quota: config.directoryQuota,
        available_codes: 0, // Can't check available codes offline
        is_activated: !!config.authToken
      };
    }

    try {
      if (!authCode) {
        return {
          success: false,
          error: 'Auth code required to check status'
        };
      }

      const response = await this.makeRequest(`cli-status?code=${encodeURIComponent(authCode)}`, {
        method: 'GET'
      });

      return response as UserStatusResponse;

    } catch (error) {
      return {
        success: false,
        error: `Failed to get user status: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  /**
   * Test API connectivity
   */
  async testConnectivity(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/cli-usage-track`, {
        method: 'OPTIONS'
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get API configuration info for debugging
   */
  getApiInfo(): { baseUrl: string; timeout: number; maxRetries: number } {
    return {
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      maxRetries: this.maxRetries
    };
  }
}

/**
 * Singleton instance for use throughout the application
 */
let apiServiceInstance: CliApiService | null = null;

export function getApiService(): CliApiService {
  if (!apiServiceInstance) {
    apiServiceInstance = new CliApiService();
  }
  return apiServiceInstance;
}

/**
 * Create a custom API service instance (useful for testing)
 */
export function createApiService(options?: {
  baseUrl?: string;
  timeout?: number;
  maxRetries?: number;
}): CliApiService {
  return new CliApiService(options);
}