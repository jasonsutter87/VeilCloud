/**
 * Redis Cache Service
 *
 * Provides caching for frequently accessed data to reduce
 * database and VeilSign/VeilKey service calls.
 */

import Redis from 'ioredis';
import { getRedisConfig, RedisKeys, VeilCloudRedisConfig } from './config.js';

export interface CachedCredential {
  userId: string;
  permissions: string[];
  expiresAt: number;
  verified: boolean;
}

export interface CachedUser {
  id: string;
  email: string;
  createdAt: string;
}

export interface CachedPermission {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  canShare: boolean;
}

export interface CachedElection {
  id: string;
  name: string;
  publicKey: string;
  threshold: number;
  trustees: number;
  status: string;
  startTime: number;
  endTime: number;
}

export class CacheService {
  private redis: Redis;
  private config: VeilCloudRedisConfig;

  constructor(redis?: Redis, config?: VeilCloudRedisConfig) {
    this.config = config || getRedisConfig();
    this.redis = redis || new Redis(this.config.connection);
  }

  // ==================== Credential Cache ====================

  async getCredential(credentialId: string): Promise<CachedCredential | null> {
    const key = RedisKeys.credential(credentialId);
    const data = await this.redis.get(key);
    if (!data) return null;

    const cached = JSON.parse(data) as CachedCredential;
    if (cached.expiresAt < Date.now()) {
      await this.redis.del(key);
      return null;
    }

    return cached;
  }

  async setCredential(
    credentialId: string,
    credential: CachedCredential
  ): Promise<void> {
    const key = RedisKeys.credential(credentialId);
    await this.redis.setex(
      key,
      this.config.cache.credentialTTL,
      JSON.stringify(credential)
    );
  }

  async invalidateCredential(credentialId: string): Promise<void> {
    const key = RedisKeys.credential(credentialId);
    await this.redis.del(key);
  }

  // ==================== User Cache ====================

  async getUser(userId: string): Promise<CachedUser | null> {
    const key = RedisKeys.user(userId);
    const data = await this.redis.get(key);
    return data ? (JSON.parse(data) as CachedUser) : null;
  }

  async setUser(userId: string, user: CachedUser): Promise<void> {
    const key = RedisKeys.user(userId);
    await this.redis.setex(
      key,
      this.config.cache.userTTL,
      JSON.stringify(user)
    );
  }

  async invalidateUser(userId: string): Promise<void> {
    const key = RedisKeys.user(userId);
    await this.redis.del(key);
  }

  // ==================== Permission Cache ====================

  async getPermission(
    userId: string,
    projectId: string
  ): Promise<CachedPermission | null> {
    const key = RedisKeys.permission(userId, projectId);
    const data = await this.redis.get(key);
    return data ? (JSON.parse(data) as CachedPermission) : null;
  }

  async setPermission(
    userId: string,
    projectId: string,
    permission: CachedPermission
  ): Promise<void> {
    const key = RedisKeys.permission(userId, projectId);
    await this.redis.setex(
      key,
      this.config.cache.permissionTTL,
      JSON.stringify(permission)
    );
  }

  async invalidatePermission(userId: string, projectId: string): Promise<void> {
    const key = RedisKeys.permission(userId, projectId);
    await this.redis.del(key);
  }

