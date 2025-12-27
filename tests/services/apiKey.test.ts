/**
 * API Key Service Tests
 */

import { createHash, randomBytes } from 'crypto';

// Mock API key type
interface ApiKey {
  id: string;
  key: string;
  hashedKey: string;
  name: string;
  userId: string;
  permissions: string[];
  createdAt: Date;
  lastUsedAt?: Date;
  expiresAt?: Date;
  revoked: boolean;
}

// Mock API key service
class ApiKeyService {
  private keys: Map<string, ApiKey> = new Map();

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  async create(params: {
    name: string;
    userId: string;
    permissions: string[];
    expiresIn?: number;
  }): Promise<{ key: string; apiKey: ApiKey }> {
    const key = `vk_${randomBytes(32).toString('hex')}`;
    const hashedKey = this.hashKey(key);
    const id = randomBytes(8).toString('hex');

    const apiKey: ApiKey = {
      id,
      key: key.slice(0, 8) + '...', // Only show prefix
      hashedKey,
      name: params.name,
      userId: params.userId,
      permissions: params.permissions,
      createdAt: new Date(),
      expiresAt: params.expiresIn ? new Date(Date.now() + params.expiresIn) : undefined,
      revoked: false,
    };

    this.keys.set(hashedKey, apiKey);
    return { key, apiKey };
  }

  async verify(key: string): Promise<{ valid: boolean; apiKey?: ApiKey; reason?: string }> {
    const hashedKey = this.hashKey(key);
    const apiKey = this.keys.get(hashedKey);

    if (!apiKey) {
      return { valid: false, reason: 'API key not found' };
    }

    if (apiKey.revoked) {
      return { valid: false, reason: 'API key has been revoked' };
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return { valid: false, reason: 'API key has expired' };
    }

    // Update last used
    apiKey.lastUsedAt = new Date();

    return { valid: true, apiKey };
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    for (const apiKey of this.keys.values()) {
      if (apiKey.id === id && apiKey.userId === userId) {
        apiKey.revoked = true;
        return true;
      }
    }
    return false;
  }

  async list(userId: string): Promise<ApiKey[]> {
    const result: ApiKey[] = [];
    for (const apiKey of this.keys.values()) {
      if (apiKey.userId === userId && !apiKey.revoked) {
        result.push(apiKey);
      }
    }
    return result;
  }

  async get(id: string, userId: string): Promise<ApiKey | null> {
    for (const apiKey of this.keys.values()) {
      if (apiKey.id === id && apiKey.userId === userId) {
        return apiKey;
      }
    }
    return null;
  }

  async rotate(id: string, userId: string): Promise<{ key: string; apiKey: ApiKey } | null> {
    const existing = await this.get(id, userId);
    if (!existing) return null;

    // Revoke old key
    await this.revoke(id, userId);

    // Create new key with same config
    return this.create({
      name: existing.name,
      userId: existing.userId,
      permissions: existing.permissions,
      expiresIn: existing.expiresAt ? existing.expiresAt.getTime() - Date.now() : undefined,
    });
  }

  async hasPermission(key: string, permission: string): Promise<boolean> {
    const result = await this.verify(key);
    if (!result.valid || !result.apiKey) return false;
    return result.apiKey.permissions.includes(permission);
  }
}

