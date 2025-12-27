/**
 * Kafka Module
 *
 * Provides async message queue infrastructure for high-throughput
 * vote ingestion (100K+ votes/sec target).
 */

export * from './config.js';
export * from './topics.js';
export * from './producer.js';
export * from './consumer.js';
