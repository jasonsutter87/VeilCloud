/**
 * Security Service Tests
 */

import { SecurityService } from '../../src/services/security.js';

describe('SecurityService', () => {
  let service: SecurityService;

  beforeEach(() => {
    service = new SecurityService();
  });

  describe('validateInput', () => {
    describe('string validation', () => {
      it('should accept valid strings', () => {
        const result = service.validateInput('hello world');
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('hello world');
      });

      it('should reject strings exceeding max length', () => {
        const longString = 'a'.repeat(10001);
        const result = service.validateInput(longString, { maxLength: 10000 });
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Input exceeds maximum length of 10000');
      });

      it('should detect script tags', () => {
        const result = service.validateInput('<script>alert("xss")</script>');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Input contains potentially dangerous content');
      });

      it('should detect javascript: protocol', () => {
        const result = service.validateInput('javascript:alert(1)');
        expect(result.valid).toBe(false);
      });

      it('should detect event handlers', () => {
        const result = service.validateInput('<img onerror=alert(1)>');
        expect(result.valid).toBe(false);
      });

      it('should detect path traversal', () => {
        const result = service.validateInput('../../../etc/passwd');
        expect(result.valid).toBe(false);
        expect(result.errors).toContain('Input contains path traversal sequences');
      });

      it('should allow HTML when specified', () => {
        const result = service.validateInput('<b>bold</b>', { allowHtml: true });
        expect(result.valid).toBe(true);
      });

      it('should escape HTML entities when not allowed', () => {
        const result = service.validateInput('<p>text</p>');
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBe('&lt;p&gt;text&lt;&#x2F;p&gt;');
      });
    });

    describe('object validation', () => {
      it('should validate objects recursively', () => {
        const result = service.validateInput({
          name: 'test',
          nested: { value: 'hello' },
        });
        expect(result.valid).toBe(true);
      });

      it('should filter disallowed fields', () => {
        const result = service.validateInput(
          { name: 'test', secret: 'value' },
          { allowedFields: ['name'] }
        );
        expect(result.valid).toBe(true);
        expect(result.sanitized).toEqual({ name: 'test' });
      });

      it('should reject invalid field names', () => {
        const result = service.validateInput({ '123invalid': 'value' });
        expect(result.valid).toBe(false);
      });
    });

    describe('null/undefined handling', () => {
      it('should accept null', () => {
        const result = service.validateInput(null);
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBeNull();
      });

      it('should accept undefined', () => {
        const result = service.validateInput(undefined);
        expect(result.valid).toBe(true);
        expect(result.sanitized).toBeUndefined();
      });
    });
  });

  describe('escapeHtml', () => {
    it('should escape ampersand', () => {
      expect(service.escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('should escape less than', () => {
      expect(service.escapeHtml('<tag>')).toBe('&lt;tag&gt;');
    });

    it('should escape quotes', () => {
      expect(service.escapeHtml('"test"')).toBe('&quot;test&quot;');
    });

    it('should escape single quotes', () => {
      expect(service.escapeHtml("'test'")).toBe('&#x27;test&#x27;');
    });

    it('should escape slashes', () => {
      expect(service.escapeHtml('a/b')).toBe('a&#x2F;b');
    });

    it('should handle multiple characters', () => {
      expect(service.escapeHtml('<script>"test"</script>')).toBe(
        '&lt;script&gt;&quot;test&quot;&lt;&#x2F;script&gt;'
      );
    });
  });

  describe('CSRF tokens', () => {
    it('should generate random CSRF tokens', () => {
      const token1 = service.generateCsrfToken();
      const token2 = service.generateCsrfToken();

      expect(token1).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(token2).toHaveLength(64);
      expect(token1).not.toBe(token2);
    });

    it('should verify matching tokens', () => {
      const token = service.generateCsrfToken();
      expect(service.verifyCsrfToken(token, token)).toBe(true);
    });

    it('should reject non-matching tokens', () => {
      const token1 = service.generateCsrfToken();
      const token2 = service.generateCsrfToken();
      expect(service.verifyCsrfToken(token1, token2)).toBe(false);
    });

    it('should reject empty tokens', () => {
      expect(service.verifyCsrfToken('', 'token')).toBe(false);
      expect(service.verifyCsrfToken('token', '')).toBe(false);
    });

    it('should reject tokens of different lengths', () => {
      expect(service.verifyCsrfToken('short', 'verylongtoken')).toBe(false);
    });
  });

  describe('hashSensitive', () => {
    it('should hash data with salt', () => {
      const hashed = service.hashSensitive('password123');
      expect(hashed).toMatch(/^[a-f0-9]+:[a-f0-9]{64}$/);
    });

    it('should use provided salt', () => {
      const hash1 = service.hashSensitive('password', 'salt1');
      const hash2 = service.hashSensitive('password', 'salt2');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different hashes for different data', () => {
      const hash1 = service.hashSensitive('password1', 'salt');
      const hash2 = service.hashSensitive('password2', 'salt');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyHash', () => {
    it('should verify correct data', () => {
      const hashed = service.hashSensitive('mypassword');
      expect(service.verifyHash('mypassword', hashed)).toBe(true);
    });

    it('should reject incorrect data', () => {
      const hashed = service.hashSensitive('mypassword');
      expect(service.verifyHash('wrongpassword', hashed)).toBe(false);
    });

    it('should reject malformed hashes', () => {
      expect(service.verifyHash('data', 'nocolon')).toBe(false);
      expect(service.verifyHash('data', '')).toBe(false);
    });
  });

  describe('getSecurityHeaders', () => {
    it('should return all security headers', () => {
      const headers = service.getSecurityHeaders();

      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['X-XSS-Protection']).toBe('1; mode=block');
      expect(headers['Strict-Transport-Security']).toContain('max-age=');
      expect(headers['Content-Security-Policy']).toBeDefined();
      expect(headers['Referrer-Policy']).toBeDefined();
      expect(headers['Permissions-Policy']).toBeDefined();
    });
  });

  describe('analyzeRequest', () => {
    const createMockRequest = (overrides: Partial<{
      url: string;
      headers: Record<string, string>;
    }> = {}) => ({
      url: '/',
      headers: {
        'user-agent': 'Mozilla/5.0 Chrome/91.0',
        ...overrides.headers,
      },
      ...overrides,
    } as any);

    it('should not flag normal requests', () => {
      const result = service.analyzeRequest(createMockRequest());
      expect(result.suspicious).toBe(false);
      expect(result.riskScore).toBeLessThan(50);
    });

    it('should flag path traversal in URL', () => {
      const result = service.analyzeRequest(createMockRequest({ url: '/../../../etc/passwd' }));
      expect(result.suspicious).toBe(true);
      expect(result.reasons).toContain('Path traversal in URL');
    });

    it('should flag missing User-Agent', () => {
      const result = service.analyzeRequest(createMockRequest({ headers: {} }));
      expect(result.reasons).toContain('Missing User-Agent');
    });

    it('should flag known scanner signatures', () => {
      const scanners = ['sqlmap', 'nikto', 'nessus', 'acunetix', 'burp'];
      for (const scanner of scanners) {
        const result = service.analyzeRequest(
          createMockRequest({ headers: { 'user-agent': scanner } })
        );
        expect(result.suspicious).toBe(true);
        expect(result.reasons).toContain('Known scanner User-Agent');
      }
    });

    it('should flag suspicious long User-Agent', () => {
      const result = service.analyzeRequest(
        createMockRequest({ headers: { 'user-agent': 'a'.repeat(1001) } })
      );
      expect(result.reasons).toContain('Suspiciously long User-Agent');
    });

    it('should cap risk score at 100', () => {
      const result = service.analyzeRequest(
        createMockRequest({
          url: '/../passwd',
          headers: { 'user-agent': 'sqlmap' },
        })
      );
      expect(result.riskScore).toBeLessThanOrEqual(100);
    });
  });

  describe('redactSensitive', () => {
    it('should redact password fields', () => {
      const result = service.redactSensitive({ password: 'secret123' });
      expect(result).toEqual({ password: '[REDACTED]' });
    });

    it('should redact multiple sensitive fields', () => {
      const result = service.redactSensitive({
        password: 'secret',
        apiKey: 'key123',
        token: 'tok',
        secret: 'shh',
      });
      expect(result).toEqual({
        password: '[REDACTED]',
        apiKey: '[REDACTED]',
        token: '[REDACTED]',
        secret: '[REDACTED]',
      });
    });

    it('should preserve non-sensitive fields', () => {
      const result = service.redactSensitive({
        name: 'John',
        email: 'john@example.com',
        password: 'secret',
      });
      expect(result).toEqual({
        name: 'John',
        email: 'john@example.com',
        password: '[REDACTED]',
      });
    });

    it('should handle nested objects', () => {
      const result = service.redactSensitive({
        user: {
          name: 'John',
          password: 'secret',
        },
      });
      expect(result).toEqual({
        user: {
          name: 'John',
          password: '[REDACTED]',
        },
      });
    });

    it('should handle primitives', () => {
      expect(service.redactSensitive('string')).toBe('string');
      expect(service.redactSensitive(123)).toBe(123);
      expect(service.redactSensitive(null)).toBeNull();
    });
  });
});
