/**
 * Central API Routes
 *
 * API endpoints for receiving votes from edge nodes.
 * Active when VEILCLOUD_MODE=central or VEILCLOUD_MODE=standalone.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { gunzipSync } from 'zlib';

import { getCentralConfig, isCentralMode, getVeilCloudMode } from '../edge/config.js';
import {
  getCentralIngestService,
  type IngestBatch,
} from './ingest.js';

// ============================================================================
// Types
// ============================================================================

interface IngestBody {
  edgeNodeId: string;
  batchId: string;
  votes: Array<{
    electionId: string;
    nullifier: string;
    encryptedVote: string;
    proof: string;
    timestamp: number;
  }>;
}

// ============================================================================
// Route Registration
// ============================================================================

/**
 * Register central routes
 * Active in central mode or standalone mode
 */
export async function registerCentralRoutes(app: FastifyInstance): Promise<void> {
  const mode = getVeilCloudMode();
  if (mode === 'edge') {
    console.log('[Central] In edge mode, skipping central routes');
    return;
  }

  const config = getCentralConfig();
  console.log(`[Central] Registering central routes (mode: ${mode})`);

  // ============================================================================
  // POST /central/ingest - Receive vote batch from edge node
  // ============================================================================
  app.post('/central/ingest', {
    preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
      // Authenticate edge node
      const ingest = getCentralIngestService();
      const nodeId = request.headers['x-edge-node-id'] as string;
      const authHeader = request.headers.authorization;

      if (!nodeId) {
        return reply.status(400).send({ error: 'Missing X-Edge-Node-Id header' });
      }

      if (config.edges.authRequired) {
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return reply.status(401).send({ error: 'Missing or invalid Authorization header' });
        }

        const apiKey = authHeader.substring(7);
        if (!ingest.verifyEdgeAuth(nodeId, apiKey)) {
          return reply.status(403).send({ error: 'Edge node not authorized' });
        }
      }
    },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const ingest = getCentralIngestService();

    // Handle compressed payloads
    let body: IngestBody;
    if (request.headers['content-encoding'] === 'gzip') {
      const compressed = request.body as Buffer;
      const decompressed = gunzipSync(compressed);
      body = JSON.parse(decompressed.toString());
    } else {
      body = request.body as IngestBody;
    }

    // Validate batch
    if (!body.edgeNodeId || !body.batchId || !body.votes) {
      return reply.status(400).send({
        error: 'Invalid batch',
        required: ['edgeNodeId', 'batchId', 'votes'],
      });
    }

    if (body.votes.length > config.ingest.maxBatchSize) {
      return reply.status(400).send({
        error: 'Batch too large',
        maxSize: config.ingest.maxBatchSize,
      });
    }

    // Process batch
    const batch: IngestBatch = {
      edgeNodeId: body.edgeNodeId,
      batchId: body.batchId,
      votes: body.votes,
    };

    const result = await ingest.processBatch(batch);

    return reply.send(result);
  });

  // ============================================================================
  // GET /central/edges - List registered edge nodes
  // ============================================================================
  app.get('/central/edges', async (_request: FastifyRequest, reply: FastifyReply) => {
    const ingest = getCentralIngestService();
    const nodes = ingest.listEdgeNodes();

    return reply.send({
      count: nodes.length,
      nodes: nodes.map((n) => ({
        nodeId: n.nodeId,
        registeredAt: n.registeredAt,
        lastSeenAt: n.lastSeenAt,
        totalVotes: n.totalVotes,
        status: n.status,
      })),
    });
  });

  // ============================================================================
  // GET /central/edges/:nodeId - Get edge node info
  // ============================================================================
  app.get('/central/edges/:nodeId', async (
    request: FastifyRequest<{ Params: { nodeId: string } }>,
    reply: FastifyReply
  ) => {
    const ingest = getCentralIngestService();
    const node = ingest.getEdgeNode(request.params.nodeId);

    if (!node) {
      return reply.status(404).send({ error: 'Edge node not found' });
    }

    return reply.send({
      nodeId: node.nodeId,
      registeredAt: node.registeredAt,
      lastSeenAt: node.lastSeenAt,
      totalVotes: node.totalVotes,
      status: node.status,
    });
  });

  // ============================================================================
  // POST /central/edges/:nodeId/block - Block an edge node
  // ============================================================================
  app.post('/central/edges/:nodeId/block', async (
    request: FastifyRequest<{ Params: { nodeId: string } }>,
    reply: FastifyReply
  ) => {
    const ingest = getCentralIngestService();
    ingest.blockEdgeNode(request.params.nodeId);

    return reply.send({ success: true, message: 'Edge node blocked' });
  });

  // ============================================================================
  // POST /central/edges/:nodeId/unblock - Unblock an edge node
  // ============================================================================
  app.post('/central/edges/:nodeId/unblock', async (
    request: FastifyRequest<{ Params: { nodeId: string } }>,
    reply: FastifyReply
  ) => {
    const ingest = getCentralIngestService();
    ingest.unblockEdgeNode(request.params.nodeId);

    return reply.send({ success: true, message: 'Edge node unblocked' });
  });

  // ============================================================================
  // GET /central/stats - Get central ingest statistics
  // ============================================================================
  app.get('/central/stats', async (_request: FastifyRequest, reply: FastifyReply) => {
    const ingest = getCentralIngestService();
    const stats = ingest.getStats();

    return reply.send({
      mode: getVeilCloudMode(),
      edgeNodes: stats.edgeNodes,
      activeNodes: stats.activeNodes,
      recentBatches: stats.recentBatches,
      recentNullifiers: stats.recentNullifiers,
    });
  });

  console.log('[Central] Central routes registered');
}
