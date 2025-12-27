/**
 * Redis Module
 *
 * Provides caching and Bloom filter infrastructure for
 * high-throughput vote processing.
 *
 * Key features:
 * - Bloom filters for O(1) nullifier lookups (prevents double voting)
 * - Credential caching (reduces VeilSign calls)
 * - Rate limiting state
 * - Distributed locks for Merkle tree updates
 */

export * from './config.js';
export * from './bloom.js';
export * from './cache.js';
