/**
 * Edge Sync Worker
 *
 * Background worker that syncs queued votes to the central server.
 * Handles retries, batching, compression, and connection monitoring.
 */

import { gzipSync, gunzipSync } from 'zlib';
import { EventEmitter } from 'events';

import { getEdgeConfig, type EdgeConfig } from './config.js';
import { getEdgeQueueService, type EdgeQueueService, type QueuedVote } from './queue.js';

// ============================================================================
// Types
// ============================================================================

export interface SyncStatus {
  connected: boolean;
  lastSyncAt: number | null;
  lastSuccessAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  syncCount: number;
  errorCount: number;
  pendingVotes: number;
}

export interface SyncResult {
  success: boolean;
  batchId: string;
  votesCount: number;
  duration: number;
  error?: string;
}

export type SyncEventType =
  | 'connected'
  | 'disconnected'
  | 'sync:start'
  | 'sync:success'
  | 'sync:error'
  | 'queue:empty'
  | 'queue:full';

// ============================================================================
// Edge Sync Worker
// ============================================================================

export class EdgeSyncWorker extends EventEmitter {
  private config: EdgeConfig;
  private queue: EdgeQueueService;
  private running = false;
  private syncTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;

  private status: SyncStatus = {
    connected: false,
    lastSyncAt: null,
    lastSuccessAt: null,
    lastErrorAt: null,
    lastError: null,
    syncCount: 0,
    errorCount: 0,
    pendingVotes: 0,
  };

  constructor(config?: EdgeConfig, queue?: EdgeQueueService) {
    super();
    this.config = config || getEdgeConfig();
    this.queue = queue || getEdgeQueueService();
  }

  /**
   * Start the sync worker
   */
  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    console.log(`[EdgeSync] Starting sync worker (node: ${this.config.nodeId})`);
    console.log(`[EdgeSync] Central URL: ${this.config.central.url}`);

    // Recover any votes stuck in 'processing' state from previous run
    const recovered = this.queue.recoverProcessing();
    if (recovered > 0) {
      console.log(`[EdgeSync] Recovered ${recovered} votes from previous session`);
    }

    // Initial health check
    await this.checkCentralHealth();

    // Start health check timer
    this.healthTimer = setInterval(
      () => this.checkCentralHealth(),
      this.config.central.healthCheckIntervalMs
    );

    // Start sync loop if enabled
    if (this.config.sync.enabled) {
      this.startSyncLoop();
    }
  }

  /**
   * Stop the sync worker
   */
  stop(): void {
    if (!this.running) return;
    this.running = false;

    console.log('[EdgeSync] Stopping sync worker');

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    this.status.pendingVotes = this.queue.getStats().pending;
    return { ...this.status };
  }

  /**
   * Force a sync now
   */
  async syncNow(): Promise<SyncResult> {
    return this.performSync();
  }

  /**
   * Check if connected to central
   */
  isConnected(): boolean {
    return this.status.connected;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Start the sync loop
   */
  private startSyncLoop(): void {
    this.syncTimer = setInterval(async () => {
      if (!this.running) return;
      if (!this.status.connected) return;
      if (!this.queue.hasPending()) {
        this.emit('queue:empty');
        return;
      }

      await this.performSync();
    }, this.config.sync.intervalMs);
  }

  /**
   * Perform a sync operation
   */
  private async performSync(): Promise<SyncResult> {
    const startTime = Date.now();
    this.status.lastSyncAt = startTime;
    this.status.syncCount++;

    const batch = this.queue.getNextBatch(this.config.sync.maxBatchSize);

    if (batch.votes.length === 0) {
      return {
        success: true,
        batchId: batch.batchId,
        votesCount: 0,
        duration: Date.now() - startTime,
      };
    }

    this.emit('sync:start', { batchId: batch.batchId, count: batch.votes.length });

    try {
      await this.sendBatchToCentral(batch.votes, batch.batchId);

      // Success - acknowledge batch
      this.queue.ackBatch(batch.batchId);

      const duration = Date.now() - startTime;
      this.status.lastSuccessAt = Date.now();

      const result: SyncResult = {
        success: true,
        batchId: batch.batchId,
        votesCount: batch.votes.length,
        duration,
      };

      this.emit('sync:success', result);
      console.log(`[EdgeSync] Synced ${batch.votes.length} votes in ${duration}ms`);

      return result;
    } catch (error) {
      // Failure - nack batch
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.queue.nackBatch(batch.batchId, errorMsg);

      this.status.lastErrorAt = Date.now();
      this.status.lastError = errorMsg;
      this.status.errorCount++;

      const result: SyncResult = {
        success: false,
        batchId: batch.batchId,
        votesCount: batch.votes.length,
        duration: Date.now() - startTime,
        error: errorMsg,
      };

      this.emit('sync:error', result);
      console.error(`[EdgeSync] Sync failed: ${errorMsg}`);

      return result;
    }
  }

  /**
   * Send batch to central server
   */
  private async sendBatchToCentral(votes: QueuedVote[], batchId: string): Promise<void> {
    const url = `${this.config.central.url}/central/ingest`;

    const payload = {
      edgeNodeId: this.config.nodeId,
      batchId,
      votes: votes.map((v) => ({
        electionId: v.electionId,
        nullifier: v.nullifier,
        encryptedVote: v.encryptedVote,
        proof: v.proof,
        timestamp: v.timestamp,
      })),
    };

    // Optionally compress payload
    let body: string | Buffer;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.central.apiKey}`,
      'X-Edge-Node-Id': this.config.nodeId,
      'X-Batch-Id': batchId,
    };

    if (this.config.sync.compressionEnabled && votes.length > 10) {
      const jsonData = JSON.stringify(payload);
      body = gzipSync(jsonData);
      headers['Content-Encoding'] = 'gzip';
      headers['Content-Type'] = 'application/json';
    } else {
      body = JSON.stringify(payload);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(this.config.central.connectionTimeoutMs),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`Central server error: ${response.status} - ${errorText}`);
    }

    const result = await response.json() as { accepted: number; duplicates?: number };

    if (result.duplicates && result.duplicates > 0) {
      console.log(`[EdgeSync] Central reported ${result.duplicates} duplicate votes (already received)`);
    }
  }

  /**
   * Check central server health
   */
  private async checkCentralHealth(): Promise<void> {
    const url = `${this.config.central.url}/health`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.central.apiKey}`,
          'X-Edge-Node-Id': this.config.nodeId,
        },
        signal: AbortSignal.timeout(this.config.central.connectionTimeoutMs),
      });

      if (response.ok) {
        if (!this.status.connected) {
          this.status.connected = true;
          this.emit('connected');
          console.log('[EdgeSync] Connected to central server');
        }
      } else {
        this.handleDisconnect(`Health check failed: ${response.status}`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.handleDisconnect(`Health check error: ${msg}`);
    }
  }

  /**
   * Handle disconnect from central
   */
  private handleDisconnect(reason: string): void {
    if (this.status.connected) {
      this.status.connected = false;
      this.emit('disconnected', { reason });
      console.warn(`[EdgeSync] Disconnected from central: ${reason}`);
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

let syncWorker: EdgeSyncWorker | null = null;

export function getEdgeSyncWorker(): EdgeSyncWorker {
  if (!syncWorker) {
    syncWorker = new EdgeSyncWorker();
  }
  return syncWorker;
}

export function resetEdgeSyncWorker(): void {
  if (syncWorker) {
    syncWorker.stop();
    syncWorker = null;
  }
}
