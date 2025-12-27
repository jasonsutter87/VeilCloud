/**
 * Nullifier Tests for One-Time Credential Tracking
 */

import { createHash, randomBytes } from 'crypto';

class NullifierRegistry {
  private nullifiers: Set<string> = new Set();
  private expirations: Map<string, number> = new Map();

  generate(credentialId: string, secret: string): string {
    return createHash('sha256')
      .update(credentialId + secret)
      .digest('hex');
  }

  async register(nullifier: string, expiresAt?: number): Promise<boolean> {
    if (this.nullifiers.has(nullifier)) {
      return false; // Already used
    }

    this.nullifiers.add(nullifier);
    if (expiresAt) {
      this.expirations.set(nullifier, expiresAt);
    }
    return true;
  }

  async isUsed(nullifier: string): Promise<boolean> {
    return this.nullifiers.has(nullifier);
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let removed = 0;

    for (const [nullifier, expiresAt] of this.expirations.entries()) {
      if (now > expiresAt) {
        this.nullifiers.delete(nullifier);
        this.expirations.delete(nullifier);
        removed++;
      }
    }

    return removed;
  }

  getSize(): number {
    return this.nullifiers.size;
  }
}

describe('NullifierRegistry', () => {
  let registry: NullifierRegistry;

  beforeEach(() => {
    registry = new NullifierRegistry();
  });

  describe('generate', () => {
    it('should generate deterministic nullifier', () => {
      const n1 = registry.generate('cred-1', 'secret');
      const n2 = registry.generate('cred-1', 'secret');
      expect(n1).toBe(n2);
    });

    it('should generate different nullifier for different credentials', () => {
      const n1 = registry.generate('cred-1', 'secret');
      const n2 = registry.generate('cred-2', 'secret');
      expect(n1).not.toBe(n2);
    });

    it('should generate different nullifier for different secrets', () => {
      const n1 = registry.generate('cred-1', 'secret1');
      const n2 = registry.generate('cred-1', 'secret2');
      expect(n1).not.toBe(n2);
    });

    it('should generate 64-char hex string', () => {
      const nullifier = registry.generate('cred', 'secret');
      expect(nullifier).toHaveLength(64);
      expect(nullifier).toMatch(/^[0-9a-f]+$/);
    });
  });

  describe('register', () => {
    it('should register new nullifier', async () => {
      const result = await registry.register('null-1');
      expect(result).toBe(true);
    });

    it('should reject duplicate nullifier', async () => {
      await registry.register('null-1');
      const result = await registry.register('null-1');
      expect(result).toBe(false);
    });

    it('should track size', async () => {
      await registry.register('null-1');
      await registry.register('null-2');
      expect(registry.getSize()).toBe(2);
    });
  });

  describe('isUsed', () => {
    it('should return true for registered nullifier', async () => {
      await registry.register('null-1');
      expect(await registry.isUsed('null-1')).toBe(true);
    });

    it('should return false for unregistered nullifier', async () => {
      expect(await registry.isUsed('null-1')).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should remove expired nullifiers', async () => {
      await registry.register('null-1', Date.now() - 1000);
      const removed = await registry.cleanup();
      expect(removed).toBe(1);
      expect(await registry.isUsed('null-1')).toBe(false);
    });

    it('should keep non-expired nullifiers', async () => {
      await registry.register('null-1', Date.now() + 10000);
      await registry.cleanup();
      expect(await registry.isUsed('null-1')).toBe(true);
    });
  });

  describe('one-time credential flow', () => {
    it('should prevent reuse', async () => {
      const nullifier = registry.generate('cred-1', 'secret');

      // First use
      expect(await registry.register(nullifier)).toBe(true);

      // Attempted reuse
      expect(await registry.register(nullifier)).toBe(false);
    });
  });
});
