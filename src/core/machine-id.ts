import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { homedir, platform, arch, networkInterfaces } from 'os';
import { createHash, randomUUID } from 'crypto';

/**
 * Get the ailock configuration directory
 */
export function getAilockConfigDir(): string {
  return join(homedir(), '.ailock');
}

/**
 * Get the machine UUID file path
 */
export function getMachineUuidPath(): string {
  return join(getAilockConfigDir(), 'machine-uuid');
}

/**
 * Generate a stable machine identifier based on system characteristics
 * Falls back to crypto.randomUUID() if system info unavailable
 */
export function generateMachineId(): string {
  try {
    // Collect system characteristics for stable ID generation
    const systemInfo = {
      platform: platform(),
      arch: arch(),
      hostname: process.env.HOSTNAME || process.env.COMPUTERNAME || 'unknown'
    };

    // Get network interface MAC addresses for additional entropy
    const interfaces = networkInterfaces();
    const macAddresses: string[] = [];
    
    for (const interfaceName in interfaces) {
      const iface = interfaces[interfaceName];
      if (iface) {
        for (const config of iface) {
          if (config.mac && config.mac !== '00:00:00:00:00:00') {
            macAddresses.push(config.mac);
          }
        }
      }
    }

    // Create deterministic hash from system info
    if (macAddresses.length > 0) {
      const combinedInfo = JSON.stringify({
        ...systemInfo,
        mac: macAddresses.sort().join(':') // Sort for consistency
      });
      
      const hash = createHash('sha256').update(combinedInfo).digest('hex');
      // Take first 32 characters and format as UUID
      return [
        hash.slice(0, 8),
        hash.slice(8, 12),
        hash.slice(12, 16),
        hash.slice(16, 20),
        hash.slice(20, 32)
      ].join('-');
    } else {
      // Fallback to random UUID if no MAC addresses available
      return randomUUID();
    }
  } catch (error) {
    // Final fallback - always generate a valid UUID
    return randomUUID();
  }
}

/**
 * Get or create machine UUID
 * Returns a persistent machine identifier for analytics and API calls
 */
export async function getMachineUuid(): Promise<string> {
  const configDir = getAilockConfigDir();
  const uuidPath = getMachineUuidPath();

  try {
    // Try to read existing UUID
    if (existsSync(uuidPath)) {
      const existingUuid = await readFile(uuidPath, 'utf-8');
      const trimmedUuid = existingUuid.trim();
      
      // Validate UUID format (basic check)
      if (trimmedUuid.length > 0 && /^[0-9a-f-]{36}$/i.test(trimmedUuid)) {
        return trimmedUuid;
      }
    }

    // Generate new UUID if file doesn't exist or is invalid
    const newUuid = generateMachineId();
    
    // Ensure config directory exists
    if (!existsSync(configDir)) {
      await mkdir(configDir, { recursive: true });
    }

    // Write UUID to file with secure permissions
    await writeFile(uuidPath, newUuid, { 
      encoding: 'utf-8',
      mode: 0o600 // Read/write for owner only
    });

    return newUuid;
  } catch (error) {
    // If all else fails, return a session UUID (not persisted)
    console.warn('Warning: Could not persist machine UUID, using session UUID');
    return randomUUID();
  }
}

/**
 * Clear the stored machine UUID (useful for testing)
 */
export async function clearMachineUuid(): Promise<void> {
  const uuidPath = getMachineUuidPath();
  
  if (existsSync(uuidPath)) {
    const fs = await import('fs/promises');
    await fs.unlink(uuidPath);
  }
}

/**
 * Sanitize string for safe logging/transmission
 * Removes potential sensitive information
 */
export function sanitizeForLogging(input: string): string {
  if (!input) return '';
  
  // Hash any potential UUIDs for privacy
  const uuidRegex = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  let sanitized = input.replace(uuidRegex, (match) => {
    const hash = createHash('sha256').update(match).digest('hex');
    return `uuid_${hash.slice(0, 8)}`;
  });
  
  // Hash any potential file paths longer than reasonable length
  const pathRegex = /(?:\/[^\/\s]+){3,}|(?:[A-Z]:\\[^\\s]+){2,}/g;
  sanitized = sanitized.replace(pathRegex, (match) => {
    const hash = createHash('sha256').update(match).digest('hex');
    return `path_${hash.slice(0, 8)}`;
  });
  
  // Remove potential email addresses
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  sanitized = sanitized.replace(emailRegex, 'email_***');
  
  // Remove potential API keys or tokens
  const tokenRegex = /(?:api[_-]?key|token|secret|password)[^\s]*[=:]\s*[^\s]+/gi;
  sanitized = sanitized.replace(tokenRegex, 'credential_***');
  
  return sanitized;
}

/**
 * Hash directory path for privacy-preserving analytics
 */
export function hashPathForAnalytics(path: string): string {
  if (!path) return '';
  
  // Create a privacy-preserving hash that still allows for some analytics
  // We hash the path but preserve some structural information
  const normalizedPath = path.replace(/\\/g, '/').toLowerCase();
  const hash = createHash('sha256').update(normalizedPath).digest('hex');
  
  // Return first 16 characters for compact representation
  return hash.slice(0, 16);
}

/**
 * Validate that a string doesn't contain sensitive information
 * Returns true if safe to log/transmit
 */
export function isSafeForLogging(input: string): boolean {
  if (!input) return true;
  
  // Check for potential sensitive patterns
  const sensitivePatterns = [
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/, // Email
    /(?:password|secret|key|token)[^\s]*[=:]/i, // Credentials
    /(?:sk_|pk_|rk_)[a-zA-Z0-9]+/, // API keys
    /Bearer\s+[a-zA-Z0-9_.-]+/i, // Bearer tokens
    /(?:\/home\/|\/Users\/|C:\\Users\\)[^\/\s]+/, // Home directories
  ];
  
  return !sensitivePatterns.some(pattern => pattern.test(input));
}

/**
 * Get machine fingerprint for security validation
 * Used to detect if configuration has been moved between machines
 */
export function getMachineFingerprint(): string {
  try {
    const systemInfo = {
      platform: platform(),
      arch: arch(),
      // Don't include hostname as it's too identifying
    };
    
    const hash = createHash('sha256')
      .update(JSON.stringify(systemInfo))
      .digest('hex');
    
    return hash.slice(0, 16); // Short fingerprint
  } catch {
    return 'unknown';
  }
}

/**
 * Validate machine UUID format
 */
export function isValidMachineUuid(uuid: string): boolean {
  if (!uuid || typeof uuid !== 'string') return false;
  
  // Standard UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid.trim());
}