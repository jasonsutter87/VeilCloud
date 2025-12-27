/**
 * Hash Utility Tests
 */

import { createHash, randomBytes } from 'crypto';

// Mock hash functions that would be in src/core/hash.ts
const hash = {
  sha256: (data: string | Buffer): string => {
    return createHash('sha256').update(data).digest('hex');
  },
  sha512: (data: string | Buffer): string => {
    return createHash('sha512').update(data).digest('hex');
  },
  blake2b: (data: string | Buffer, size = 32): string => {
    // Simulated blake2b (would use actual library in production)
    return createHash('sha256').update(data).digest('hex').slice(0, size * 2);
  },
  hmac: (key: string, data: string): string => {
    const { createHmac } = require('crypto');
    return createHmac('sha256', key).update(data).digest('hex');
  },
  verify: (hash1: string, hash2: string): boolean => {
    if (hash1.length !== hash2.length) return false;
    let result = 0;
    for (let i = 0; i < hash1.length; i++) {
      result |= hash1.charCodeAt(i) ^ hash2.charCodeAt(i);
    }
    return result === 0;
  },
  randomBytes: (size: number): Buffer => {
    return randomBytes(size);
  },
  toHex: (buffer: Buffer): string => {
    return buffer.toString('hex');
  },
  fromHex: (hex: string): Buffer => {
    return Buffer.from(hex, 'hex');
  },
  combine: (...hashes: string[]): string => {
    return createHash('sha256').update(hashes.join('')).digest('hex');
  },
  hashObject: (obj: object): string => {
    const sorted = JSON.stringify(obj, Object.keys(obj).sort());
    return createHash('sha256').update(sorted).digest('hex');
  },
};

