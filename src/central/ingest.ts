/**
 * Central Ingest Service
 *
 * Handles incoming vote batches from edge nodes.
 * Performs deduplication, validation, and forwards to Kafka/DB.
 */

import { createHash } from 'crypto';

import { getCentralConfig, type CentralConfig } from '../edge/config.js';

// ============================================================================
// Types
// ============================================================================

export interface IngestVote {
  electionId: string;
  nullifier: string;
  encryptedVote: string;
  proof: string;
  timestamp: number;
}

export interface IngestBatch {
  edgeNodeId: string;
  batchId: string;
  votes: IngestVote[];
}

export interface IngestResult {
  accepted: number;
  duplicates: number;
  rejected: number;
  errors: Array<{ index: number; error: string }>;
}

export interface EdgeNodeInfo {
  nodeId: string;
  apiKeyHash: string;
  registeredAt: number;
  lastSeenAt: number;
  totalVotes: number;
  status: 'active' | 'inactive' | 'blocked';
}

// ============================================================================
// Central Ingest Service
// ============================================================================

export class CentralIngestService {
  private config: CentralConfig;
  private edgeNodes: Map<string, EdgeNodeInfo> = new Map();
  private recentBatches: Map<string, number> = new Map(); // batchId -> timestamp
  private recentNullifiers: Map<string, number> = new Map(); // nullifier -> timestamp

