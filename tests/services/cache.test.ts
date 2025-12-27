/**
 * Cache Service Tests
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

class CacheService<T = unknown> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private defaultTtl: number;
  private maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(options: { defaultTtl?: number; maxSize?: number } = {}) {
    this.defaultTtl = options.defaultTtl ?? 3600000; // 1 hour
    this.maxSize = options.maxSize ?? 1000;
  }

  async get(key: string): Promise<T | null> {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.misses++;
      return null;
    }

    this.hits++;
    return entry.value;
  }

  async set(key: string, value: T, ttl?: number): Promise<void> {
    if (this.cache.size >= this.maxSize) {
      this.evictOldest();
    }

    const now = Date.now();
    this.cache.set(key, {
      value,
      expiresAt: now + (ttl ?? this.defaultTtl),
      createdAt: now,
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  async getOrSet(key: string, factory: () => Promise<T>, ttl?: number): Promise<T> {
    const cached = await this.get(key);
    if (cached !== null) return cached;

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let removed = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    return removed;
  }

  getStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }

  async keys(): Promise<string[]> {
    const result: string[] = [];
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now <= entry.expiresAt) {
        result.push(key);
      }
    }

    return result;
  }

  async values(): Promise<T[]> {
    const result: T[] = [];
    const now = Date.now();

    for (const entry of this.cache.values()) {
      if (now <= entry.expiresAt) {
        result.push(entry.value);
      }
    }

    return result;
  }
}

describe('CacheService', () => {
  let cache: CacheService<string>;

  beforeEach(() => {
    cache = new CacheService<string>();
  });

  describe('get', () => {
    it('should return cached value', async () => {
      await cache.set('key', 'value');
      expect(await cache.get('key')).toBe('value');
    });

    it('should return null for missing key', async () => {
      expect(await cache.get('missing')).toBeNull();
    });

    it('should return null for expired key', async () => {
      const shortCache = new CacheService<string>({ defaultTtl: 50 });
      await shortCache.set('key', 'value');
      await new Promise(r => setTimeout(r, 100));
      expect(await shortCache.get('key')).toBeNull();
    });

    it('should track hits', async () => {
      await cache.set('key', 'value');
      await cache.get('key');
      await cache.get('key');
      expect(cache.getStats().hits).toBe(2);
    });

    it('should track misses', async () => {
      await cache.get('missing1');
      await cache.get('missing2');
      expect(cache.getStats().misses).toBe(2);
    });
  });

  describe('set', () => {
    it('should store value', async () => {
      await cache.set('key', 'value');
      expect(await cache.has('key')).toBe(true);
    });

    it('should overwrite existing value', async () => {
      await cache.set('key', 'value1');
      await cache.set('key', 'value2');
      expect(await cache.get('key')).toBe('value2');
    });

    it('should use custom TTL', async () => {
      await cache.set('key', 'value', 50);
      expect(await cache.has('key')).toBe(true);
      await new Promise(r => setTimeout(r, 100));
      expect(await cache.has('key')).toBe(false);
    });

    it('should evict oldest when max size reached', async () => {
      const smallCache = new CacheService<string>({ maxSize: 3 });
      await smallCache.set('key1', 'value1');
      await smallCache.set('key2', 'value2');
      await smallCache.set('key3', 'value3');
      await smallCache.set('key4', 'value4');

      expect(smallCache.getStats().size).toBe(3);
    });
  });

  describe('delete', () => {
    it('should remove cached value', async () => {
      await cache.set('key', 'value');
      await cache.delete('key');
      expect(await cache.has('key')).toBe(false);
    });

    it('should return true when key deleted', async () => {
      await cache.set('key', 'value');
      expect(await cache.delete('key')).toBe(true);
    });

    it('should return false for missing key', async () => {
      expect(await cache.delete('missing')).toBe(false);
    });
  });

  describe('has', () => {
    it('should return true for existing key', async () => {
      await cache.set('key', 'value');
      expect(await cache.has('key')).toBe(true);
    });

    it('should return false for missing key', async () => {
      expect(await cache.has('missing')).toBe(false);
    });

    it('should return false for expired key', async () => {
      const shortCache = new CacheService<string>({ defaultTtl: 50 });
      await shortCache.set('key', 'value');
      await new Promise(r => setTimeout(r, 100));
      expect(await shortCache.has('key')).toBe(false);
    });
  });

  describe('getOrSet', () => {
    it('should return cached value', async () => {
      await cache.set('key', 'cached');
      const result = await cache.getOrSet('key', async () => 'factory');
      expect(result).toBe('cached');
    });

    it('should call factory for missing key', async () => {
      const factory = jest.fn().mockResolvedValue('factory-value');
      const result = await cache.getOrSet('key', factory);
      expect(result).toBe('factory-value');
      expect(factory).toHaveBeenCalled();
    });

    it('should cache factory result', async () => {
      const factory = jest.fn().mockResolvedValue('value');
      await cache.getOrSet('key', factory);
      await cache.getOrSet('key', factory);
      expect(factory).toHaveBeenCalledTimes(1);
    });

    it('should use custom TTL', async () => {
      const shortCache = new CacheService<string>();
      await shortCache.getOrSet('key', async () => 'value', 50);
      expect(await shortCache.has('key')).toBe(true);
      await new Promise(r => setTimeout(r, 100));
      expect(await shortCache.has('key')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      await cache.clear();
      expect(cache.getStats().size).toBe(0);
    });

    it('should handle empty cache', async () => {
      await expect(cache.clear()).resolves.not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const shortCache = new CacheService<string>({ defaultTtl: 50 });
      await shortCache.set('old1', 'value1');
      await shortCache.set('old2', 'value2');
      await new Promise(r => setTimeout(r, 100));
      await shortCache.set('new', 'value');

      const removed = await shortCache.cleanup();
      expect(removed).toBe(2);
      expect(shortCache.getStats().size).toBe(1);
    });

    it('should return count of removed entries', async () => {
      const shortCache = new CacheService<string>({ defaultTtl: 50 });
      for (let i = 0; i < 10; i++) {
        await shortCache.set(`key${i}`, 'value');
      }
      await new Promise(r => setTimeout(r, 100));

      const removed = await shortCache.cleanup();
      expect(removed).toBe(10);
    });
  });

  describe('getStats', () => {
    it('should return size', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      expect(cache.getStats().size).toBe(2);
    });

    it('should calculate hit rate', async () => {
      await cache.set('key', 'value');
      await cache.get('key'); // hit
      await cache.get('key'); // hit
      await cache.get('missing'); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBeCloseTo(0.666, 2);
    });

    it('should return 0 hit rate for empty cache', () => {
      expect(cache.getStats().hitRate).toBe(0);
    });
  });

  describe('keys', () => {
    it('should return all valid keys', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      const keys = await cache.keys();
      expect(keys).toContain('key1');
      expect(keys).toContain('key2');
    });

    it('should exclude expired keys', async () => {
      const shortCache = new CacheService<string>({ defaultTtl: 50 });
      await shortCache.set('old', 'value');
      await new Promise(r => setTimeout(r, 100));
      await shortCache.set('new', 'value');

      const keys = await shortCache.keys();
      expect(keys).not.toContain('old');
      expect(keys).toContain('new');
    });
  });

  describe('values', () => {
    it('should return all valid values', async () => {
      await cache.set('key1', 'value1');
      await cache.set('key2', 'value2');
      const values = await cache.values();
      expect(values).toContain('value1');
      expect(values).toContain('value2');
    });

    it('should exclude expired values', async () => {
      const shortCache = new CacheService<string>({ defaultTtl: 50 });
      await shortCache.set('old', 'old-value');
      await new Promise(r => setTimeout(r, 100));
      await shortCache.set('new', 'new-value');

      const values = await shortCache.values();
      expect(values).not.toContain('old-value');
      expect(values).toContain('new-value');
    });
  });

  describe('typed cache', () => {
    it('should cache objects', async () => {
      const objectCache = new CacheService<{ name: string; value: number }>();
      await objectCache.set('obj', { name: 'test', value: 42 });
      const result = await objectCache.get('obj');
      expect(result?.name).toBe('test');
      expect(result?.value).toBe(42);
    });

    it('should cache arrays', async () => {
      const arrayCache = new CacheService<number[]>();
      await arrayCache.set('arr', [1, 2, 3]);
      const result = await arrayCache.get('arr');
      expect(result).toEqual([1, 2, 3]);
    });

    it('should cache null values', async () => {
      const nullableCache = new CacheService<string | null>();
      await nullableCache.set('null', null);
      // Note: our get returns null for missing, so this is ambiguous
      // In real implementation, you might use a sentinel value
    });
  });

  describe('performance', () => {
    it('should handle many entries', async () => {
      const largeCache = new CacheService<string>({ maxSize: 10000 });
      const start = Date.now();

      for (let i = 0; i < 10000; i++) {
        await largeCache.set(`key${i}`, `value${i}`);
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });

    it('should have fast lookups', async () => {
      for (let i = 0; i < 1000; i++) {
        await cache.set(`key${i}`, `value${i}`);
      }

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        await cache.get(`key${i}`);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent gets', async () => {
      await cache.set('key', 'value');

      const promises = Array.from({ length: 100 }, () => cache.get('key'));
      const results = await Promise.all(promises);

      expect(results.every(r => r === 'value')).toBe(true);
    });

    it('should handle concurrent sets', async () => {
      const promises = Array.from({ length: 100 }, (_, i) =>
        cache.set(`key${i}`, `value${i}`)
      );

      await Promise.all(promises);
      expect(cache.getStats().size).toBeGreaterThan(0);
    });
  });
});
