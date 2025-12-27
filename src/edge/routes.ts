/**
 * Edge API Routes
 *
 * Lightweight API endpoints for edge nodes (Raspberry Pi).
 * Handles vote intake, status reporting, and local operations.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { getEdgeConfig, isEdgeMode } from './config.js';
import { getEdgeQueueService } from './queue.js';
import { getEdgeSyncWorker } from './sync.js';
import { getEdgeBloomService } from './bloom.js';

// ============================================================================
// Types
// ============================================================================

interface VoteSubmission {
  electionId: string;
  nullifier: string;
  encryptedVote: string;
  proof: string;
}

interface VoteBatchSubmission {
  votes: VoteSubmission[];
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register edge routes
 * Only active when VEILCLOUD_MODE=edge
 */
export async function registerEdgeRoutes(app: FastifyInstance): Promise<void> {
  if (!isEdgeMode()) {
    console.log('[Edge] Not in edge mode, skipping edge routes');
    return;
  }

  const config = getEdgeConfig();
  console.log(`[Edge] Registering edge routes (node: ${config.nodeId})`);

  // ============================================================================
  // POST /edge/votes - Submit a single vote
  // ============================================================================
  app.post('/edge/votes', async (
    request: FastifyRequest<{ Body: VoteSubmission }>,
    reply: FastifyReply
  ) => {
    const queue = getEdgeQueueService();
    const bloom = getEdgeBloomService();
    const vote = request.body;

    // Validate required fields
    if (!vote.electionId || !vote.nullifier || !vote.encryptedVote || !vote.proof) {
      return reply.status(400).send({
        error: 'Missing required fields',
        required: ['electionId', 'nullifier', 'encryptedVote', 'proof'],
      });
    }

    // Check queue capacity
    if (queue.isFull()) {
      return reply.status(503).send({
        error: 'Queue full',
        message: 'Edge node queue is at capacity. Please try again later.',
      });
    }

    // Fast duplicate check via Bloom filter
    const mightExist = bloom.mightExist(vote.electionId, vote.nullifier);
    if (mightExist) {
      // Could be false positive, but reject anyway for speed
      // Central server will do authoritative check
      return reply.status(409).send({
        error: 'Duplicate vote',
        message: 'This nullifier may have already been used.',
      });
    }

    // Add to queue
    const result = queue.add(vote);

    if (!result.success) {
      return reply.status(409).send({
        error: 'Vote rejected',
        message: result.error,
      });
    }

    // Add to Bloom filter
    bloom.add(vote.electionId, vote.nullifier);

    return reply.status(202).send({
      accepted: true,
      id: result.id,
      message: 'Vote queued for sync',
    });
  });

  // ============================================================================
  // POST /edge/votes/batch - Submit multiple votes
  // ============================================================================
  app.post('/edge/votes/batch', async (
    request: FastifyRequest<{ Body: VoteBatchSubmission }>,
    reply: FastifyReply
  ) => {
    const queue = getEdgeQueueService();
    const bloom = getEdgeBloomService();
    const { votes } = request.body;

    if (!votes || !Array.isArray(votes) || votes.length === 0) {
      return reply.status(400).send({
        error: 'Invalid request',
        message: 'votes array is required',
      });
    }

    // Limit batch size
    if (votes.length > 100) {
      return reply.status(400).send({
        error: 'Batch too large',
        message: 'Maximum 100 votes per batch',
      });
    }

    const results = {
      accepted: 0,
      rejected: 0,
      duplicates: 0,
      errors: [] as { index: number; error: string }[],
    };

    for (let i = 0; i < votes.length; i++) {
      const vote = votes[i];

      // Validate
      if (!vote.electionId || !vote.nullifier || !vote.encryptedVote || !vote.proof) {
        results.rejected++;
        results.errors.push({ index: i, error: 'Missing required fields' });
        continue;
      }

      // Bloom check
      if (bloom.mightExist(vote.electionId, vote.nullifier)) {
        results.duplicates++;
        continue;
      }

      // Queue
      const result = queue.add(vote);
      if (result.success) {
        bloom.add(vote.electionId, vote.nullifier);
        results.accepted++;
      } else {
        results.rejected++;
        if (result.error?.includes('Duplicate')) {
          results.duplicates++;
        } else {
          results.errors.push({ index: i, error: result.error || 'Unknown error' });
        }
      }
    }

    const statusCode = results.accepted > 0 ? 202 : 400;
    return reply.status(statusCode).send(results);
  });

  // ============================================================================
  // GET /edge/status - Get edge node status
  // ============================================================================
  app.get('/edge/status', async (_request: FastifyRequest, reply: FastifyReply) => {
    const queue = getEdgeQueueService();
    const sync = getEdgeSyncWorker();

    const queueStats = queue.getStats();
    const syncStatus = sync.getStatus();

    return reply.send({
      nodeId: config.nodeId,
      mode: config.mode,
      queue: {
        pending: queueStats.pending,
        processing: queueStats.processing,
        failed: queueStats.failed,
        total: queueStats.total,
        capacity: config.queue.maxSize,
        utilizationPercent: Math.round((queueStats.total / config.queue.maxSize) * 100),
      },
      sync: {
        connected: syncStatus.connected,
        lastSyncAt: syncStatus.lastSyncAt,
        lastSuccessAt: syncStatus.lastSuccessAt,
        lastError: syncStatus.lastError,
        syncCount: syncStatus.syncCount,
        errorCount: syncStatus.errorCount,
      },
      central: {
        url: config.central.url,
        connected: syncStatus.connected,
      },
    });
  });

  // ============================================================================
  // GET /edge/health - Health check for edge node
  // ============================================================================
  app.get('/edge/health', async (_request: FastifyRequest, reply: FastifyReply) => {
    const queue = getEdgeQueueService();
    const sync = getEdgeSyncWorker();

    const queueStats = queue.getStats();
    const isHealthy = queueStats.total < config.queue.maxSize * 0.9; // <90% full

    return reply.status(isHealthy ? 200 : 503).send({
      status: isHealthy ? 'healthy' : 'degraded',
      nodeId: config.nodeId,
      centralConnected: sync.isConnected(),
      queueUtilization: Math.round((queueStats.total / config.queue.maxSize) * 100),
    });
  });

  // ============================================================================
  // POST /edge/sync - Force a sync now
  // ============================================================================
  app.post('/edge/sync', async (_request: FastifyRequest, reply: FastifyReply) => {
    const sync = getEdgeSyncWorker();

    if (!sync.isConnected()) {
      return reply.status(503).send({
        error: 'Not connected',
        message: 'Central server is not reachable',
      });
    }

    const result = await sync.syncNow();
    return reply.send(result);
  });

  // ============================================================================
  // POST /edge/retry-failed - Retry all failed votes
  // ============================================================================
  app.post('/edge/retry-failed', async (_request: FastifyRequest, reply: FastifyReply) => {
    const queue = getEdgeQueueService();
    const count = queue.retryFailed();

    return reply.send({
      retriedCount: count,
      message: `${count} failed votes returned to pending queue`,
    });
  });

  // ============================================================================
  // POST /edge/compact - Compact the queue database
  // ============================================================================
  app.post('/edge/compact', async (_request: FastifyRequest, reply: FastifyReply) => {
    const queue = getEdgeQueueService();
    queue.compact();

    return reply.send({
      success: true,
      message: 'Queue database compacted',
    });
  });

  console.log('[Edge] Edge routes registered');
}
