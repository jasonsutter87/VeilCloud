/**
 * API Input Validation Tests
 */

// Mock validator
class Validator {
  static email(value: string): { valid: boolean; message?: string } {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!regex.test(value)) {
      return { valid: false, message: 'Invalid email format' };
    }
    return { valid: true };
  }

  static password(value: string): { valid: boolean; message?: string } {
    if (value.length < 8) {
      return { valid: false, message: 'Password must be at least 8 characters' };
    }
    if (!/[A-Z]/.test(value)) {
      return { valid: false, message: 'Password must contain uppercase letter' };
    }
    if (!/[a-z]/.test(value)) {
      return { valid: false, message: 'Password must contain lowercase letter' };
    }
    if (!/[0-9]/.test(value)) {
      return { valid: false, message: 'Password must contain a number' };
    }
    return { valid: true };
  }

  static uuid(value: string): { valid: boolean; message?: string } {
    const regex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!regex.test(value)) {
      return { valid: false, message: 'Invalid UUID format' };
    }
    return { valid: true };
  }

  static required(value: unknown): { valid: boolean; message?: string } {
    if (value === undefined || value === null || value === '') {
      return { valid: false, message: 'Field is required' };
    }
    return { valid: true };
  }

  static string(value: unknown, options?: { min?: number; max?: number }): { valid: boolean; message?: string } {
    if (typeof value !== 'string') {
      return { valid: false, message: 'Must be a string' };
    }
    if (options?.min !== undefined && value.length < options.min) {
      return { valid: false, message: `Must be at least ${options.min} characters` };
    }
    if (options?.max !== undefined && value.length > options.max) {
      return { valid: false, message: `Must be at most ${options.max} characters` };
    }
    return { valid: true };
  }

  static number(value: unknown, options?: { min?: number; max?: number }): { valid: boolean; message?: string } {
    if (typeof value !== 'number' || isNaN(value)) {
      return { valid: false, message: 'Must be a number' };
    }
    if (options?.min !== undefined && value < options.min) {
      return { valid: false, message: `Must be at least ${options.min}` };
    }
    if (options?.max !== undefined && value > options.max) {
      return { valid: false, message: `Must be at most ${options.max}` };
    }
    return { valid: true };
  }

  static array(value: unknown, options?: { min?: number; max?: number }): { valid: boolean; message?: string } {
    if (!Array.isArray(value)) {
      return { valid: false, message: 'Must be an array' };
    }
    if (options?.min !== undefined && value.length < options.min) {
      return { valid: false, message: `Must have at least ${options.min} items` };
    }
    if (options?.max !== undefined && value.length > options.max) {
      return { valid: false, message: `Must have at most ${options.max} items` };
    }
    return { valid: true };
  }

  static enum(value: unknown, allowed: string[]): { valid: boolean; message?: string } {
    if (!allowed.includes(value as string)) {
      return { valid: false, message: `Must be one of: ${allowed.join(', ')}` };
    }
    return { valid: true };
  }

  static url(value: string): { valid: boolean; message?: string } {
    try {
      new URL(value);
      return { valid: true };
    } catch {
      return { valid: false, message: 'Invalid URL format' };
    }
  }

  static date(value: string): { valid: boolean; message?: string } {
    const date = new Date(value);
    if (isNaN(date.getTime())) {
      return { valid: false, message: 'Invalid date format' };
    }
    return { valid: true };
  }

  static object(value: unknown): { valid: boolean; message?: string } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { valid: false, message: 'Must be an object' };
    }
    return { valid: true };
  }

  static pattern(value: string, regex: RegExp): { valid: boolean; message?: string } {
    if (!regex.test(value)) {
      return { valid: false, message: 'Invalid format' };
    }
    return { valid: true };
  }
}

