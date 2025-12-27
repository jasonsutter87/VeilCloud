/**
 * Edge Queue Service (SQLite-based)
 *
 * Persistent queue for storing votes when offline.
 * Votes are queued locally and synced to central when connected.
 *
 * Uses better-sqlite3 for synchronous, high-performance SQLite access.
 */

import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

import { getEdgeConfig, type EdgeConfig } from './config.js';

// ============================================================================
// Types
// ============================================================================

export interface QueuedVote {
  id: string;
  electionId: string;
  nullifier: string;
  encryptedVote: string;
  proof: string;
  timestamp: number;
  retries: number;
  status: 'pending' | 'processing' | 'failed';
  createdAt: number;
  lastAttemptAt: number | null;
  error: string | null;
}

export interface QueueStats {
  pending: number;
  processing: number;
  failed: number;
  total: number;
  oldestPending: number | null;
  newestPending: number | null;
}

export interface QueueBatch {
  votes: QueuedVote[];
  batchId: string;
}

// ============================================================================
// SQLite Queue Service
// ============================================================================

export class EdgeQueueService {
  private db: Database.Database;
  private config: EdgeConfig;
  private initialized = false;

  constructor(config?: EdgeConfig) {
    this.config = config || getEdgeConfig();

    // Ensure directory exists
    const dbDir = dirname(this.config.queue.path);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }

    // Open database with WAL mode for better concurrency
    this.db = new Database(this.config.queue.path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('temp_store = MEMORY');

    this.initialize();
  }