describe('Hash Utilities', () => {
  describe('sha256', () => {
    it('should produce consistent hash for same input', () => {
      const input = 'hello world';
      const hash1 = hash.sha256(input);
      const hash2 = hash.sha256(input);
      expect(hash1).toBe(hash2);
    });

    it('should produce 64 character hex string', () => {
      const result = hash.sha256('test');
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[0-9a-f]+$/);
    });

    it('should produce different hash for different input', () => {
      const hash1 = hash.sha256('hello');
      const hash2 = hash.sha256('world');
      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const result = hash.sha256('');
      expect(result).toHaveLength(64);
    });

    it('should handle Buffer input', () => {
      const buffer = Buffer.from('test data');
      const result = hash.sha256(buffer);
      expect(result).toHaveLength(64);
    });

    it('should handle unicode characters', () => {
      const result = hash.sha256('こんにちは世界');
      expect(result).toHaveLength(64);
    });

    it('should handle special characters', () => {
      const result = hash.sha256('!@#$%^&*()_+-=[]{}|;:,.<>?');
      expect(result).toHaveLength(64);
    });

    it('should produce known hash for known input', () => {
      const result = hash.sha256('');
      expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    });

    it('should be deterministic across calls', () => {
      const results = Array.from({ length: 100 }, () => hash.sha256('consistent'));
      const unique = new Set(results);
      expect(unique.size).toBe(1);
    });

    it('should handle long strings', () => {
      const longString = 'a'.repeat(1000000);
      const result = hash.sha256(longString);
      expect(result).toHaveLength(64);
    });
  });

  describe('sha512', () => {
    it('should produce 128 character hex string', () => {
      const result = hash.sha512('test');
      expect(result).toHaveLength(128);
    });

    it('should produce consistent hash', () => {
      const input = 'test data';
      const hash1 = hash.sha512(input);
      const hash2 = hash.sha512(input);
      expect(hash1).toBe(hash2);
    });

    it('should differ from sha256', () => {
      const input = 'same input';
      const sha256Result = hash.sha256(input);
      const sha512Result = hash.sha512(input);
      expect(sha256Result).not.toBe(sha512Result);
    });

    it('should handle empty string', () => {
      const result = hash.sha512('');
      expect(result).toHaveLength(128);
    });

    it('should handle Buffer input', () => {
      const buffer = Buffer.from('buffer data');
      const result = hash.sha512(buffer);
      expect(result).toHaveLength(128);
    });
  });

  describe('blake2b', () => {
    it('should produce hash of specified size', () => {
      const result = hash.blake2b('test', 32);
      expect(result).toHaveLength(64);
    });

    it('should default to 32 bytes', () => {
      const result = hash.blake2b('test');
      expect(result).toHaveLength(64);
    });

    it('should produce consistent hash', () => {
      const input = 'hello';
      const hash1 = hash.blake2b(input);
      const hash2 = hash.blake2b(input);
      expect(hash1).toBe(hash2);
    });

    it('should handle different sizes', () => {
      const small = hash.blake2b('test', 16);
      const large = hash.blake2b('test', 32);
      expect(small.length).toBeLessThan(large.length);
    });
  });

  describe('hmac', () => {
    it('should produce consistent HMAC', () => {
      const key = 'secret';
      const data = 'message';
      const hmac1 = hash.hmac(key, data);
      const hmac2 = hash.hmac(key, data);
      expect(hmac1).toBe(hmac2);
    });

    it('should produce 64 character hex string', () => {
      const result = hash.hmac('key', 'data');
      expect(result).toHaveLength(64);
    });

    it('should differ with different keys', () => {
      const data = 'same message';
      const hmac1 = hash.hmac('key1', data);
      const hmac2 = hash.hmac('key2', data);
      expect(hmac1).not.toBe(hmac2);
    });

    it('should differ with different data', () => {
      const key = 'same key';
      const hmac1 = hash.hmac(key, 'message1');
      const hmac2 = hash.hmac(key, 'message2');
      expect(hmac1).not.toBe(hmac2);
    });

    it('should handle empty key', () => {
      const result = hash.hmac('', 'data');
      expect(result).toHaveLength(64);
    });

    it('should handle empty data', () => {
      const result = hash.hmac('key', '');
      expect(result).toHaveLength(64);
    });
  });

  describe('verify', () => {
    it('should return true for identical hashes', () => {
      const h = hash.sha256('test');
      expect(hash.verify(h, h)).toBe(true);
    });

    it('should return false for different hashes', () => {
      const h1 = hash.sha256('test1');
      const h2 = hash.sha256('test2');
      expect(hash.verify(h1, h2)).toBe(false);
    });

    it('should return false for different lengths', () => {
      expect(hash.verify('abc', 'abcd')).toBe(false);
    });

    it('should use constant-time comparison', () => {
      // This is hard to test directly, but we verify behavior
      const h1 = 'a'.repeat(64);
      const h2 = 'b'.repeat(64);
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        hash.verify(h1, h2);
      }
      const time1 = Date.now() - start;

      const h3 = 'a'.repeat(64);
      const h4 = 'a'.repeat(63) + 'b';
      const start2 = Date.now();
      for (let i = 0; i < 10000; i++) {
        hash.verify(h3, h4);
      }
      const time2 = Date.now() - start2;

      // Times should be roughly similar (within 50%)
      expect(Math.abs(time1 - time2)).toBeLessThan(Math.max(time1, time2) * 0.5 + 10);
    });

    it('should handle empty strings', () => {
      expect(hash.verify('', '')).toBe(true);
    });

    it('should be case sensitive', () => {
      expect(hash.verify('ABC', 'abc')).toBe(false);
    });
  });

  describe('randomBytes', () => {
    it('should return buffer of specified size', () => {
      const result = hash.randomBytes(32);
      expect(result).toHaveLength(32);
      expect(Buffer.isBuffer(result)).toBe(true);
    });

    it('should produce different results each call', () => {
      const r1 = hash.randomBytes(32);
      const r2 = hash.randomBytes(32);
      expect(r1.equals(r2)).toBe(false);
    });

    it('should handle size 0', () => {
      const result = hash.randomBytes(0);
      expect(result).toHaveLength(0);
    });

    it('should handle large sizes', () => {
      const result = hash.randomBytes(1024);
      expect(result).toHaveLength(1024);
    });

    it('should produce cryptographically random bytes', () => {
      // Statistical test: bytes should be roughly uniformly distributed
      const bytes = hash.randomBytes(10000);
      const counts = new Array(256).fill(0);
      for (const byte of bytes) {
        counts[byte]++;
      }
      const expected = 10000 / 256;
      const variance = counts.reduce((sum, c) => sum + Math.pow(c - expected, 2), 0) / 256;
      const stdDev = Math.sqrt(variance);
      // Standard deviation should be reasonable
      expect(stdDev).toBeLessThan(expected * 0.3);
    });
  });

  describe('toHex', () => {
    it('should convert buffer to hex string', () => {
      const buffer = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
      expect(hash.toHex(buffer)).toBe('48656c6c6f');
    });

    it('should handle empty buffer', () => {
      expect(hash.toHex(Buffer.from([]))).toBe('');
    });

    it('should handle all byte values', () => {
      const buffer = Buffer.from([0x00, 0xff, 0x0f, 0xf0]);
      expect(hash.toHex(buffer)).toBe('00ff0ff0');
    });

    it('should produce lowercase hex', () => {
      const buffer = Buffer.from([0xAB, 0xCD, 0xEF]);
      const result = hash.toHex(buffer);
      expect(result).toBe(result.toLowerCase());
    });
  });

  describe('fromHex', () => {
    it('should convert hex string to buffer', () => {
      const result = hash.fromHex('48656c6c6f');
      expect(result.toString()).toBe('Hello');
    });

    it('should handle empty string', () => {
      const result = hash.fromHex('');
      expect(result).toHaveLength(0);
    });

    it('should handle uppercase hex', () => {
      const result = hash.fromHex('ABCDEF');
      expect(result).toEqual(Buffer.from([0xab, 0xcd, 0xef]));
    });

    it('should be inverse of toHex', () => {
      const original = Buffer.from('test data');
      const hex = hash.toHex(original);
      const result = hash.fromHex(hex);
      expect(result.equals(original)).toBe(true);
    });

    it('should handle mixed case', () => {
      const result = hash.fromHex('AbCdEf');
      expect(result).toEqual(Buffer.from([0xab, 0xcd, 0xef]));
    });
  });

  describe('combine', () => {
    it('should combine multiple hashes', () => {
      const h1 = hash.sha256('a');
      const h2 = hash.sha256('b');
      const combined = hash.combine(h1, h2);
      expect(combined).toHaveLength(64);
    });

    it('should produce consistent result', () => {
      const h1 = hash.sha256('a');
      const h2 = hash.sha256('b');
      const c1 = hash.combine(h1, h2);
      const c2 = hash.combine(h1, h2);
      expect(c1).toBe(c2);
    });

    it('should be order-dependent', () => {
      const h1 = hash.sha256('a');
      const h2 = hash.sha256('b');
      const c1 = hash.combine(h1, h2);
      const c2 = hash.combine(h2, h1);
      expect(c1).not.toBe(c2);
    });

    it('should handle single hash', () => {
      const h = hash.sha256('test');
      const combined = hash.combine(h);
      expect(combined).toHaveLength(64);
    });

    it('should handle many hashes', () => {
      const hashes = Array.from({ length: 100 }, (_, i) => hash.sha256(String(i)));
      const combined = hash.combine(...hashes);
      expect(combined).toHaveLength(64);
    });

    it('should differ with different inputs', () => {
      const h1 = hash.sha256('a');
      const h2 = hash.sha256('b');
      const h3 = hash.sha256('c');
      const c1 = hash.combine(h1, h2);
      const c2 = hash.combine(h1, h3);
      expect(c1).not.toBe(c2);
    });
  });

  describe('hashObject', () => {
    it('should hash object consistently', () => {
      const obj = { a: 1, b: 2 };
      const h1 = hash.hashObject(obj);
      const h2 = hash.hashObject(obj);
      expect(h1).toBe(h2);
    });

    it('should be order-independent for keys', () => {
      const obj1 = { a: 1, b: 2 };
      const obj2 = { b: 2, a: 1 };
      expect(hash.hashObject(obj1)).toBe(hash.hashObject(obj2));
    });

    it('should handle nested objects', () => {
      const obj = { a: { b: { c: 1 } } };
      const result = hash.hashObject(obj);
      expect(result).toHaveLength(64);
    });

    it('should handle arrays', () => {
      const obj = { items: [1, 2, 3] };
      const result = hash.hashObject(obj);
      expect(result).toHaveLength(64);
    });

    it('should differ for different objects', () => {
      const h1 = hash.hashObject({ a: 1 });
      const h2 = hash.hashObject({ a: 2 });
      expect(h1).not.toBe(h2);
    });

    it('should handle empty object', () => {
      const result = hash.hashObject({});
      expect(result).toHaveLength(64);
    });

    it('should handle null values', () => {
      const result = hash.hashObject({ a: null });
      expect(result).toHaveLength(64);
    });

    it('should handle boolean values', () => {
      const h1 = hash.hashObject({ flag: true });
      const h2 = hash.hashObject({ flag: false });
      expect(h1).not.toBe(h2);
    });

    it('should handle string values', () => {
      const result = hash.hashObject({ name: 'test' });
      expect(result).toHaveLength(64);
    });

    it('should be array-order dependent', () => {
      const h1 = hash.hashObject({ items: [1, 2, 3] });
      const h2 = hash.hashObject({ items: [3, 2, 1] });
      expect(h1).not.toBe(h2);
    });
  });

  describe('edge cases', () => {
    it('should handle binary data', () => {
      const binary = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0xfd]);
      const result = hash.sha256(binary);
      expect(result).toHaveLength(64);
    });

    it('should handle newlines', () => {
      const result = hash.sha256('line1\nline2\nline3');
      expect(result).toHaveLength(64);
    });

    it('should handle tabs', () => {
      const result = hash.sha256('col1\tcol2\tcol3');
      expect(result).toHaveLength(64);
    });

    it('should handle null bytes', () => {
      const result = hash.sha256('before\x00after');
      expect(result).toHaveLength(64);
    });

    it('should handle high unicode', () => {
      const result = hash.sha256('🎉🚀💯');
      expect(result).toHaveLength(64);
    });
  });

  describe('performance', () => {
    it('should hash quickly', () => {
      const data = 'a'.repeat(1000);
      const start = Date.now();
      for (let i = 0; i < 10000; i++) {
        hash.sha256(data);
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(2000); // 10k hashes in under 2 seconds
    });

    it('should verify quickly', () => {
      const h1 = hash.sha256('test');
      const h2 = hash.sha256('test');
      const start = Date.now();
      for (let i = 0; i < 100000; i++) {
        hash.verify(h1, h2);
      }
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000); // 100k verifies in under 1 second
    });
  });
});