describe('Validator', () => {
  describe('email', () => {
    it('should accept valid email', () => {
      expect(Validator.email('test@example.com').valid).toBe(true);
    });

    it('should accept email with subdomain', () => {
      expect(Validator.email('user@mail.example.com').valid).toBe(true);
    });

    it('should accept email with plus', () => {
      expect(Validator.email('user+tag@example.com').valid).toBe(true);
    });

    it('should reject email without @', () => {
      const result = Validator.email('invalid');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('Invalid email');
    });

    it('should reject email without domain', () => {
      expect(Validator.email('user@').valid).toBe(false);
    });

    it('should reject email without local part', () => {
      expect(Validator.email('@example.com').valid).toBe(false);
    });

    it('should reject email with spaces', () => {
      expect(Validator.email('user @example.com').valid).toBe(false);
    });
  });

  describe('password', () => {
    it('should accept valid password', () => {
      expect(Validator.password('Password123').valid).toBe(true);
    });

    it('should reject short password', () => {
      const result = Validator.password('Pass1');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('8 characters');
    });

    it('should require uppercase', () => {
      const result = Validator.password('password123');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('uppercase');
    });

    it('should require lowercase', () => {
      const result = Validator.password('PASSWORD123');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('lowercase');
    });

    it('should require number', () => {
      const result = Validator.password('PasswordABC');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('number');
    });

    it('should accept complex password', () => {
      expect(Validator.password('C0mpl3x!Pass#Word').valid).toBe(true);
    });
  });

  describe('uuid', () => {
    it('should accept valid UUID v4', () => {
      expect(Validator.uuid('550e8400-e29b-41d4-a716-446655440000').valid).toBe(true);
    });

    it('should accept valid UUID v1', () => {
      expect(Validator.uuid('550e8400-e29b-11d4-a716-446655440000').valid).toBe(true);
    });

    it('should reject invalid format', () => {
      const result = Validator.uuid('not-a-uuid');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('UUID');
    });

    it('should reject short string', () => {
      expect(Validator.uuid('550e8400-e29b-41d4').valid).toBe(false);
    });

    it('should reject invalid characters', () => {
      expect(Validator.uuid('550e8400-e29b-41d4-a716-44665544000g').valid).toBe(false);
    });
  });

  describe('required', () => {
    it('should accept non-empty string', () => {
      expect(Validator.required('value').valid).toBe(true);
    });

    it('should accept number', () => {
      expect(Validator.required(123).valid).toBe(true);
    });

    it('should accept zero', () => {
      expect(Validator.required(0).valid).toBe(true);
    });

    it('should accept false', () => {
      expect(Validator.required(false).valid).toBe(true);
    });

    it('should reject undefined', () => {
      expect(Validator.required(undefined).valid).toBe(false);
    });

    it('should reject null', () => {
      expect(Validator.required(null).valid).toBe(false);
    });

    it('should reject empty string', () => {
      const result = Validator.required('');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('required');
    });
  });

  describe('string', () => {
    it('should accept string', () => {
      expect(Validator.string('hello').valid).toBe(true);
    });

    it('should reject number', () => {
      expect(Validator.string(123 as any).valid).toBe(false);
    });

    it('should enforce min length', () => {
      const result = Validator.string('ab', { min: 3 });
      expect(result.valid).toBe(false);
      expect(result.message).toContain('at least 3');
    });

    it('should enforce max length', () => {
      const result = Validator.string('hello world', { max: 5 });
      expect(result.valid).toBe(false);
      expect(result.message).toContain('at most 5');
    });

    it('should accept string within bounds', () => {
      expect(Validator.string('hello', { min: 1, max: 10 }).valid).toBe(true);
    });
  });

  describe('number', () => {
    it('should accept number', () => {
      expect(Validator.number(123).valid).toBe(true);
    });

    it('should accept float', () => {
      expect(Validator.number(12.34).valid).toBe(true);
    });

    it('should accept negative', () => {
      expect(Validator.number(-5).valid).toBe(true);
    });

    it('should reject string', () => {
      expect(Validator.number('123' as any).valid).toBe(false);
    });

    it('should reject NaN', () => {
      expect(Validator.number(NaN).valid).toBe(false);
    });

    it('should enforce min', () => {
      const result = Validator.number(5, { min: 10 });
      expect(result.valid).toBe(false);
    });

    it('should enforce max', () => {
      const result = Validator.number(100, { max: 50 });
      expect(result.valid).toBe(false);
    });
  });

  describe('array', () => {
    it('should accept array', () => {
      expect(Validator.array([1, 2, 3]).valid).toBe(true);
    });

    it('should accept empty array', () => {
      expect(Validator.array([]).valid).toBe(true);
    });

    it('should reject object', () => {
      expect(Validator.array({} as any).valid).toBe(false);
    });

    it('should reject string', () => {
      expect(Validator.array('not array' as any).valid).toBe(false);
    });

    it('should enforce min items', () => {
      const result = Validator.array([1], { min: 2 });
      expect(result.valid).toBe(false);
    });

    it('should enforce max items', () => {
      const result = Validator.array([1, 2, 3, 4], { max: 3 });
      expect(result.valid).toBe(false);
    });
  });

  describe('enum', () => {
    it('should accept valid value', () => {
      expect(Validator.enum('red', ['red', 'green', 'blue']).valid).toBe(true);
    });

    it('should reject invalid value', () => {
      const result = Validator.enum('yellow', ['red', 'green', 'blue']);
      expect(result.valid).toBe(false);
      expect(result.message).toContain('red');
    });

    it('should be case sensitive', () => {
      expect(Validator.enum('RED', ['red', 'green']).valid).toBe(false);
    });
  });

  describe('url', () => {
    it('should accept valid http URL', () => {
      expect(Validator.url('http://example.com').valid).toBe(true);
    });

    it('should accept valid https URL', () => {
      expect(Validator.url('https://example.com').valid).toBe(true);
    });

    it('should accept URL with path', () => {
      expect(Validator.url('https://example.com/path/to/page').valid).toBe(true);
    });

    it('should accept URL with query', () => {
      expect(Validator.url('https://example.com?foo=bar').valid).toBe(true);
    });

    it('should reject invalid URL', () => {
      expect(Validator.url('not a url').valid).toBe(false);
    });

    it('should reject partial URL', () => {
      expect(Validator.url('example.com').valid).toBe(false);
    });
  });

  describe('date', () => {
    it('should accept ISO date', () => {
      expect(Validator.date('2024-01-15').valid).toBe(true);
    });

    it('should accept ISO datetime', () => {
      expect(Validator.date('2024-01-15T12:00:00Z').valid).toBe(true);
    });

    it('should reject invalid date', () => {
      expect(Validator.date('not a date').valid).toBe(false);
    });

    it('should reject empty string', () => {
      expect(Validator.date('').valid).toBe(false);
    });
  });

  describe('object', () => {
    it('should accept object', () => {
      expect(Validator.object({ key: 'value' }).valid).toBe(true);
    });

    it('should accept empty object', () => {
      expect(Validator.object({}).valid).toBe(true);
    });

    it('should reject array', () => {
      expect(Validator.object([]).valid).toBe(false);
    });

    it('should reject null', () => {
      expect(Validator.object(null).valid).toBe(false);
    });

    it('should reject primitive', () => {
      expect(Validator.object('string' as any).valid).toBe(false);
    });
  });

  describe('pattern', () => {
    it('should match simple pattern', () => {
      expect(Validator.pattern('abc123', /^[a-z]+\d+$/).valid).toBe(true);
    });

    it('should reject non-matching', () => {
      expect(Validator.pattern('123abc', /^[a-z]+\d+$/).valid).toBe(false);
    });

    it('should handle complex regex', () => {
      expect(Validator.pattern('user-name_123', /^[\w-]+$/).valid).toBe(true);
    });
  });

  describe('API input validation scenarios', () => {
    it('should validate user registration', () => {
      const input = {
        email: 'test@example.com',
        password: 'SecurePass123',
        name: 'Test User',
      };

      expect(Validator.email(input.email).valid).toBe(true);
      expect(Validator.password(input.password).valid).toBe(true);
      expect(Validator.string(input.name, { min: 1, max: 100 }).valid).toBe(true);
    });

    it('should validate project creation', () => {
      const input = {
        name: 'My Project',
        description: 'A test project',
        visibility: 'private',
      };

      expect(Validator.string(input.name, { min: 1, max: 50 }).valid).toBe(true);
      expect(Validator.string(input.description, { max: 500 }).valid).toBe(true);
      expect(Validator.enum(input.visibility, ['public', 'private']).valid).toBe(true);
    });

    it('should validate API key creation', () => {
      const input = {
        name: 'My API Key',
        permissions: ['read', 'write'],
        expiresIn: 86400,
      };

      expect(Validator.string(input.name, { min: 1, max: 100 }).valid).toBe(true);
      expect(Validator.array(input.permissions, { min: 1 }).valid).toBe(true);
      expect(Validator.number(input.expiresIn, { min: 0 }).valid).toBe(true);
    });

    it('should validate webhook creation', () => {
      const input = {
        url: 'https://example.com/webhook',
        events: ['secret.created', 'secret.updated'],
        secret: 'webhook-secret-123',
      };

      expect(Validator.url(input.url).valid).toBe(true);
      expect(Validator.array(input.events, { min: 1 }).valid).toBe(true);
      expect(Validator.string(input.secret, { min: 16 }).valid).toBe(true);
    });
  });
});