  constructor(config?: CentralConfig) {
    this.config = config || getCentralConfig();

    // Cleanup old entries periodically
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Process an incoming batch from an edge node
   */
  async processBatch(batch: IngestBatch): Promise<IngestResult> {
    const result: IngestResult = {
      accepted: 0,
      duplicates: 0,
      rejected: 0,
      errors: [],
    };

    // Check for duplicate batch
    if (this.recentBatches.has(batch.batchId)) {
      console.log(`[Ingest] Duplicate batch ${batch.batchId} from ${batch.edgeNodeId}`);
      return { ...result, duplicates: batch.votes.length };
    }
    this.recentBatches.set(batch.batchId, Date.now());

    // Update edge node stats
    this.updateEdgeNode(batch.edgeNodeId);

    // Process each vote
    for (let i = 0; i < batch.votes.length; i++) {
      const vote = batch.votes[i];

      try {
        const voteResult = await this.processVote(vote, batch.edgeNodeId);
        if (voteResult.accepted) {
          result.accepted++;
        } else if (voteResult.duplicate) {
          result.duplicates++;
        } else {
          result.rejected++;
          result.errors.push({ index: i, error: voteResult.error || 'Unknown error' });
        }
      } catch (error) {
        result.rejected++;
        result.errors.push({
          index: i,
          error: error instanceof Error ? error.message : 'Processing error',
        });
      }
    }

    console.log(
      `[Ingest] Batch ${batch.batchId}: accepted=${result.accepted}, duplicates=${result.duplicates}, rejected=${result.rejected}`
    );

    return result;
  }

  /**
   * Process a single vote
   */
  private async processVote(
    vote: IngestVote,
    _edgeNodeId: string
  ): Promise<{ accepted: boolean; duplicate?: boolean; error?: string }> {
    // Validate vote structure
    if (!vote.electionId || !vote.nullifier || !vote.encryptedVote || !vote.proof) {
      return { accepted: false, error: 'Missing required fields' };
    }

    // Create unique key for deduplication
    const nullifierKey = `${vote.electionId}:${vote.nullifier}`;

    // Check recent nullifiers (fast in-memory check)
    if (this.recentNullifiers.has(nullifierKey)) {
      return { accepted: false, duplicate: true };
    }

    // TODO: Check Redis Bloom filter for nullifier
    // TODO: Check database for nullifier
    // TODO: Publish to Kafka

    // For now, just track in memory
    this.recentNullifiers.set(nullifierKey, Date.now());

    return { accepted: true };
  }

  /**
   * Verify edge node authentication
   */
  verifyEdgeAuth(nodeId: string, apiKey: string): boolean {
    if (!this.config.edges.authRequired) {
      return true;
    }

    // Check if node is registered
    const node = this.edgeNodes.get(nodeId);
    if (!node) {
      // Auto-register if enabled
      if (this.config.edges.registrationEnabled) {
        this.registerEdgeNode(nodeId, apiKey);
        return true;
      }
      return false;
    }

    // Verify API key
    const keyHash = this.hashApiKey(apiKey);
    if (node.apiKeyHash !== keyHash) {
      return false;
    }

    // Check if blocked
    if (node.status === 'blocked') {
      return false;
    }

    return true;
  }

  /**
   * Register a new edge node
   */
  registerEdgeNode(nodeId: string, apiKey: string): void {
    const now = Date.now();
    this.edgeNodes.set(nodeId, {
      nodeId,
      apiKeyHash: this.hashApiKey(apiKey),
      registeredAt: now,
      lastSeenAt: now,
      totalVotes: 0,
      status: 'active',
    });
    console.log(`[Ingest] Registered edge node: ${nodeId}`);
  }

  /**
   * Update edge node stats
   */
  private updateEdgeNode(nodeId: string): void {
    const node = this.edgeNodes.get(nodeId);
    if (node) {
      node.lastSeenAt = Date.now();
    }
  }

  /**
   * Get edge node info
   */
  getEdgeNode(nodeId: string): EdgeNodeInfo | undefined {
    return this.edgeNodes.get(nodeId);
  }

  /**
   * List all edge nodes
   */
  listEdgeNodes(): EdgeNodeInfo[] {
    return Array.from(this.edgeNodes.values());
  }

  /**
   * Block an edge node
   */
  blockEdgeNode(nodeId: string): void {
    const node = this.edgeNodes.get(nodeId);
    if (node) {
      node.status = 'blocked';
      console.log(`[Ingest] Blocked edge node: ${nodeId}`);
    }
  }

  /**
   * Unblock an edge node
   */
  unblockEdgeNode(nodeId: string): void {
    const node = this.edgeNodes.get(nodeId);
    if (node) {
      node.status = 'active';
      console.log(`[Ingest] Unblocked edge node: ${nodeId}`);
    }
  }

  /**
   * Get service statistics
   */
  getStats(): {
    edgeNodes: number;
    activeNodes: number;
    recentBatches: number;
    recentNullifiers: number;
  } {
    const activeNodes = Array.from(this.edgeNodes.values()).filter(
      (n) => n.status === 'active' && n.lastSeenAt > Date.now() - 300000
    ).length;

    return {
      edgeNodes: this.edgeNodes.size,
      activeNodes,
      recentBatches: this.recentBatches.size,
      recentNullifiers: this.recentNullifiers.size,
    };
  }

  /**
   * Cleanup old entries
   */
  private cleanup(): void {
    const now = Date.now();
    const batchWindow = 3600000; // 1 hour
    const nullifierWindow = this.config.ingest.deduplicationWindowMs;

    // Cleanup old batches
    for (const [batchId, timestamp] of this.recentBatches) {
      if (now - timestamp > batchWindow) {
        this.recentBatches.delete(batchId);
      }
    }

    // Cleanup old nullifiers
    for (const [nullifier, timestamp] of this.recentNullifiers) {
      if (now - timestamp > nullifierWindow) {
        this.recentNullifiers.delete(nullifier);
      }
    }
  }

  /**
   * Hash an API key
   */
  private hashApiKey(apiKey: string): string {
    return createHash('sha256').update(apiKey).digest('hex');
  }
}

// ============================================================================
// Singleton
// ============================================================================

let ingestService: CentralIngestService | null = null;

export function getCentralIngestService(): CentralIngestService {
  if (!ingestService) {
    ingestService = new CentralIngestService();
  }
  return ingestService;
}

export function resetCentralIngestService(): void {
  ingestService = null;
}