  async invalidateAllUserPermissions(userId: string): Promise<void> {
    const pattern = RedisKeys.permission(userId, '*');
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  // ==================== Election Cache ====================

  async getElection(electionId: string): Promise<CachedElection | null> {
    const key = RedisKeys.election(electionId);
    const data = await this.redis.get(key);
    return data ? (JSON.parse(data) as CachedElection) : null;
  }

  async setElection(electionId: string, election: CachedElection): Promise<void> {
    const key = RedisKeys.election(electionId);
    await this.redis.setex(
      key,
      this.config.cache.electionTTL,
      JSON.stringify(election)
    );
  }

  async invalidateElection(electionId: string): Promise<void> {
    const key = RedisKeys.election(electionId);
    await this.redis.del(key);
  }

  // ==================== Merkle State Cache ====================

  async getMerkleRoot(electionId: string): Promise<string | null> {
    const key = RedisKeys.merkleRoot(electionId);
    return this.redis.get(key);
  }

  async setMerkleRoot(electionId: string, root: string): Promise<void> {
    const key = RedisKeys.merkleRoot(electionId);
    await this.redis.set(key, root);
  }

  async getMerkleHeight(electionId: string): Promise<number | null> {
    const key = RedisKeys.merkleHeight(electionId);
    const data = await this.redis.get(key);
    return data ? parseInt(data) : null;
  }

  async setMerkleHeight(electionId: string, height: number): Promise<void> {
    const key = RedisKeys.merkleHeight(electionId);
    await this.redis.set(key, height.toString());
  }

  async incrementMerkleHeight(electionId: string): Promise<number> {
    const key = RedisKeys.merkleHeight(electionId);
    return this.redis.incr(key);
  }

  // ==================== Rate Limiting ====================

  async checkRateLimit(
    identifier: string,
    limit?: number,
    window?: number
  ): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    const key = RedisKeys.rateLimit(identifier);
    const maxRequests = limit || this.config.rateLimit.maxRequests;
    const windowSeconds = window || this.config.rateLimit.window;

    const multi = this.redis.multi();
    multi.incr(key);
    multi.ttl(key);
    const results = await multi.exec();

    if (!results) {
      return { allowed: true, remaining: maxRequests - 1, resetIn: windowSeconds };
    }

    const count = results[0][1] as number;
    let ttl = results[1][1] as number;

    // Set expiry on first request
    if (ttl === -1) {
      await this.redis.expire(key, windowSeconds);
      ttl = windowSeconds;
    }

    const allowed = count <= maxRequests;
    const remaining = Math.max(0, maxRequests - count);

    return { allowed, remaining, resetIn: ttl };
  }

  // ==================== Distributed Locks ====================

  async acquireLock(
    resource: string,
    ttlMs: number = 5000
  ): Promise<string | null> {
    const key = RedisKeys.lock(resource);
    const lockId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const result = await this.redis.set(key, lockId, 'PX', ttlMs, 'NX');
    return result === 'OK' ? lockId : null;
  }

  async releaseLock(resource: string, lockId: string): Promise<boolean> {
    const key = RedisKeys.lock(resource);
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    const result = await this.redis.eval(script, 1, key, lockId);
    return result === 1;
  }

  async extendLock(
    resource: string,
    lockId: string,
    ttlMs: number
  ): Promise<boolean> {
    const key = RedisKeys.lock(resource);
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("pexpire", KEYS[1], ARGV[2])
      else
        return 0
      end
    `;
    const result = await this.redis.eval(script, 1, key, lockId, ttlMs.toString());
    return result === 1;
  }

  // ==================== Health & Metrics ====================

  async healthCheck(): Promise<{
    healthy: boolean;
    latencyMs: number;
    memoryUsedMb: number;
  }> {
    const start = Date.now();
    try {
      await this.redis.ping();
      const info = await this.redis.info('memory');
      const memMatch = info.match(/used_memory:(\d+)/);
      const memoryUsedMb = memMatch
        ? parseInt(memMatch[1]) / 1024 / 1024
        : 0;

      return {
        healthy: true,
        latencyMs: Date.now() - start,
        memoryUsedMb,
      };
    } catch {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        memoryUsedMb: 0,
      };
    }
  }

  async getStats(): Promise<{
    connectedClients: number;
    usedMemoryMb: number;
    totalKeys: number;
    hitRate: number;
  }> {
    const info = await this.redis.info();
    const stats = {
      connectedClients: 0,
      usedMemoryMb: 0,
      totalKeys: 0,
      hitRate: 0,
    };

    const clientsMatch = info.match(/connected_clients:(\d+)/);
    if (clientsMatch) stats.connectedClients = parseInt(clientsMatch[1]);

    const memMatch = info.match(/used_memory:(\d+)/);
    if (memMatch) stats.usedMemoryMb = parseInt(memMatch[1]) / 1024 / 1024;

    const keysMatch = info.match(/db0:keys=(\d+)/);
    if (keysMatch) stats.totalKeys = parseInt(keysMatch[1]);

    const hitsMatch = info.match(/keyspace_hits:(\d+)/);
    const missesMatch = info.match(/keyspace_misses:(\d+)/);
    if (hitsMatch && missesMatch) {
      const hits = parseInt(hitsMatch[1]);
      const misses = parseInt(missesMatch[1]);
      stats.hitRate = hits / (hits + misses) || 0;
    }

    return stats;
  }

  /**
   * Close connection
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

// Singleton instance
let cacheInstance: CacheService | null = null;

export function getCache(): CacheService {
  if (!cacheInstance) {
    cacheInstance = new CacheService();
  }
  return cacheInstance;
}
