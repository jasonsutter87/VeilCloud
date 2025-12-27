/**
 * VeilCloud Edge Module
 *
 * Enables edge node deployment for offline-capable vote collection.
 * Designed for Raspberry Pi and other edge devices.
 */

// Configuration
export {
  getEdgeConfig,
  getCentralConfig,
  getVeilCloudMode,
  isEdgeMode,
  isCentralMode,
  validateEdgeConfig,
  type EdgeConfig,
  type CentralConfig,
  type VeilCloudMode,
} from './config.js';

// Queue
export {
  EdgeQueueService,
  getEdgeQueueService,
  resetEdgeQueueService,
  type QueuedVote,
  type QueueStats,
  type QueueBatch,
} from './queue.js';

// Sync
export {
  EdgeSyncWorker,
  getEdgeSyncWorker,
  resetEdgeSyncWorker,
  type SyncStatus,
  type SyncResult,
  type SyncEventType,
} from './sync.js';

// Bloom Filter
export {
  BloomFilter,
  EdgeBloomService,
  getEdgeBloomService,
  resetEdgeBloomService,
} from './bloom.js';

// Routes
export { registerEdgeRoutes } from './routes.js';
