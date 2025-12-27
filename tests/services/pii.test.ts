/**
 * PII Detection and Redaction Service Tests
 */

// Mock PII detector
class PiiService {
  private patterns: Map<string, RegExp> = new Map([
    ['email', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g],
    ['phone', /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g],
    ['ssn', /\b\d{3}-\d{2}-\d{4}\b/g],
    ['creditCard', /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g],
    ['ipv4', /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g],
  ]);

  detect(text: string): Array<{ type: string; value: string; start: number; end: number }> {
    const findings: Array<{ type: string; value: string; start: number; end: number }> = [];

    for (const [type, pattern] of this.patterns) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(text)) !== null) {
        findings.push({
          type,
          value: match[0],
          start: match.index,
          end: match.index + match[0].length,
        });
      }
    }

    return findings.sort((a, b) => a.start - b.start);
  }

  redact(text: string, replacement = '[REDACTED]'): string {
    let result = text;
    const findings = this.detect(text);

    // Process in reverse order to maintain correct indices
    for (let i = findings.length - 1; i >= 0; i--) {
      const f = findings[i]!;
      result = result.slice(0, f.start) + replacement + result.slice(f.end);
    }

    return result;
  }

  mask(text: string): string {
    let result = text;
    const findings = this.detect(text);

    for (let i = findings.length - 1; i >= 0; i--) {
      const f = findings[i]!;
      const masked = this.maskValue(f.value, f.type);
      result = result.slice(0, f.start) + masked + result.slice(f.end);
    }

    return result;
  }

  private maskValue(value: string, type: string): string {
    switch (type) {
      case 'email': {
        const [local, domain] = value.split('@');
        return `${local![0]}***@${domain}`;
      }
      case 'phone':
        return `***-***-${value.slice(-4)}`;
      case 'ssn':
        return `***-**-${value.slice(-4)}`;
      case 'creditCard':
        return `****-****-****-${value.slice(-4)}`;
      case 'ipv4':
        return value.split('.').map((_, i) => (i < 2 ? '***' : _)).join('.');
      default:
        return '*'.repeat(value.length);
    }
  }

  hasPii(text: string): boolean {
    return this.detect(text).length > 0;
  }

  countPii(text: string): { total: number; byType: Record<string, number> } {
    const findings = this.detect(text);
    const byType: Record<string, number> = {};

    for (const f of findings) {
      byType[f.type] = (byType[f.type] ?? 0) + 1;
    }

    return { total: findings.length, byType };
  }

  addPattern(name: string, pattern: RegExp): void {
    this.patterns.set(name, pattern);
  }

  removePattern(name: string): boolean {
    return this.patterns.delete(name);
  }
}

