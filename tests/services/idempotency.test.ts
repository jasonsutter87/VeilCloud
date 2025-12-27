/**
 * Idempotency Service Tests
 */

// Mock idempotency store
class IdempotencyService {
  private store: Map<string, { result: any; expiresAt: number }> = new Map();
  private ttlMs: number;

  constructor(ttlMs: number = 3600000) {
    this.ttlMs = ttlMs;
  }

  async check(key: string): Promise<{ exists: boolean; result?: any }> {
    const entry = this.store.get(key);
    if (!entry) return { exists: false };

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return { exists: false };
    }

    return { exists: true, result: entry.result };
  }

  async store(key: string, result: any): Promise<void> {
    this.store.set(key, {
      result,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  async remove(key: string): Promise<boolean> {
    return this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  async getStats(): Promise<{ size: number; oldestMs: number }> {
    let oldest = Date.now();
    for (const entry of this.store.values()) {
      const age = Date.now() - (entry.expiresAt - this.ttlMs);
      if (age < oldest) oldest = age;
    }
    return { size: this.store.size, oldestMs: oldest };
  }

  generateKey(userId: string, action: string, params: object): string {
    const crypto = require('crypto');
    const data = JSON.stringify({ userId, action, params });
    return crypto.createHash('sha256').update(data).digest('hex');
  }
}

describe('IdempotencyService', () => {
  let service: IdempotencyService;

  beforeEach(() => {
    service = new IdempotencyService(3600000); // 1 hour
  });

  describe('check', () => {
    it('should return exists: false for new key', async () => {
      const result = await service.check('new-key');
      expect(result.exists).toBe(false);
    });

    it('should return exists: true for stored key', async () => {
      await service.store('my-key', { success: true });
      const result = await service.check('my-key');
      expect(result.exists).toBe(true);
    });

    it('should return stored result', async () => {
      await service.store('my-key', { data: 'original result' });
      const result = await service.check('my-key');
      expect(result.result).toEqual({ data: 'original result' });
    });

    it('should expire old entries', async () => {
      const shortTtlService = new IdempotencyService(100); // 100ms TTL
      await shortTtlService.store('key', { value: 1 });

      // Wait for expiry
      await new Promise(r => setTimeout(r, 150));

      const result = await shortTtlService.check('key');
      expect(result.exists).toBe(false);
    });

    it('should not return expired entries', async () => {
      const shortTtlService = new IdempotencyService(50);
      await shortTtlService.store('key', { expired: true });
      await new Promise(r => setTimeout(r, 100));

      const result = await shortTtlService.check('key');
      expect(result.exists).toBe(false);
    });
  });

  describe('store', () => {
    it('should store result', async () => {
      await service.store('key-1', { result: 'stored' });
      const check = await service.check('key-1');
      expect(check.result).toEqual({ result: 'stored' });
    });

    it('should overwrite existing entry', async () => {
      await service.store('key', { version: 1 });
      await service.store('key', { version: 2 });
      const check = await service.check('key');
      expect(check.result).toEqual({ version: 2 });
    });

    it('should store complex objects', async () => {
      const complex = {
        userId: 'user-1',
        items: [1, 2, 3],
        nested: { a: { b: { c: 1 } } },
        date: new Date().toISOString(),
      };
      await service.store('complex-key', complex);
      const check = await service.check('complex-key');
      expect(check.result).toEqual(complex);
    });

    it('should store null result', async () => {
      await service.store('null-key', null);
      const check = await service.check('null-key');
      expect(check.exists).toBe(true);
      expect(check.result).toBeNull();
    });

    it('should store error result', async () => {
      await service.store('error-key', { error: 'Something failed' });
      const check = await service.check('error-key');
      expect(check.result.error).toBe('Something failed');
    });
  });

  describe('remove', () => {
    it('should remove stored entry', async () => {
      await service.store('key', { value: 1 });
      const removed = await service.remove('key');
      expect(removed).toBe(true);
      const check = await service.check('key');
      expect(check.exists).toBe(false);
    });

    it('should return false for non-existent key', async () => {
      const removed = await service.remove('nonexistent');
      expect(removed).toBe(false);
    });

    it('should only remove specified key', async () => {
      await service.store('key-1', { value: 1 });
      await service.store('key-2', { value: 2 });
      await service.remove('key-1');
      const check = await service.check('key-2');
      expect(check.exists).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all entries', async () => {
      await service.store('key-1', { value: 1 });
      await service.store('key-2', { value: 2 });
      await service.store('key-3', { value: 3 });
      await service.clear();

      expect((await service.check('key-1')).exists).toBe(false);
      expect((await service.check('key-2')).exists).toBe(false);
      expect((await service.check('key-3')).exists).toBe(false);
    });

    it('should handle empty store', async () => {
      await expect(service.clear()).resolves.not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should remove expired entries', async () => {
      const shortTtlService = new IdempotencyService(50);
      await shortTtlService.store('old-1', { old: true });
      await shortTtlService.store('old-2', { old: true });

      await new Promise(r => setTimeout(r, 100));

      await shortTtlService.store('new', { new: true });

      const removed = await shortTtlService.cleanup();
      expect(removed).toBe(2);

      const newCheck = await shortTtlService.check('new');
      expect(newCheck.exists).toBe(true);
    });

    it('should return count of removed entries', async () => {
      const shortTtlService = new IdempotencyService(50);
      for (let i = 0; i < 10; i++) {
        await shortTtlService.store(`key-${i}`, { i });
      }

      await new Promise(r => setTimeout(r, 100));

      const removed = await shortTtlService.cleanup();
      expect(removed).toBe(10);
    });

    it('should not remove valid entries', async () => {
      await service.store('valid', { valid: true });
      const removed = await service.cleanup();
      expect(removed).toBe(0);

      const check = await service.check('valid');
      expect(check.exists).toBe(true);
    });
  });

  describe('getStats', () => {
    it('should return store size', async () => {
      await service.store('key-1', {});
      await service.store('key-2', {});
      await service.store('key-3', {});

      const stats = await service.getStats();
      expect(stats.size).toBe(3);
    });

    it('should return 0 for empty store', async () => {
      const stats = await service.getStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('generateKey', () => {
    it('should generate consistent key for same inputs', () => {
      const key1 = service.generateKey('user-1', 'create', { name: 'test' });
      const key2 = service.generateKey('user-1', 'create', { name: 'test' });
      expect(key1).toBe(key2);
    });

    it('should generate different key for different users', () => {
      const key1 = service.generateKey('user-1', 'create', { name: 'test' });
      const key2 = service.generateKey('user-2', 'create', { name: 'test' });
      expect(key1).not.toBe(key2);
    });

    it('should generate different key for different actions', () => {
      const key1 = service.generateKey('user-1', 'create', { name: 'test' });
      const key2 = service.generateKey('user-1', 'update', { name: 'test' });
      expect(key1).not.toBe(key2);
    });

    it('should generate different key for different params', () => {
      const key1 = service.generateKey('user-1', 'create', { name: 'test1' });
      const key2 = service.generateKey('user-1', 'create', { name: 'test2' });
      expect(key1).not.toBe(key2);
    });

    it('should generate 64-char hex key', () => {
      const key = service.generateKey('user', 'action', {});
      expect(key).toHaveLength(64);
      expect(key).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('idempotent operations', () => {
    it('should prevent duplicate creation', async () => {
      const idempotencyKey = service.generateKey('user-1', 'create-project', { name: 'Test' });

      // First request
      const first = await service.check(idempotencyKey);
      expect(first.exists).toBe(false);

      // Simulate creation
      const result = { projectId: 'proj-123', name: 'Test' };
      await service.store(idempotencyKey, result);

      // Second request (should return cached)
      const second = await service.check(idempotencyKey);
      expect(second.exists).toBe(true);
      expect(second.result.projectId).toBe('proj-123');
    });

    it('should allow retry after TTL', async () => {
      const shortTtlService = new IdempotencyService(50);
      const key = shortTtlService.generateKey('user', 'action', {});

      await shortTtlService.store(key, { attempt: 1 });
      await new Promise(r => setTimeout(r, 100));

      const check = await shortTtlService.check(key);
      expect(check.exists).toBe(false);

      // Can retry
      await shortTtlService.store(key, { attempt: 2 });
      const recheck = await shortTtlService.check(key);
      expect(recheck.result.attempt).toBe(2);
    });

    it('should handle concurrent requests', async () => {
      const key = service.generateKey('user-1', 'action', {});

      // First request starts
      const check1 = await service.check(key);
      expect(check1.exists).toBe(false);

      // Store result
      await service.store(key, { id: 1 });

      // Second request checks
      const check2 = await service.check(key);
      expect(check2.exists).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should store error responses', async () => {
      const key = service.generateKey('user', 'action', {});

      await service.store(key, { error: 'Validation failed', code: 400 });

      const check = await service.check(key);
      expect(check.exists).toBe(true);
      expect(check.result.error).toBe('Validation failed');
    });

    it('should distinguish error types', async () => {
      const retriableKey = service.generateKey('user', 'action', { retry: true });
      const permanentKey = service.generateKey('user', 'action', { permanent: true });

      await service.store(retriableKey, { error: 'Temporary', retriable: true });
      await service.store(permanentKey, { error: 'Permanent', retriable: false });

      const retriable = await service.check(retriableKey);
      const permanent = await service.check(permanentKey);

      expect(retriable.result.retriable).toBe(true);
      expect(permanent.result.retriable).toBe(false);
    });
  });

  describe('performance', () => {
    it('should handle many entries', async () => {
      const start = Date.now();

      for (let i = 0; i < 1000; i++) {
        await service.store(`key-${i}`, { value: i });
      }

      for (let i = 0; i < 1000; i++) {
        await service.check(`key-${i}`);
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });

    it('should have O(1) lookup', async () => {
      for (let i = 0; i < 10000; i++) {
        await service.store(`key-${i}`, { value: i });
      }

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        await service.check(`key-${i}`);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(100);
    });
  });
});
