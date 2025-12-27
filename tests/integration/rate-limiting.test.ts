/**
 * Rate Limiting Integration Tests
 */

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: any) => string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  retryAfter?: number;
}

class RateLimiter {
  private windows: Map<string, { count: number; startedAt: number }> = new Map();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig) {
    this.config = config;
  }

  check(key: string): RateLimitResult {
    const now = Date.now();
    const window = this.windows.get(key);

    if (!window || now > window.startedAt + this.config.windowMs) {
      // New window
      this.windows.set(key, { count: 1, startedAt: now });
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetAt: new Date(now + this.config.windowMs),
      };
    }

    if (window.count >= this.config.maxRequests) {
      const retryAfter = Math.ceil((window.startedAt + this.config.windowMs - now) / 1000);
      return {
        allowed: false,
        remaining: 0,
        resetAt: new Date(window.startedAt + this.config.windowMs),
        retryAfter,
      };
    }

    window.count++;
    return {
      allowed: true,
      remaining: this.config.maxRequests - window.count,
      resetAt: new Date(window.startedAt + this.config.windowMs),
    };
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  getRemainingRequests(key: string): number {
    const window = this.windows.get(key);
    if (!window) return this.config.maxRequests;

    const now = Date.now();
    if (now > window.startedAt + this.config.windowMs) {
      return this.config.maxRequests;
    }

    return Math.max(0, this.config.maxRequests - window.count);
  }

  getResetTime(key: string): Date | null {
    const window = this.windows.get(key);
    if (!window) return null;
    return new Date(window.startedAt + this.config.windowMs);
  }

  cleanup(): number {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, window] of this.windows.entries()) {
      if (now > window.startedAt + this.config.windowMs) {
        this.windows.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }
}

