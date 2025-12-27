/**
 * Edge Bloom Filter Service
 *
 * In-memory Bloom filter for fast duplicate detection on edge nodes.
 * Provides O(1) lookup for nullifiers without needing Redis.
 *
 * Note: This is a pure JavaScript implementation for edge deployment.
 * For central servers with Redis, use the Redis Bloom module instead.
 */

import { createHash } from 'crypto';

import { getEdgeConfig, type EdgeConfig } from './config.js';

// ============================================================================
// Bloom Filter Implementation
// ============================================================================

/**
 * Simple Bloom filter implementation
 * Optimized for edge nodes without external dependencies
 */
export class BloomFilter {
  private bits: Uint8Array;
  private hashCount: number;
  private size: number;
  private count: number = 0;

  constructor(capacity: number, errorRate: number = 0.0001) {
    // Calculate optimal size and hash count
    // m = -n * ln(p) / (ln(2)^2)
    // k = (m/n) * ln(2)
    const m = Math.ceil(-capacity * Math.log(errorRate) / (Math.LN2 * Math.LN2));
    const k = Math.ceil((m / capacity) * Math.LN2);

    this.size = m;
    this.hashCount = k;
    this.bits = new Uint8Array(Math.ceil(m / 8));
  }

  /**
   * Add an item to the filter
   */
  add(item: string): void {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.size;
      const byteIndex = Math.floor(index / 8);
      const bitIndex = index % 8;
      this.bits[byteIndex] |= (1 << bitIndex);
    }
    this.count++;
  }

  /**
   * Check if an item might exist
   * false = definitely not in set
   * true = possibly in set (may be false positive)
   */
  mightExist(item: string): boolean {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const index = hash % this.size;
      const byteIndex = Math.floor(index / 8);
      const bitIndex = index % 8;
      if ((this.bits[byteIndex] & (1 << bitIndex)) === 0) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get approximate count of items
   */
  getCount(): number {
    return this.count;
  }

  /**
   * Get size in bytes
   */
  getSizeBytes(): number {
    return this.bits.length;
  }

  /**
   * Get fill ratio (approximate)
   */
  getFillRatio(): number {
    let setBits = 0;
    for (let i = 0; i < this.bits.length; i++) {
      setBits += this.popCount(this.bits[i]);
    }
    return setBits / this.size;
  }

  /**
   * Export filter state
   */
  export(): { bits: Buffer; hashCount: number; size: number; count: number } {
    return {
      bits: Buffer.from(this.bits),
      hashCount: this.hashCount,
      size: this.size,
      count: this.count,
    };
  }

  /**
   * Import filter state
   */
  static import(data: { bits: Buffer; hashCount: number; size: number; count: number }): BloomFilter {
    const filter = Object.create(BloomFilter.prototype) as BloomFilter;
    filter.bits = new Uint8Array(data.bits);
    filter.hashCount = data.hashCount;
    filter.size = data.size;
    filter.count = data.count;
    return filter;
  }

  /**
   * Clear the filter
   */
  clear(): void {
    this.bits.fill(0);
    this.count = 0;
  }

  /**
   * Generate hash values for an item
   * Uses double hashing technique: h(i) = h1 + i*h2
   */
  private getHashes(item: string): number[] {
    const hash = createHash('sha256').update(item).digest();

    // Extract two 32-bit hashes from SHA-256
    const h1 = hash.readUInt32BE(0);
    const h2 = hash.readUInt32BE(4);

    const hashes: number[] = [];
    for (let i = 0; i < this.hashCount; i++) {
      hashes.push((h1 + i * h2) >>> 0); // >>> 0 ensures unsigned
    }

    return hashes;
  }

  /**
   * Count set bits in a byte
   */
  private popCount(byte: number): number {
    let count = 0;
    while (byte) {
      count += byte & 1;
      byte >>>= 1;
    }
    return count;
  }
}

// ============================================================================
// Edge Bloom Service
// ============================================================================

/**
 * Bloom filter service for edge nodes
 * Maintains per-election filters for nullifier deduplication
 */
export class EdgeBloomService {
  private filters: Map<string, BloomFilter> = new Map();
  private config: EdgeConfig;

  constructor(config?: EdgeConfig) {
    this.config = config || getEdgeConfig();
  }

  /**
   * Get or create filter for an election
   */
  private getFilter(electionId: string): BloomFilter {
    let filter = this.filters.get(electionId);
    if (!filter) {
      filter = new BloomFilter(
        this.config.bloom.capacity,
        this.config.bloom.errorRate
      );
      this.filters.set(electionId, filter);
    }
    return filter;
  }

  /**
   * Check if a nullifier might exist for an election
   */
  mightExist(electionId: string, nullifier: string): boolean {
    const filter = this.filters.get(electionId);
    if (!filter) return false;
    return filter.mightExist(nullifier);
  }

  /**
   * Add a nullifier for an election
   */
  add(electionId: string, nullifier: string): void {
    const filter = this.getFilter(electionId);
    filter.add(nullifier);
  }

  /**
   * Get statistics for all filters
   */
  getStats(): {
    elections: number;
    totalItems: number;
    totalSizeBytes: number;
    filters: Array<{
      electionId: string;
      count: number;
      sizeBytes: number;
      fillRatio: number;
    }>;
  } {
    const filters: Array<{
      electionId: string;
      count: number;
      sizeBytes: number;
      fillRatio: number;
    }> = [];

    let totalItems = 0;
    let totalSizeBytes = 0;

    for (const [electionId, filter] of this.filters) {
      const count = filter.getCount();
      const sizeBytes = filter.getSizeBytes();
      const fillRatio = filter.getFillRatio();

      filters.push({ electionId, count, sizeBytes, fillRatio });
      totalItems += count;
      totalSizeBytes += sizeBytes;
    }

    return {
      elections: this.filters.size,
      totalItems,
      totalSizeBytes,
      filters,
    };
  }

  /**
   * Clear filter for an election
   */
  clearElection(electionId: string): void {
    this.filters.delete(electionId);
  }

  /**
   * Clear all filters
   */
  clearAll(): void {
    this.filters.clear();
  }
}

// ============================================================================
// Singleton
// ============================================================================

let bloomService: EdgeBloomService | null = null;

export function getEdgeBloomService(): EdgeBloomService {
  if (!bloomService) {
    bloomService = new EdgeBloomService();
  }
  return bloomService;
}

export function resetEdgeBloomService(): void {
  bloomService = null;
}
