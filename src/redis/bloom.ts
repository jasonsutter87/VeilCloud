/**
 * Redis Bloom Filter Service
 *
 * Provides O(1) nullifier lookup using RedisBloom module.
 * Critical for preventing double voting at 100K+ votes/sec.
 *
 * Flow:
 * 1. Check bloom filter (O(1))
 * 2. If NOT in filter → definitely new, accept
 * 3. If IN filter → might be false positive, check DB
 */

import Redis from 'ioredis';
import { getRedisConfig, RedisKeys, VeilCloudRedisConfig } from './config.js';

export class BloomFilterService {
  private redis: Redis;
  private config: VeilCloudRedisConfig;

  constructor(redis?: Redis, config?: VeilCloudRedisConfig) {
    this.config = config || getRedisConfig();
    this.redis = redis || new Redis(this.config.connection);
  }

  /**
   * Initialize bloom filter for an election
   * Should be called when election is created
   */
  async initializeFilter(electionId: string, expectedVotes?: number): Promise<void> {
    const key = RedisKeys.nullifierBloom(electionId);
    const capacity = expectedVotes || this.config.bloomFilter.capacity;
    const errorRate = this.config.bloomFilter.errorRate;

    try {
      // BF.RESERVE key errorRate capacity [EXPANSION expansion] [NONSCALING]
      await this.redis.call(
        'BF.RESERVE',
        key,
        errorRate.toString(),
        capacity.toString(),
        'EXPANSION',
        this.config.bloomFilter.expansion.toString()
      );
      console.log(`[Bloom] Initialized filter for election ${electionId} (capacity: ${capacity})`);
    } catch (error: unknown) {
      // Filter might already exist
      if ((error as Error).message?.includes('item exists')) {
        console.log(`[Bloom] Filter already exists for election ${electionId}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Check if nullifier might exist (false positives possible)
   *
   * @returns true if nullifier MIGHT exist (check DB to confirm)
   * @returns false if nullifier definitely does NOT exist (safe to accept)
   */
  async mightExist(electionId: string, nullifier: string): Promise<boolean> {
    const key = RedisKeys.nullifierBloom(electionId);

    try {
      // BF.EXISTS key item
      const result = await this.redis.call('BF.EXISTS', key, nullifier);
      return result === 1;
    } catch (error: unknown) {
      // If RedisBloom not available, fall back to conservative approach
      if ((error as Error).message?.includes('unknown command')) {
        console.warn('[Bloom] RedisBloom not available, falling back to DB check');
        return true; // Conservative: always check DB
      }
      throw error;
    }
  }

  /**
   * Add nullifier to bloom filter
   * Called after vote is successfully recorded in DB
   */
  async addNullifier(electionId: string, nullifier: string): Promise<boolean> {
    const key = RedisKeys.nullifierBloom(electionId);

    try {
      // BF.ADD key item
      const result = await this.redis.call('BF.ADD', key, nullifier);
      return result === 1; // 1 if newly added, 0 if already existed
    } catch (error: unknown) {
      if ((error as Error).message?.includes('unknown command')) {
        console.warn('[Bloom] RedisBloom not available');
        return false;
      }
      throw error;
    }
  }

  /**
   * Add multiple nullifiers in batch
   * Used for bulk import or migration
   */
  async addNullifierBatch(
    electionId: string,
    nullifiers: string[]
  ): Promise<number> {
    if (nullifiers.length === 0) return 0;

    const key = RedisKeys.nullifierBloom(electionId);

    try {
      // BF.MADD key item [item ...]
      const results = await this.redis.call(
        'BF.MADD',
        key,
        ...nullifiers
      ) as number[];
      return results.filter((r) => r === 1).length;
    } catch (error: unknown) {
      if ((error as Error).message?.includes('unknown command')) {
        console.warn('[Bloom] RedisBloom not available for batch add');
        return 0;
      }
      throw error;
    }
  }

  /**
   * Check multiple nullifiers in batch
   */
  async mightExistBatch(
    electionId: string,
    nullifiers: string[]
  ): Promise<boolean[]> {
    if (nullifiers.length === 0) return [];

    const key = RedisKeys.nullifierBloom(electionId);

    try {
      // BF.MEXISTS key item [item ...]
      const results = await this.redis.call(
        'BF.MEXISTS',
        key,
        ...nullifiers
      ) as number[];
      return results.map((r) => r === 1);
    } catch (error: unknown) {
      if ((error as Error).message?.includes('unknown command')) {
        console.warn('[Bloom] RedisBloom not available for batch check');
        return nullifiers.map(() => true); // Conservative
      }
      throw error;
    }
  }

  /**
   * Get bloom filter info/stats
   */
  async getFilterInfo(
    electionId: string
  ): Promise<{
    capacity: number;
    size: number;
    filterCount: number;
    insertedCount: number;
    expansionRate: number;
  } | null> {
    const key = RedisKeys.nullifierBloom(electionId);

    try {
      // BF.INFO key
      const info = await this.redis.call('BF.INFO', key) as (string | number)[];
      const result: Record<string, number> = {};

      for (let i = 0; i < info.length; i += 2) {
        const key = String(info[i]).toLowerCase().replace(' ', '_');
        result[key] = Number(info[i + 1]);
      }

      return {
        capacity: result['capacity'] || 0,
        size: result['size'] || 0,
        filterCount: result['number_of_filters'] || 1,
        insertedCount: result['number_of_items_inserted'] || 0,
        expansionRate: result['expansion_rate'] || 2,
      };
    } catch (error: unknown) {
      if ((error as Error).message?.includes('not exist')) {
        return null;
      }
      if ((error as Error).message?.includes('unknown command')) {
        console.warn('[Bloom] RedisBloom not available');
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete bloom filter (use carefully!)
   * Only for test cleanup or election archival
   */
  async deleteFilter(electionId: string): Promise<boolean> {
    const key = RedisKeys.nullifierBloom(electionId);
    const result = await this.redis.del(key);
    return result === 1;
  }

  /**
   * Check if RedisBloom module is available
   */
  async isBloomAvailable(): Promise<boolean> {
    try {
      await this.redis.call('BF.INFO', 'nonexistent');
      return true;
    } catch (error: unknown) {
      if ((error as Error).message?.includes('unknown command')) {
        return false;
      }
      // "not exist" error means command exists, key doesn't
      return true;
    }
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    bloomAvailable: boolean;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      await this.redis.ping();
      const bloomAvailable = await this.isBloomAvailable();
      return {
        healthy: true,
        bloomAvailable,
        latencyMs: Date.now() - start,
      };
    } catch {
      return {
        healthy: false,
        bloomAvailable: false,
        latencyMs: Date.now() - start,
      };
    }
  }

  /**
   * Close connection
   */
  async disconnect(): Promise<void> {
    await this.redis.quit();
  }
}

// Singleton instance
let bloomInstance: BloomFilterService | null = null;

export function getBloomFilter(): BloomFilterService {
  if (!bloomInstance) {
    bloomInstance = new BloomFilterService();
  }
  return bloomInstance;
}