describe('PiiService', () => {
  let service: PiiService;

  beforeEach(() => {
    service = new PiiService();
  });

  describe('detect', () => {
    describe('email detection', () => {
      it('should detect simple email', () => {
        const findings = service.detect('Contact: test@example.com');
        expect(findings).toHaveLength(1);
        expect(findings[0]!.type).toBe('email');
        expect(findings[0]!.value).toBe('test@example.com');
      });

      it('should detect multiple emails', () => {
        const findings = service.detect('a@b.com and c@d.org');
        expect(findings.filter(f => f.type === 'email')).toHaveLength(2);
      });

      it('should detect email with subdomain', () => {
        const findings = service.detect('user@mail.example.com');
        expect(findings[0]!.value).toBe('user@mail.example.com');
      });

      it('should detect email with plus addressing', () => {
        const findings = service.detect('user+tag@example.com');
        expect(findings[0]!.value).toBe('user+tag@example.com');
      });
    });

    describe('phone detection', () => {
      it('should detect phone with dashes', () => {
        const findings = service.detect('Call 123-456-7890');
        expect(findings[0]!.type).toBe('phone');
        expect(findings[0]!.value).toBe('123-456-7890');
      });

      it('should detect phone with dots', () => {
        const findings = service.detect('123.456.7890');
        expect(findings[0]!.value).toBe('123.456.7890');
      });

      it('should detect phone without separators', () => {
        const findings = service.detect('1234567890');
        expect(findings[0]!.type).toBe('phone');
      });
    });

    describe('SSN detection', () => {
      it('should detect SSN', () => {
        const findings = service.detect('SSN: 123-45-6789');
        expect(findings[0]!.type).toBe('ssn');
        expect(findings[0]!.value).toBe('123-45-6789');
      });

      it('should not detect partial SSN', () => {
        const findings = service.detect('123-45-678'); // Only 8 digits
        expect(findings.filter(f => f.type === 'ssn')).toHaveLength(0);
      });
    });

    describe('credit card detection', () => {
      it('should detect credit card with dashes', () => {
        const findings = service.detect('Card: 1234-5678-9012-3456');
        expect(findings[0]!.type).toBe('creditCard');
      });

      it('should detect credit card with spaces', () => {
        const findings = service.detect('1234 5678 9012 3456');
        expect(findings[0]!.type).toBe('creditCard');
      });

      it('should detect credit card without separators', () => {
        const findings = service.detect('1234567890123456');
        expect(findings[0]!.type).toBe('creditCard');
      });
    });

    describe('IP address detection', () => {
      it('should detect IPv4 address', () => {
        const findings = service.detect('Server: 192.168.1.1');
        expect(findings[0]!.type).toBe('ipv4');
        expect(findings[0]!.value).toBe('192.168.1.1');
      });

      it('should detect multiple IPs', () => {
        const findings = service.detect('From 10.0.0.1 to 10.0.0.2');
        expect(findings.filter(f => f.type === 'ipv4')).toHaveLength(2);
      });
    });

    describe('position tracking', () => {
      it('should return correct start position', () => {
        const findings = service.detect('Email: test@example.com');
        expect(findings[0]!.start).toBe(7);
      });

      it('should return correct end position', () => {
        const text = 'test@example.com';
        const findings = service.detect(text);
        expect(findings[0]!.end).toBe(text.length);
      });

      it('should sort findings by position', () => {
        const findings = service.detect('b@b.com first, a@a.com second');
        expect(findings[0]!.start).toBeLessThan(findings[1]!.start);
      });
    });

    it('should return empty array for no PII', () => {
      const findings = service.detect('No sensitive data here');
      expect(findings).toEqual([]);
    });

    it('should handle mixed PII types', () => {
      const findings = service.detect('test@example.com, 123-456-7890');
      expect(findings).toHaveLength(2);
      expect(findings.map(f => f.type)).toContain('email');
      expect(findings.map(f => f.type)).toContain('phone');
    });
  });

  describe('redact', () => {
    it('should redact email', () => {
      const result = service.redact('Contact: test@example.com');
      expect(result).toBe('Contact: [REDACTED]');
    });

    it('should redact multiple items', () => {
      const result = service.redact('a@b.com and 123-456-7890');
      expect(result).toBe('[REDACTED] and [REDACTED]');
    });

    it('should use custom replacement', () => {
      const result = service.redact('test@example.com', '***');
      expect(result).toBe('***');
    });

    it('should preserve non-PII text', () => {
      const result = service.redact('Hello test@example.com goodbye');
      expect(result).toBe('Hello [REDACTED] goodbye');
    });

    it('should handle no PII', () => {
      const text = 'No sensitive data';
      const result = service.redact(text);
      expect(result).toBe(text);
    });

    it('should handle adjacent PII', () => {
      const result = service.redact('a@b.com c@d.com');
      expect(result).toBe('[REDACTED] [REDACTED]');
    });
  });

  describe('mask', () => {
    it('should mask email preserving domain', () => {
      const result = service.mask('user@example.com');
      expect(result).toBe('u***@example.com');
    });

    it('should mask phone showing last 4 digits', () => {
      const result = service.mask('123-456-7890');
      expect(result).toBe('***-***-7890');
    });

    it('should mask SSN showing last 4 digits', () => {
      const result = service.mask('123-45-6789');
      expect(result).toBe('***-**-6789');
    });

    it('should mask credit card showing last 4 digits', () => {
      const result = service.mask('1234-5678-9012-3456');
      expect(result).toBe('****-****-****-3456');
    });

    it('should mask IP address partially', () => {
      const result = service.mask('192.168.1.100');
      expect(result).toContain('***');
      expect(result).toContain('100');
    });

    it('should mask multiple items', () => {
      const result = service.mask('Email: a@b.com Phone: 123-456-7890');
      expect(result).toContain('a***@b.com');
      expect(result).toContain('***-***-7890');
    });
  });

  describe('hasPii', () => {
    it('should return true when PII exists', () => {
      expect(service.hasPii('test@example.com')).toBe(true);
    });

    it('should return false when no PII', () => {
      expect(service.hasPii('No sensitive data')).toBe(false);
    });

    it('should detect any PII type', () => {
      expect(service.hasPii('192.168.1.1')).toBe(true);
      expect(service.hasPii('123-45-6789')).toBe(true);
    });
  });

  describe('countPii', () => {
    it('should count total PII', () => {
      const result = service.countPii('a@b.com c@d.com 123-456-7890');
      expect(result.total).toBe(3);
    });

    it('should count by type', () => {
      const result = service.countPii('a@b.com c@d.com 123-456-7890');
      expect(result.byType.email).toBe(2);
      expect(result.byType.phone).toBe(1);
    });

    it('should return 0 for no PII', () => {
      const result = service.countPii('No PII here');
      expect(result.total).toBe(0);
      expect(result.byType).toEqual({});
    });
  });

  describe('custom patterns', () => {
    it('should add custom pattern', () => {
      service.addPattern('customId', /CID-\d{6}/g);
      const findings = service.detect('ID: CID-123456');
      expect(findings[0]!.type).toBe('customId');
    });

    it('should detect with custom pattern', () => {
      service.addPattern('apiKey', /sk_[a-z0-9]{32}/g);
      const findings = service.detect('Key: sk_abcdefghijklmnopqrstuvwxyz123456');
      expect(findings[0]!.type).toBe('apiKey');
    });

    it('should remove pattern', () => {
      const removed = service.removePattern('email');
      expect(removed).toBe(true);

      const findings = service.detect('test@example.com');
      expect(findings.filter(f => f.type === 'email')).toHaveLength(0);
    });

    it('should return false when removing non-existent pattern', () => {
      const removed = service.removePattern('nonexistent');
      expect(removed).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      expect(service.detect('')).toEqual([]);
      expect(service.redact('')).toBe('');
    });

    it('should handle string with only PII', () => {
      const result = service.redact('test@example.com');
      expect(result).toBe('[REDACTED]');
    });

    it('should handle unicode text', () => {
      const result = service.redact('用户 test@example.com 数据');
      expect(result).toBe('用户 [REDACTED] 数据');
    });

    it('should handle newlines', () => {
      const result = service.redact('Line 1: a@b.com\nLine 2: c@d.com');
      expect(result).toBe('Line 1: [REDACTED]\nLine 2: [REDACTED]');
    });

    it('should handle overlapping patterns correctly', () => {
      // IP that looks like phone digits
      const findings = service.detect('192.168.1.100');
      expect(findings.filter(f => f.type === 'ipv4')).toHaveLength(1);
    });
  });

  describe('performance', () => {
    it('should handle large text', () => {
      const text = 'test@example.com '.repeat(1000);
      const start = Date.now();
      const findings = service.detect(text);
      const elapsed = Date.now() - start;

      expect(findings.length).toBe(1000);
      expect(elapsed).toBeLessThan(500);
    });

    it('should redact large text efficiently', () => {
      const text = 'Email: test@example.com, '.repeat(100);
      const start = Date.now();
      const result = service.redact(text);
      const elapsed = Date.now() - start;

      expect(result).not.toContain('@');
      expect(elapsed).toBeLessThan(200);
    });
  });
});