  /**
   * Initialize database schema
   */
  private initialize(): void {
    if (this.initialized) return;

    this.db.exec(`
      -- Votes queue table
      CREATE TABLE IF NOT EXISTS vote_queue (
        id TEXT PRIMARY KEY,
        election_id TEXT NOT NULL,
        nullifier TEXT NOT NULL,
        encrypted_vote TEXT NOT NULL,
        proof TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        retries INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        last_attempt_at INTEGER,
        error TEXT,
        UNIQUE(election_id, nullifier)
      );

      -- Indexes for efficient querying
      CREATE INDEX IF NOT EXISTS idx_queue_status ON vote_queue(status);
      CREATE INDEX IF NOT EXISTS idx_queue_election ON vote_queue(election_id);
      CREATE INDEX IF NOT EXISTS idx_queue_created ON vote_queue(created_at);
      CREATE INDEX IF NOT EXISTS idx_queue_pending ON vote_queue(status, created_at)
        WHERE status = 'pending';

      -- Sync batches table (track what's been sent)
      CREATE TABLE IF NOT EXISTS sync_batches (
        id TEXT PRIMARY KEY,
        vote_ids TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        sent_at INTEGER,
        acked_at INTEGER,
        status TEXT DEFAULT 'pending'
      );

      -- Local Bloom filter state (persisted)
      CREATE TABLE IF NOT EXISTS bloom_state (
        election_id TEXT PRIMARY KEY,
        filter_data BLOB NOT NULL,
        capacity INTEGER NOT NULL,
        count INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    this.initialized = true;
  }

  /**
   * Add a vote to the queue
   */
  add(vote: {
    electionId: string;
    nullifier: string;
    encryptedVote: string;
    proof: string;
  }): { success: boolean; id?: string; error?: string } {
    const id = this.generateVoteId(vote.electionId, vote.nullifier);
    const now = Date.now();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO vote_queue (
          id, election_id, nullifier, encrypted_vote, proof,
          timestamp, status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
      `);

      stmt.run(
        id,
        vote.electionId,
        vote.nullifier,
        vote.encryptedVote,
        vote.proof,
        now,
        now
      );

      return { success: true, id };
    } catch (error) {
      // Handle duplicate nullifier (UNIQUE constraint)
      if ((error as Error).message.includes('UNIQUE constraint')) {
        return { success: false, error: 'Duplicate vote (nullifier already used)' };
      }
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get next batch of pending votes for sync
   */
  getNextBatch(size?: number): QueueBatch {
    const batchSize = size || this.config.queue.batchSize;
    const batchId = this.generateBatchId();

    const stmt = this.db.prepare(`
      SELECT
        id, election_id as electionId, nullifier, encrypted_vote as encryptedVote,
        proof, timestamp, retries, status, created_at as createdAt,
        last_attempt_at as lastAttemptAt, error
      FROM vote_queue
      WHERE status = 'pending'
      ORDER BY created_at ASC
      LIMIT ?
    `);

    const votes = stmt.all(batchSize) as QueuedVote[];

    // Mark as processing
    if (votes.length > 0) {
      const ids = votes.map(v => v.id);
      const placeholders = ids.map(() => '?').join(',');
      const updateStmt = this.db.prepare(`
        UPDATE vote_queue
        SET status = 'processing', last_attempt_at = ?
        WHERE id IN (${placeholders})
      `);
      updateStmt.run(Date.now(), ...ids);

      // Record batch
      const batchStmt = this.db.prepare(`
        INSERT INTO sync_batches (id, vote_ids, created_at, status)
        VALUES (?, ?, ?, 'pending')
      `);
      batchStmt.run(batchId, JSON.stringify(ids), Date.now());
    }

    return { votes, batchId };
  }

  /**
   * Acknowledge successful sync of a batch
   */
  ackBatch(batchId: string): void {
    const now = Date.now();

    // Get batch info
    const batchStmt = this.db.prepare(`
      SELECT vote_ids FROM sync_batches WHERE id = ?
    `);
    const batch = batchStmt.get(batchId) as { vote_ids: string } | undefined;

    if (!batch) return;

    const voteIds = JSON.parse(batch.vote_ids) as string[];
    const placeholders = voteIds.map(() => '?').join(',');

    // Delete synced votes
    const deleteStmt = this.db.prepare(`
      DELETE FROM vote_queue WHERE id IN (${placeholders})
    `);
    deleteStmt.run(...voteIds);

    // Update batch status
    const updateStmt = this.db.prepare(`
      UPDATE sync_batches SET status = 'acked', acked_at = ? WHERE id = ?
    `);
    updateStmt.run(now, batchId);
  }

  /**
   * Mark batch as failed and return votes to pending
   */
  nackBatch(batchId: string, error?: string): void {
    const now = Date.now();

    // Get batch info
    const batchStmt = this.db.prepare(`
      SELECT vote_ids FROM sync_batches WHERE id = ?
    `);
    const batch = batchStmt.get(batchId) as { vote_ids: string } | undefined;

    if (!batch) return;

    const voteIds = JSON.parse(batch.vote_ids) as string[];
    const placeholders = voteIds.map(() => '?').join(',');

    // Return to pending, increment retries
    const updateStmt = this.db.prepare(`
      UPDATE vote_queue
      SET status = CASE
        WHEN retries >= ? THEN 'failed'
        ELSE 'pending'
      END,
      retries = retries + 1,
      last_attempt_at = ?,
      error = ?
      WHERE id IN (${placeholders})
    `);
    updateStmt.run(this.config.queue.maxRetries, now, error || null, ...voteIds);

    // Update batch status
    const batchUpdateStmt = this.db.prepare(`
      UPDATE sync_batches SET status = 'failed' WHERE id = ?
    `);
    batchUpdateStmt.run(batchId);
  }

  /**
   * Get queue statistics
   */
  getStats(): QueueStats {
    const statsStmt = this.db.prepare(`
      SELECT
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as processing,
        COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
        COUNT(*) as total,
        MIN(CASE WHEN status = 'pending' THEN created_at END) as oldestPending,
        MAX(CASE WHEN status = 'pending' THEN created_at END) as newestPending
      FROM vote_queue
    `);

    return statsStmt.get() as QueueStats;
  }

  /**
   * Check if queue has pending votes
   */
  hasPending(): boolean {
    const stmt = this.db.prepare(`
      SELECT 1 FROM vote_queue WHERE status = 'pending' LIMIT 1
    `);
    return stmt.get() !== undefined;
  }

  /**
   * Get queue size
   */
  size(): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM vote_queue
    `);
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Check if queue is at capacity
   */
  isFull(): boolean {
    return this.size() >= this.config.queue.maxSize;
  }

  /**
   * Reset processing votes back to pending (for restart recovery)
   */
  recoverProcessing(): number {
    const stmt = this.db.prepare(`
      UPDATE vote_queue SET status = 'pending' WHERE status = 'processing'
    `);
    const result = stmt.run();
    return result.changes;
  }

  /**
   * Retry failed votes
   */
  retryFailed(): number {
    const stmt = this.db.prepare(`
      UPDATE vote_queue
      SET status = 'pending', retries = 0, error = NULL
      WHERE status = 'failed'
    `);
    const result = stmt.run();
    return result.changes;
  }

  /**
   * Compact database (remove old sync batches)
   */
  compact(): void {
    const threshold = Date.now() - 86400000; // 24 hours ago

    const stmt = this.db.prepare(`
      DELETE FROM sync_batches WHERE acked_at < ? OR (status = 'failed' AND created_at < ?)
    `);
    stmt.run(threshold, threshold);

    // Vacuum to reclaim space
    this.db.exec('VACUUM');
  }

  /**
   * Close database connection
   */
  close(): void {
    this.db.close();
  }

  /**
   * Generate deterministic vote ID
   */
  private generateVoteId(electionId: string, nullifier: string): string {
    return createHash('sha256')
      .update(`${electionId}:${nullifier}`)
      .digest('hex')
      .substring(0, 32);
  }

  /**
   * Generate unique batch ID
   */
  private generateBatchId(): string {
    return `batch-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let queueService: EdgeQueueService | null = null;

export function getEdgeQueueService(): EdgeQueueService {
  if (!queueService) {
    queueService = new EdgeQueueService();
  }
  return queueService;
}

export function resetEdgeQueueService(): void {
  if (queueService) {
    queueService.close();
    queueService = null;
  }
}
