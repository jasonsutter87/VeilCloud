/**
 * Redis Configuration
 *
 * Configuration for Redis caching and Bloom filters.
 * Enables O(1) nullifier lookups for 350M+ votes.
 */

import { RedisOptions } from 'ioredis';

export interface VeilCloudRedisConfig {
  connection: RedisOptions;
  bloomFilter: {
    /** False positive rate (0.0001 = 0.01%) */
    errorRate: number;
    /** Expected capacity (400M for national election) */
    capacity: number;
    /** Expansion rate when capacity exceeded */
    expansion: number;
  };
  cache: {
    /** Credential cache TTL in seconds */
    credentialTTL: number;
    /** User cache TTL in seconds */
    userTTL: number;
    /** Permission cache TTL in seconds */
    permissionTTL: number;
    /** Election config cache TTL in seconds */
    electionTTL: number;
  };
  rateLimit: {
    /** Rate limit window in seconds */
    window: number;
    /** Max requests per window */
    maxRequests: number;
  };
}

/**
 * Get Redis configuration from environment
 */
export function getRedisConfig(): VeilCloudRedisConfig {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  const parsed = new URL(redisUrl);

  return {
    connection: {
      host: parsed.hostname,
      port: parseInt(parsed.port) || 6379,
      password: parsed.password || undefined,
      db: parseInt(parsed.pathname?.slice(1) || '0'),
      tls: parsed.protocol === 'rediss:' ? {} : undefined,
      retryStrategy: (times: number) => {
        if (times > 10) return null; // Stop retrying
        return Math.min(times * 100, 3000);
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: true,
      lazyConnect: true,
    },

    bloomFilter: {
      errorRate: parseFloat(process.env.BLOOM_ERROR_RATE || '0.0001'),
      capacity: parseInt(process.env.BLOOM_CAPACITY || '400000000'),
      expansion: parseInt(process.env.BLOOM_EXPANSION || '2'),
    },

    cache: {
      credentialTTL: parseInt(process.env.CACHE_CREDENTIAL_TTL || '300'),
      userTTL: parseInt(process.env.CACHE_USER_TTL || '60'),
      permissionTTL: parseInt(process.env.CACHE_PERMISSION_TTL || '30'),
      electionTTL: parseInt(process.env.CACHE_ELECTION_TTL || '3600'),
    },

    rateLimit: {
      window: parseInt(process.env.RATE_LIMIT_WINDOW || '60'),
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100'),
    },
  };
}

/**
 * Redis key prefixes
 */
export const RedisKeys = {
  // Bloom filters
  nullifierBloom: (electionId: string) => `bf:nullifier:${electionId}`,

  // Caches
  credential: (credentialId: string) => `cache:cred:${credentialId}`,
  user: (userId: string) => `cache:user:${userId}`,
  permission: (userId: string, projectId: string) =>
    `cache:perm:${userId}:${projectId}`,
  election: (electionId: string) => `cache:election:${electionId}`,

  // Rate limiting
  rateLimit: (key: string) => `rl:${key}`,

  // Locks
  lock: (resource: string) => `lock:${resource}`,

  // Sessions
  session: (sessionId: string) => `session:${sessionId}`,

  // Merkle tree state
  merkleRoot: (electionId: string) => `merkle:root:${electionId}`,
  merkleHeight: (electionId: string) => `merkle:height:${electionId}`,
} as const;
