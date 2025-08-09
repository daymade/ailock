/**
 * Error message sanitization to prevent information disclosure
 */
export class ErrorSanitizer {
  private readonly sensitivePatterns = [
    /\/Users\/[^\/\s]+/g,                  // macOS user directories
    /\/home\/[^\/\s]+/g,                   // Linux home directories
    /C:\\Users\\[^\\\/\s]+/g,              // Windows user directories
    /password[:\s]*[^\s]+/gi,              // Password values
    /token[:\s]*[^\s]+/gi,                 // Token values
    /bearer[:\s]+[^\s]+/gi,                // Bearer tokens
    /authorization[:\s]*[^\s]+/gi,         // Authorization headers
    /api[_-]?key[:\s]*[^\s]+/gi,          // API keys
    /secret[:\s]*[^\s]+/gi,                // Secret values
    /private[_-]?key[:\s]*[^\s]+/gi,      // Private keys
    /ssh[_-]?key[:\s]*[^\s]+/gi,          // SSH keys
    /cert[:\s]*[^\s]+/gi,                  // Certificate data
    /x-[a-z-]+[:\s]*[^\s]+/gi,            // Custom headers
    /[a-f0-9]{32,}/g,                      // Potential hashes (MD5, SHA, etc.)
    /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, // UUIDs
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, // IP addresses
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // Email addresses
    /(?:https?|ftp):\/\/[^\s]+/g,          // URLs
    /-----BEGIN[^-]+-----[\s\S]+?-----END[^-]+-----/g, // PEM certificates/keys
    /\$[A-Z_][A-Z0-9_]*/g,                // Environment variables
    /"[^"]*"/g,                            // Quoted strings (potential secrets)
    /'[^']*'/g,                            // Single-quoted strings
    /`[^`]*`/g                             // Backticked strings
  ];

  private readonly replacements: Array<[RegExp, string]> = [
    [/\/Users\/[^\/\s]+/g, '/Users/[user]'],
    [/\/home\/[^\/\s]+/g, '/home/[user]'],
    [/C:\\Users\\[^\\\/\s]+/g, 'C:\\Users\\[user]'],
    [/password[:\s]*[^\s]+/gi, 'password: [REDACTED]'],
    [/token[:\s]*[^\s]+/gi, 'token: [REDACTED]'],
    [/bearer[:\s]+[^\s]+/gi, 'bearer [REDACTED]'],
    [/authorization[:\s]*[^\s]+/gi, 'authorization: [REDACTED]'],
    [/api[_-]?key[:\s]*[^\s]+/gi, 'api_key: [REDACTED]'],
    [/secret[:\s]*[^\s]+/gi, 'secret: [REDACTED]'],
    [/private[_-]?key[:\s]*[^\s]+/gi, 'private_key: [REDACTED]'],
    [/ssh[_-]?key[:\s]*[^\s]+/gi, 'ssh_key: [REDACTED]'],
    [/cert[:\s]*[^\s]+/gi, 'cert: [REDACTED]'],
    [/x-[a-z-]+[:\s]*[^\s]+/gi, 'x-header: [REDACTED]'],
    [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP_ADDRESS]'],
    [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]'],
    [/(?:https?|ftp):\/\/[^\s]+/g, '[URL]'],
    [/-----BEGIN[^-]+-----[\s\S]+?-----END[^-]+-----/g, '[CERTIFICATE/KEY]'],
    [/\$[A-Z_][A-Z0-9_]*/g, '$[ENV_VAR]'],
    [/"[^"]*"/g, '"[REDACTED]"'],
    [/'[^']*'/g, "'[REDACTED]'"],
    [/`[^`]*`/g, '`[REDACTED]`']
  ];

  /**
   * Sanitize error message to remove sensitive information
   */
  sanitizeMessage(message: string): string {
    if (!message || typeof message !== 'string') {
      return '[INVALID_MESSAGE]';
    }

    let sanitized = message;

    // Apply all replacement patterns
    for (const [pattern, replacement] of this.replacements) {
      sanitized = sanitized.replace(pattern, replacement);
    }

    // Additional cleanup for potential hash values
    sanitized = sanitized.replace(/[a-f0-9]{16,}/g, '[HASH]');

    // Clean up UUID-like patterns
    sanitized = sanitized.replace(
      /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi,
      '[UUID]'
    );

    return this.limitMessageLength(sanitized);
  }

  /**
   * Sanitize context object by removing sensitive keys and values
   */
  sanitizeContext(context: Record<string, any>, maxSize: number = 1000): Record<string, any> {
    if (!context || typeof context !== 'object') {
      return {};
    }

    const sensitiveKeys = [
      'password', 'secret', 'token', 'key', 'auth', 'credential',
      'private', 'certificate', 'cert', 'passphrase', 'pin'
    ];

    const sanitized: Record<string, any> = {};
    let currentSize = 0;

    for (const [key, value] of Object.entries(context)) {
      if (currentSize >= maxSize) {
        sanitized['...'] = '[TRUNCATED]';
        break;
      }

      const lowerKey = key.toLowerCase();
      const isSensitiveKey = sensitiveKeys.some(sk => lowerKey.includes(sk));

      if (isSensitiveKey) {
        sanitized[key] = '[REDACTED]';
        currentSize += 20;
      } else {
        const sanitizedValue = this.sanitizeValue(value);
        const serialized = JSON.stringify(sanitizedValue);
        
        if (currentSize + serialized.length <= maxSize) {
          sanitized[key] = sanitizedValue;
          currentSize += serialized.length;
        } else {
          sanitized['...'] = '[TRUNCATED]';
          break;
        }
      }
    }

    return sanitized;
  }

  /**
   * Check if a message contains sensitive patterns
   */
  containsSensitiveData(message: string): boolean {
    if (!message || typeof message !== 'string') {
      return false;
    }

    return this.sensitivePatterns.some(pattern => pattern.test(message));
  }

  private sanitizeValue(value: any): any {
    if (typeof value === 'string') {
      return this.sanitizeMessage(value);
    }
    
    if (Array.isArray(value)) {
      return value.slice(0, 10).map(v => this.sanitizeValue(v));
    }
    
    if (value && typeof value === 'object') {
      const result: Record<string, any> = {};
      let count = 0;
      
      for (const [k, v] of Object.entries(value)) {
        if (count >= 10) {
          result['...'] = '[TRUNCATED]';
          break;
        }
        result[k] = this.sanitizeValue(v);
        count++;
      }
      
      return result;
    }
    
    return value;
  }

  private limitMessageLength(message: string, maxLength: number = 500): string {
    if (message.length <= maxLength) {
      return message;
    }
    
    return message.substring(0, maxLength - 15) + '... [TRUNCATED]';
  }
}