describe('ApiKeyService', () => {
  let service: ApiKeyService;

  beforeEach(() => {
    service = new ApiKeyService();
  });

  describe('create', () => {
    it('should create API key', async () => {
      const result = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(result.key).toBeDefined();
      expect(result.apiKey.id).toBeDefined();
    });

    it('should return full key only once', async () => {
      const result = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(result.key).toMatch(/^vk_[0-9a-f]{64}$/);
      expect(result.apiKey.key).toContain('...');
    });

    it('should hash key for storage', async () => {
      const result = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(result.apiKey.hashedKey).toHaveLength(64);
      expect(result.apiKey.hashedKey).not.toBe(result.key);
    });

    it('should store permissions', async () => {
      const result = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read', 'write', 'delete'],
      });

      expect(result.apiKey.permissions).toContain('read');
      expect(result.apiKey.permissions).toContain('write');
      expect(result.apiKey.permissions).toContain('delete');
    });

    it('should set creation timestamp', async () => {
      const before = new Date();
      const result = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });
      const after = new Date();

      expect(result.apiKey.createdAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(result.apiKey.createdAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should set expiration when specified', async () => {
      const expiresIn = 3600000; // 1 hour
      const result = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
        expiresIn,
      });

      expect(result.apiKey.expiresAt).toBeDefined();
      expect(result.apiKey.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should not set expiration when not specified', async () => {
      const result = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(result.apiKey.expiresAt).toBeUndefined();
    });

    it('should create unique keys', async () => {
      const result1 = await service.create({
        name: 'Key 1',
        userId: 'user-1',
        permissions: ['read'],
      });
      const result2 = await service.create({
        name: 'Key 2',
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(result1.key).not.toBe(result2.key);
      expect(result1.apiKey.id).not.toBe(result2.apiKey.id);
    });
  });

  describe('verify', () => {
    it('should verify valid key', async () => {
      const { key } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      const result = await service.verify(key);

      expect(result.valid).toBe(true);
      expect(result.apiKey).toBeDefined();
    });

    it('should reject invalid key', async () => {
      const result = await service.verify('vk_invalid');

      expect(result.valid).toBe(false);
      expect(result.reason).toBe('API key not found');
    });

    it('should reject revoked key', async () => {
      const { key, apiKey } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      await service.revoke(apiKey.id, 'user-1');

      const result = await service.verify(key);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('revoked');
    });

    it('should reject expired key', async () => {
      const { key } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
        expiresIn: -1000, // Already expired
      });

      const result = await service.verify(key);

      expect(result.valid).toBe(false);
      expect(result.reason).toContain('expired');
    });

    it('should update lastUsedAt', async () => {
      const { key, apiKey } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(apiKey.lastUsedAt).toBeUndefined();

      await service.verify(key);

      const updated = await service.get(apiKey.id, 'user-1');
      expect(updated?.lastUsedAt).toBeDefined();
    });

    it('should return API key info on success', async () => {
      const { key } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read', 'write'],
      });

      const result = await service.verify(key);

      expect(result.apiKey?.name).toBe('My Key');
      expect(result.apiKey?.permissions).toContain('read');
    });
  });

  describe('revoke', () => {
    it('should revoke API key', async () => {
      const { key, apiKey } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      const result = await service.revoke(apiKey.id, 'user-1');

      expect(result).toBe(true);

      const verify = await service.verify(key);
      expect(verify.valid).toBe(false);
    });

    it('should return false for non-existent key', async () => {
      const result = await service.revoke('nonexistent', 'user-1');

      expect(result).toBe(false);
    });

    it('should require correct user', async () => {
      const { apiKey } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      const result = await service.revoke(apiKey.id, 'user-2');

      expect(result).toBe(false);
    });

    it('should not affect other keys', async () => {
      const { key: key1, apiKey: apiKey1 } = await service.create({
        name: 'Key 1',
        userId: 'user-1',
        permissions: ['read'],
      });
      const { key: key2 } = await service.create({
        name: 'Key 2',
        userId: 'user-1',
        permissions: ['read'],
      });

      await service.revoke(apiKey1.id, 'user-1');

      const verify2 = await service.verify(key2);
      expect(verify2.valid).toBe(true);
    });
  });

  describe('list', () => {
    it('should list user keys', async () => {
      await service.create({
        name: 'Key 1',
        userId: 'user-1',
        permissions: ['read'],
      });
      await service.create({
        name: 'Key 2',
        userId: 'user-1',
        permissions: ['write'],
      });

      const keys = await service.list('user-1');

      expect(keys).toHaveLength(2);
    });

    it('should only list own keys', async () => {
      await service.create({
        name: 'User 1 Key',
        userId: 'user-1',
        permissions: ['read'],
      });
      await service.create({
        name: 'User 2 Key',
        userId: 'user-2',
        permissions: ['read'],
      });

      const keys = await service.list('user-1');

      expect(keys).toHaveLength(1);
      expect(keys[0]!.name).toBe('User 1 Key');
    });

    it('should exclude revoked keys', async () => {
      const { apiKey } = await service.create({
        name: 'Key 1',
        userId: 'user-1',
        permissions: ['read'],
      });
      await service.create({
        name: 'Key 2',
        userId: 'user-1',
        permissions: ['read'],
      });

      await service.revoke(apiKey.id, 'user-1');

      const keys = await service.list('user-1');

      expect(keys).toHaveLength(1);
      expect(keys[0]!.name).toBe('Key 2');
    });

    it('should return empty array for new user', async () => {
      const keys = await service.list('new-user');

      expect(keys).toEqual([]);
    });
  });

  describe('get', () => {
    it('should get key by ID', async () => {
      const { apiKey } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      const result = await service.get(apiKey.id, 'user-1');

      expect(result?.name).toBe('My Key');
    });

    it('should return null for non-existent key', async () => {
      const result = await service.get('nonexistent', 'user-1');

      expect(result).toBeNull();
    });

    it('should require correct user', async () => {
      const { apiKey } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      const result = await service.get(apiKey.id, 'user-2');

      expect(result).toBeNull();
    });
  });

  describe('rotate', () => {
    it('should rotate key', async () => {
      const { key: oldKey, apiKey } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read', 'write'],
      });

      const result = await service.rotate(apiKey.id, 'user-1');

      expect(result).not.toBeNull();
      expect(result!.key).not.toBe(oldKey);
    });

    it('should revoke old key', async () => {
      const { key: oldKey, apiKey } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      await service.rotate(apiKey.id, 'user-1');

      const verify = await service.verify(oldKey);
      expect(verify.valid).toBe(false);
    });

    it('should preserve permissions', async () => {
      const { apiKey } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read', 'write', 'admin'],
      });

      const result = await service.rotate(apiKey.id, 'user-1');

      expect(result?.apiKey.permissions).toContain('read');
      expect(result?.apiKey.permissions).toContain('write');
      expect(result?.apiKey.permissions).toContain('admin');
    });

    it('should preserve name', async () => {
      const { apiKey } = await service.create({
        name: 'My Special Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      const result = await service.rotate(apiKey.id, 'user-1');

      expect(result?.apiKey.name).toBe('My Special Key');
    });

    it('should return null for non-existent key', async () => {
      const result = await service.rotate('nonexistent', 'user-1');

      expect(result).toBeNull();
    });
  });

  describe('hasPermission', () => {
    it('should return true for granted permission', async () => {
      const { key } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read', 'write'],
      });

      expect(await service.hasPermission(key, 'read')).toBe(true);
      expect(await service.hasPermission(key, 'write')).toBe(true);
    });

    it('should return false for non-granted permission', async () => {
      const { key } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(await service.hasPermission(key, 'write')).toBe(false);
    });

    it('should return false for invalid key', async () => {
      expect(await service.hasPermission('invalid', 'read')).toBe(false);
    });

    it('should return false for revoked key', async () => {
      const { key, apiKey } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      await service.revoke(apiKey.id, 'user-1');

      expect(await service.hasPermission(key, 'read')).toBe(false);
    });
  });

  describe('key format', () => {
    it('should use vk_ prefix', async () => {
      const { key } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(key.startsWith('vk_')).toBe(true);
    });

    it('should have sufficient entropy', async () => {
      const { key } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      // vk_ prefix + 64 hex chars = 67 total
      expect(key.length).toBe(67);
    });

    it('should be lowercase hex', async () => {
      const { key } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      expect(key.slice(3)).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('performance', () => {
    it('should create keys quickly', async () => {
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        await service.create({
          name: `Key ${i}`,
          userId: 'user-1',
          permissions: ['read'],
        });
      }

      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(1000);
    });

    it('should verify keys quickly', async () => {
      const keys: string[] = [];
      for (let i = 0; i < 100; i++) {
        const { key } = await service.create({
          name: `Key ${i}`,
          userId: 'user-1',
          permissions: ['read'],
        });
        keys.push(key);
      }

      const start = Date.now();
      for (const key of keys) {
        await service.verify(key);
      }
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(500);
    });
  });

  describe('concurrent operations', () => {
    it('should handle concurrent creates', async () => {
      const promises = Array.from({ length: 10 }, (_, i) =>
        service.create({
          name: `Key ${i}`,
          userId: 'user-1',
          permissions: ['read'],
        })
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      const ids = new Set(results.map(r => r.apiKey.id));
      expect(ids.size).toBe(10);
    });

    it('should handle concurrent verifies', async () => {
      const { key } = await service.create({
        name: 'My Key',
        userId: 'user-1',
        permissions: ['read'],
      });

      const promises = Array.from({ length: 20 }, () => service.verify(key));
      const results = await Promise.all(promises);

      expect(results.every(r => r.valid)).toBe(true);
    });
  });
});
