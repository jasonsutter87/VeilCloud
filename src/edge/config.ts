/**
 * Edge Node Configuration
 *
 * Configuration for VeilCloud Edge mode (Raspberry Pi deployment).
 * Enables offline-capable vote collection with sync to central server.
 */

export type VeilCloudMode = 'standalone' | 'edge' | 'central';

export interface EdgeConfig {
  mode: VeilCloudMode;
  nodeId: string;

  // Central server connection (when mode=edge)
  central: {
    url: string;
    apiKey: string;
    healthCheckIntervalMs: number;
    connectionTimeoutMs: number;
  };

  // SQLite queue settings
  queue: {
    path: string;
    maxSize: number; // Max votes queued
    batchSize: number; // Votes per sync batch
    retryIntervalMs: number;
    maxRetries: number;
    compactIntervalMs: number;
  };

  // Local Bloom filter for duplicate detection
  bloom: {
    capacity: number;
    errorRate: number;
  };

  // Sync settings
  sync: {
    enabled: boolean;
    intervalMs: number;
    maxBatchSize: number;
    compressionEnabled: boolean;
  };
}

export interface CentralConfig {
  mode: VeilCloudMode;

  // Edge node management
  edges: {
    maxNodes: number;
    authRequired: boolean;
    registrationEnabled: boolean;
  };

  // Ingest settings
  ingest: {
    maxBatchSize: number;
    deduplicationWindowMs: number;
    rateLimitPerEdge: number;
  };
}

/**
 * Get the current VeilCloud mode
 */
export function getVeilCloudMode(): VeilCloudMode {
  const mode = process.env.VEILCLOUD_MODE?.toLowerCase();
  if (mode === 'edge') return 'edge';
  if (mode === 'central') return 'central';
  return 'standalone';
}

/**
 * Check if running in edge mode
 */
export function isEdgeMode(): boolean {
  return getVeilCloudMode() === 'edge';
}

/**
 * Check if running in central mode
 */
export function isCentralMode(): boolean {
  return getVeilCloudMode() === 'central';
}

/**
 * Get edge configuration from environment
 */
export function getEdgeConfig(): EdgeConfig {
  const mode = getVeilCloudMode();

  return {
    mode,
    nodeId: process.env.EDGE_NODE_ID || generateNodeId(),

    central: {
      url: process.env.CENTRAL_URL || 'http://localhost:3000',
      apiKey: process.env.CENTRAL_API_KEY || '',
      healthCheckIntervalMs: parseInt(process.env.EDGE_HEALTH_CHECK_INTERVAL || '30000', 10),
      connectionTimeoutMs: parseInt(process.env.EDGE_CONNECTION_TIMEOUT || '5000', 10),
    },

    queue: {
      path: process.env.EDGE_QUEUE_PATH || './data/edge-queue.db',
      maxSize: parseInt(process.env.EDGE_QUEUE_MAX_SIZE || '1000000', 10),
      batchSize: parseInt(process.env.EDGE_BATCH_SIZE || '100', 10),
      retryIntervalMs: parseInt(process.env.EDGE_RETRY_INTERVAL || '5000', 10),
      maxRetries: parseInt(process.env.EDGE_MAX_RETRIES || '100', 10),
      compactIntervalMs: parseInt(process.env.EDGE_COMPACT_INTERVAL || '3600000', 10),
    },

    bloom: {
      capacity: parseInt(process.env.EDGE_BLOOM_CAPACITY || '1000000', 10),
      errorRate: parseFloat(process.env.EDGE_BLOOM_ERROR_RATE || '0.0001'),
    },

    sync: {
      enabled: process.env.EDGE_SYNC_ENABLED !== 'false',
      intervalMs: parseInt(process.env.EDGE_SYNC_INTERVAL || '1000', 10),
      maxBatchSize: parseInt(process.env.EDGE_SYNC_BATCH_SIZE || '100', 10),
      compressionEnabled: process.env.EDGE_SYNC_COMPRESSION !== 'false',
    },
  };
}

/**
 * Get central configuration from environment
 */
export function getCentralConfig(): CentralConfig {
  const mode = getVeilCloudMode();

  return {
    mode,

    edges: {
      maxNodes: parseInt(process.env.CENTRAL_MAX_EDGES || '1000', 10),
      authRequired: process.env.CENTRAL_EDGE_AUTH_REQUIRED !== 'false',
      registrationEnabled: process.env.CENTRAL_EDGE_REGISTRATION === 'true',
    },

    ingest: {
      maxBatchSize: parseInt(process.env.CENTRAL_INGEST_BATCH_SIZE || '1000', 10),
      deduplicationWindowMs: parseInt(process.env.CENTRAL_DEDUP_WINDOW || '3600000', 10),
      rateLimitPerEdge: parseInt(process.env.CENTRAL_EDGE_RATE_LIMIT || '10000', 10),
    },
  };
}

/**
 * Generate a unique node ID based on hostname and random suffix
 */
function generateNodeId(): string {
  const hostname = process.env.HOSTNAME || 'edge';
  const random = Math.random().toString(36).substring(2, 8);
  return `${hostname}-${random}`;
}

/**
 * Validate edge configuration
 */
export function validateEdgeConfig(config: EdgeConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (config.mode === 'edge') {
    if (!config.central.url) {
      errors.push('CENTRAL_URL is required in edge mode');
    }
    if (!config.central.apiKey) {
      errors.push('CENTRAL_API_KEY is required in edge mode');
    }
  }

  if (config.queue.maxSize < 1000) {
    errors.push('EDGE_QUEUE_MAX_SIZE must be at least 1000');
  }

  if (config.bloom.capacity < 10000) {
    errors.push('EDGE_BLOOM_CAPACITY must be at least 10000');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
