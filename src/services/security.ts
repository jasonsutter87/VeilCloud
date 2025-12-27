/**
 * Security Service
 * Input validation, rate limiting, and security utilities
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import type { FastifyRequest } from 'fastify';

// ============================================================================
// Types
// ============================================================================

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (request: FastifyRequest) => string;
}

export interface InputValidationResult {
  valid: boolean;
  sanitized?: unknown;
  errors?: string[];
}

export interface SecurityHeaders {
  'X-Content-Type-Options': string;
  'X-Frame-Options': string;
  'X-XSS-Protection': string;
  'Strict-Transport-Security': string;
  'Content-Security-Policy': string;
  'Referrer-Policy': string;
  'Permissions-Policy': string;
}

// ============================================================================
// Constants
// ============================================================================

const DANGEROUS_PATTERNS = [
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // Script tags
  /javascript:/gi, // JavaScript protocol
  /on\w+\s*=/gi, // Event handlers
  /data:text\/html/gi, // Data URLs
  /<iframe/gi, // iframes
  /<object/gi, // Objects
  /<embed/gi, // Embeds
  /expression\s*\(/gi, // CSS expressions
];

const SQL_INJECTION_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE)\b)/gi,
  /(\bOR\b\s+\d+\s*=\s*\d+)/gi,
  /(--)/g,
  /(;)/g,
  /(\bUNION\b)/gi,
];

const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//g,
  /\.\.\\+/g,
  /%2e%2e/gi,
  /%252e%252e/gi,
];

// ============================================================================
// Service
// ============================================================================

export class SecurityService {
  /**
   * Validate and sanitize user input
   */
  validateInput(input: unknown, options?: {
    maxLength?: number;
    allowHtml?: boolean;
    allowedFields?: string[];
  }): InputValidationResult {
    const errors: string[] = [];

    if (input === null || input === undefined) {
      return { valid: true, sanitized: input };
    }

    if (typeof input === 'string') {
      return this.validateString(input, options?.maxLength, options?.allowHtml);
    }

    if (typeof input === 'object') {
      return this.validateObject(input as Record<string, unknown>, options?.allowedFields);
    }

    return { valid: true, sanitized: input };
  }

  /**
   * Validate string input
   */
  private validateString(
    input: string,
    maxLength = 10000,
    allowHtml = false
  ): InputValidationResult {
    const errors: string[] = [];

    // Length check
    if (input.length > maxLength) {
      errors.push(`Input exceeds maximum length of ${maxLength}`);
    }

    // Check for dangerous patterns if HTML not allowed
    if (!allowHtml) {
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.test(input)) {
          errors.push('Input contains potentially dangerous content');
          break;
        }
      }
    }

    // Check for SQL injection patterns (log only, don't block)
    for (const pattern of SQL_INJECTION_PATTERNS) {
      if (pattern.test(input)) {
        console.warn('[Security] Potential SQL injection detected:', input.substring(0, 100));
        break;
      }
    }

    // Check for path traversal
    for (const pattern of PATH_TRAVERSAL_PATTERNS) {
      if (pattern.test(input)) {
        errors.push('Input contains path traversal sequences');
        break;
      }
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    // Sanitize
    let sanitized = input;
    if (!allowHtml) {
      sanitized = this.escapeHtml(input);
    }

    return { valid: true, sanitized };
  }

  /**
   * Validate object input
   */
  private validateObject(
    input: Record<string, unknown>,
    allowedFields?: string[]
  ): InputValidationResult {
    const errors: string[] = [];
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      // Check allowed fields
      if (allowedFields && !allowedFields.includes(key)) {
        continue; // Skip disallowed fields
      }

      // Validate key
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
        errors.push(`Invalid field name: ${key}`);
        continue;
      }

      // Recursively validate value
      const result = this.validateInput(value);
      if (!result.valid) {
        errors.push(...(result.errors ?? []));
      } else {
        sanitized[key] = result.sanitized;
      }
    }

    return {
      valid: errors.length === 0,
      sanitized,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Escape HTML entities
   */
  escapeHtml(input: string): string {
    const htmlEntities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#x27;',
      '/': '&#x2F;',
    };

    return input.replace(/[&<>"'/]/g, (char) => htmlEntities[char] ?? char);
  }

  /**
   * Generate CSRF token
   */
  generateCsrfToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Verify CSRF token (timing-safe)
   */
  verifyCsrfToken(provided: string, expected: string): boolean {
    if (!provided || !expected) {
      return false;
    }

    const providedBuffer = Buffer.from(provided);
    const expectedBuffer = Buffer.from(expected);

    if (providedBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(providedBuffer, expectedBuffer);
  }

  /**
   * Hash sensitive data
   */
  hashSensitive(data: string, salt?: string): string {
    const actualSalt = salt ?? randomBytes(16).toString('hex');
    const hash = createHash('sha256')
      .update(actualSalt + data)
      .digest('hex');
    return `${actualSalt}:${hash}`;
  }

  /**
   * Verify hashed sensitive data
   */
  verifyHash(data: string, hashedData: string): boolean {
    const [salt, hash] = hashedData.split(':');
    if (!salt || !hash) {
      return false;
    }

    const computedHash = createHash('sha256')
      .update(salt + data)
      .digest('hex');

    return timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash));
  }

  /**
   * Get recommended security headers
   */
  getSecurityHeaders(): SecurityHeaders {
    return {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Content-Security-Policy': "default-src 'self'; script-src 'none'; style-src 'self'",
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
  }

  /**
   * Check if request might be an attack
   */
  analyzeRequest(request: FastifyRequest): {
    suspicious: boolean;
    reasons: string[];
    riskScore: number;
  } {
    const reasons: string[] = [];
    let riskScore = 0;

    // Check for common attack patterns in URL
    const url = request.url;
    if (PATH_TRAVERSAL_PATTERNS.some((p) => p.test(url))) {
      reasons.push('Path traversal in URL');
      riskScore += 50;
    }

    // Check User-Agent
    const userAgent = request.headers['user-agent'] ?? '';
    if (!userAgent) {
      reasons.push('Missing User-Agent');
      riskScore += 10;
    } else if (userAgent.length > 1000) {
      reasons.push('Suspiciously long User-Agent');
      riskScore += 20;
    }

    // Check for common scanner signatures
    const scannerSignatures = [
      'sqlmap',
      'nikto',
      'nessus',
      'acunetix',
      'burp',
      'owasp',
      'dirbuster',
      'gobuster',
    ];
    if (scannerSignatures.some((sig) => userAgent.toLowerCase().includes(sig))) {
      reasons.push('Known scanner User-Agent');
      riskScore += 80;
    }

    // Check for excessive headers
    const headerCount = Object.keys(request.headers).length;
    if (headerCount > 50) {
      reasons.push('Excessive headers');
      riskScore += 30;
    }

    return {
      suspicious: riskScore >= 50,
      reasons,
      riskScore: Math.min(100, riskScore),
    };
  }

  /**
   * Redact sensitive data from logs
   */
  redactSensitive(data: unknown): unknown {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    const sensitiveFields = [
      'password',
      'secret',
      'token',
      'apiKey',
      'api_key',
      'authorization',
      'credential',
      'privateKey',
      'private_key',
      'ssn',
      'creditCard',
      'credit_card',
    ];

    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (sensitiveFields.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        result[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        result[key] = this.redactSensitive(value);
      } else {
        result[key] = value;
      }
    }

    return result;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let securityService: SecurityService | null = null;

export function getSecurityService(): SecurityService {
  if (!securityService) {
    securityService = new SecurityService();
  }
  return securityService;
}