describe('Rate Limiting', () => {
  describe('RateLimiter', () => {
    let limiter: RateLimiter;

    beforeEach(() => {
      limiter = new RateLimiter({
        windowMs: 60000, // 1 minute
        maxRequests: 100,
      });
    });

    describe('check', () => {
      it('should allow request under limit', () => {
        const result = limiter.check('user-1');
        expect(result.allowed).toBe(true);
      });

      it('should track remaining requests', () => {
        limiter.check('user-1');
        const result = limiter.check('user-1');
        expect(result.remaining).toBe(98);
      });

      it('should block after limit reached', () => {
        for (let i = 0; i < 100; i++) {
          limiter.check('user-1');
        }

        const result = limiter.check('user-1');
        expect(result.allowed).toBe(false);
      });

      it('should return retry-after when blocked', () => {
        for (let i = 0; i < 100; i++) {
          limiter.check('user-1');
        }

        const result = limiter.check('user-1');
        expect(result.retryAfter).toBeDefined();
        expect(result.retryAfter).toBeGreaterThan(0);
      });

      it('should return reset time', () => {
        const result = limiter.check('user-1');
        expect(result.resetAt).toBeInstanceOf(Date);
        expect(result.resetAt.getTime()).toBeGreaterThan(Date.now());
      });

      it('should track separate keys independently', () => {
        for (let i = 0; i < 100; i++) {
          limiter.check('user-1');
        }

        const result = limiter.check('user-2');
        expect(result.allowed).toBe(true);
      });
    });

    describe('reset', () => {
      it('should reset request count', () => {
        for (let i = 0; i < 50; i++) {
          limiter.check('user-1');
        }

        limiter.reset('user-1');

        const result = limiter.check('user-1');
        expect(result.remaining).toBe(99);
      });

      it('should only reset specified key', () => {
        limiter.check('user-1');
        limiter.check('user-2');

        limiter.reset('user-1');

        expect(limiter.getRemainingRequests('user-1')).toBe(100);
        expect(limiter.getRemainingRequests('user-2')).toBe(99);
      });
    });

    describe('getRemainingRequests', () => {
      it('should return max for new key', () => {
        expect(limiter.getRemainingRequests('new-user')).toBe(100);
      });

      it('should return remaining count', () => {
        for (let i = 0; i < 10; i++) {
          limiter.check('user-1');
        }
        expect(limiter.getRemainingRequests('user-1')).toBe(90);
      });

      it('should return 0 when exhausted', () => {
        for (let i = 0; i < 100; i++) {
          limiter.check('user-1');
        }
        expect(limiter.getRemainingRequests('user-1')).toBe(0);
      });
    });

    describe('getResetTime', () => {
      it('should return null for new key', () => {
        expect(limiter.getResetTime('new-user')).toBeNull();
      });

      it('should return reset time after request', () => {
        limiter.check('user-1');
        const resetTime = limiter.getResetTime('user-1');
        expect(resetTime).toBeInstanceOf(Date);
      });
    });

    describe('cleanup', () => {
      it('should remove expired windows', async () => {
        const shortLimiter = new RateLimiter({
          windowMs: 50,
          maxRequests: 10,
        });

        shortLimiter.check('user-1');
        shortLimiter.check('user-2');

        await new Promise(r => setTimeout(r, 100));

        const cleaned = shortLimiter.cleanup();
        expect(cleaned).toBe(2);
      });

      it('should keep active windows', () => {
        limiter.check('user-1');
        const cleaned = limiter.cleanup();
        expect(cleaned).toBe(0);
      });
    });

    describe('window expiry', () => {
      it('should reset after window expires', async () => {
        const shortLimiter = new RateLimiter({
          windowMs: 50,
          maxRequests: 5,
        });

        for (let i = 0; i < 5; i++) {
          shortLimiter.check('user-1');
        }

        expect(shortLimiter.check('user-1').allowed).toBe(false);

        await new Promise(r => setTimeout(r, 100));

        expect(shortLimiter.check('user-1').allowed).toBe(true);
      });
    });
  });

  describe('Rate limit scenarios', () => {
    it('should handle API rate limiting', () => {
      const apiLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 1000,
      });

      const results = [];
      for (let i = 0; i < 1000; i++) {
        results.push(apiLimiter.check('api-key-1'));
      }

      expect(results.every(r => r.allowed)).toBe(true);
      expect(apiLimiter.check('api-key-1').allowed).toBe(false);
    });

    it('should handle login attempt limiting', () => {
      const loginLimiter = new RateLimiter({
        windowMs: 300000, // 5 minutes
        maxRequests: 5,
      });

      for (let i = 0; i < 5; i++) {
        loginLimiter.check('user@example.com');
      }

      const result = loginLimiter.check('user@example.com');
      expect(result.allowed).toBe(false);
    });

    it('should handle per-IP limiting', () => {
      const ipLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 100,
      });

      // Different IPs should be independent
      for (let i = 0; i < 100; i++) {
        ipLimiter.check('192.168.1.1');
      }

      expect(ipLimiter.check('192.168.1.1').allowed).toBe(false);
      expect(ipLimiter.check('192.168.1.2').allowed).toBe(true);
    });

    it('should handle per-endpoint limiting', () => {
      const endpointLimiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 50,
      });

      for (let i = 0; i < 50; i++) {
        endpointLimiter.check('POST:/api/secrets');
      }

      expect(endpointLimiter.check('POST:/api/secrets').allowed).toBe(false);
      expect(endpointLimiter.check('GET:/api/secrets').allowed).toBe(true);
    });
  });

  describe('Rate limit headers', () => {
    it('should provide X-RateLimit-Remaining info', () => {
      const limiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 100,
      });

      for (let i = 0; i < 10; i++) {
        limiter.check('user-1');
      }

      const remaining = limiter.getRemainingRequests('user-1');
      expect(remaining).toBe(90);
    });

    it('should provide X-RateLimit-Reset info', () => {
      const limiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 100,
      });

      limiter.check('user-1');
      const resetTime = limiter.getResetTime('user-1');

      expect(resetTime).toBeDefined();
      expect(resetTime!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should provide Retry-After info', () => {
      const limiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 5,
      });

      for (let i = 0; i < 5; i++) {
        limiter.check('user-1');
      }

      const result = limiter.check('user-1');
      expect(result.retryAfter).toBeDefined();
      expect(result.retryAfter).toBeLessThanOrEqual(60);
    });
  });

  describe('Concurrent rate limiting', () => {
    it('should handle concurrent requests', async () => {
      const limiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 100,
      });

      const promises = Array.from({ length: 50 }, () =>
        Promise.resolve(limiter.check('user-1'))
      );

      const results = await Promise.all(promises);
      expect(results.filter(r => r.allowed).length).toBe(50);
    });

    it('should handle concurrent requests from different users', async () => {
      const limiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 10,
      });

      const promises = Array.from({ length: 50 }, (_, i) =>
        Promise.resolve(limiter.check(`user-${i % 5}`))
      );

      const results = await Promise.all(promises);
      expect(results.every(r => r.allowed)).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle many keys efficiently', () => {
      const limiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 100,
      });

      const start = Date.now();

      for (let i = 0; i < 10000; i++) {
        limiter.check(`user-${i}`);
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });

    it('should handle many requests per key efficiently', () => {
      const limiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 10000,
      });

      const start = Date.now();

      for (let i = 0; i < 10000; i++) {
        limiter.check('user-1');
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
    });

    it('should cleanup efficiently', () => {
      const limiter = new RateLimiter({
        windowMs: 1,
        maxRequests: 100,
      });

      for (let i = 0; i < 1000; i++) {
        limiter.check(`user-${i}`);
      }

      const start = Date.now();
      limiter.cleanup();
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('Edge cases', () => {
    it('should handle zero max requests', () => {
      const limiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 0,
      });

      const result = limiter.check('user-1');
      expect(result.allowed).toBe(false);
    });

    it('should handle very short window', async () => {
      const limiter = new RateLimiter({
        windowMs: 10,
        maxRequests: 1,
      });

      limiter.check('user-1');
      expect(limiter.check('user-1').allowed).toBe(false);

      await new Promise(r => setTimeout(r, 20));

      expect(limiter.check('user-1').allowed).toBe(true);
    });

    it('should handle empty key', () => {
      const limiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 100,
      });

      const result = limiter.check('');
      expect(result.allowed).toBe(true);
    });

    it('should handle special characters in key', () => {
      const limiter = new RateLimiter({
        windowMs: 60000,
        maxRequests: 100,
      });

      const result = limiter.check('user@example.com:POST:/api/v1/secrets');
      expect(result.allowed).toBe(true);
    });
  });
});
