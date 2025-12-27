/**
 * Proof Service
 * Cryptographic proof generation and verification via VeilChain
 */

import { getVeilChainClient } from '../integrations/veilchain.js';
import { query } from '../db/connection.js';
import type { ProjectId, MerkleProof } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface ConsistencyProof {
  fromRoot: string;
  toRoot: string;
  proof: string[];
  treeSize: {
    from: bigint;
    to: bigint;
  };
}

export interface InclusionProof {
  entryId: string;
  entryHash: string;
  root: string;
  proof: string[];
  index: bigint;
  treeSize: bigint;
}

export interface ProofVerification {
  valid: boolean;
  type: 'inclusion' | 'consistency';
  details?: Record<string, unknown>;
  verifiedAt: Date;
}

export interface AuditSnapshot {
  snapshotId: string;
  projectId: ProjectId;
  root: string;
  treeSize: bigint;
  timestamp: Date;
}

// ============================================================================
// Service
// ============================================================================

export class ProofService {
  /**
   * Generate an inclusion proof for an audit entry
   */
  async generateInclusionProof(entryId: string): Promise<InclusionProof> {
    const veilchain = getVeilChainClient();

    const proof = await veilchain.getProof(entryId);
    const entry = await veilchain.getEntry(entryId);

    return {
      entryId,
      entryHash: entry.hash,
      root: proof.root,
      proof: proof.proof,
      index: BigInt(proof.index),
      treeSize: BigInt(proof.treeSize ?? proof.index + 1),
    };
  }

  /**
   * Generate a consistency proof between two snapshots
   */
  async generateConsistencyProof(
    fromSnapshotId: string,
    toSnapshotId: string
  ): Promise<ConsistencyProof> {
    // Get snapshots from local cache
    const fromSnapshot = await this.getSnapshot(fromSnapshotId);
    const toSnapshot = await this.getSnapshot(toSnapshotId);

    if (!fromSnapshot || !toSnapshot) {
      throw new Error('Snapshot not found');
    }

    const veilchain = getVeilChainClient();

    const proof = await veilchain.getConsistencyProof({
      fromSize: fromSnapshot.treeSize,
      toSize: toSnapshot.treeSize,
    });

    return {
      fromRoot: fromSnapshot.root,
      toRoot: toSnapshot.root,
      proof: proof.proof,
      treeSize: {
        from: fromSnapshot.treeSize,
        to: toSnapshot.treeSize,
      },
    };
  }

  /**
   * Verify an inclusion proof
   */
  async verifyInclusionProof(proof: InclusionProof): Promise<ProofVerification> {
    const veilchain = getVeilChainClient();

    const valid = await veilchain.verifyProof({
      leaf: proof.entryHash,
      root: proof.root,
      index: Number(proof.index),
      proof: proof.proof,
      directions: this.computeDirections(Number(proof.index), Number(proof.treeSize)),
    });

    return {
      valid,
      type: 'inclusion',
      details: {
        entryId: proof.entryId,
        root: proof.root,
      },
      verifiedAt: new Date(),
    };
  }

  /**
   * Verify a consistency proof
   */
  async verifyConsistencyProof(proof: ConsistencyProof): Promise<ProofVerification> {
    const veilchain = getVeilChainClient();

    const valid = await veilchain.verifyConsistencyProof({
      fromRoot: proof.fromRoot,
      toRoot: proof.toRoot,
      proof: proof.proof,
      fromSize: proof.treeSize.from,
      toSize: proof.treeSize.to,
    });

    return {
      valid,
      type: 'consistency',
      details: {
        fromRoot: proof.fromRoot,
        toRoot: proof.toRoot,
        fromSize: proof.treeSize.from.toString(),
        toSize: proof.treeSize.to.toString(),
      },
      verifiedAt: new Date(),
    };
  }

  /**
   * Create an audit snapshot
   */
  async createSnapshot(projectId: ProjectId): Promise<AuditSnapshot> {
    const veilchain = getVeilChainClient();

    const current = await veilchain.getRootHash();
    const treeSize = await veilchain.getTreeSize();

    // Store snapshot
    const result = await query<{ id: string }>(
      `INSERT INTO audit_snapshots (project_id, root_hash, tree_size, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id`,
      [projectId, current, treeSize.toString()]
    );

    return {
      snapshotId: result.rows[0]!.id,
      projectId,
      root: current,
      treeSize,
      timestamp: new Date(),
    };
  }

  /**
   * Get a snapshot by ID
   */
  async getSnapshot(snapshotId: string): Promise<AuditSnapshot | null> {
    const result = await query<{
      id: string;
      project_id: string;
      root_hash: string;
      tree_size: string;
      created_at: Date;
    }>(
      `SELECT * FROM audit_snapshots WHERE id = $1`,
      [snapshotId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0]!;
    return {
      snapshotId: row.id,
      projectId: row.project_id as ProjectId,
      root: row.root_hash,
      treeSize: BigInt(row.tree_size),
      timestamp: row.created_at,
    };
  }

  /**
   * List snapshots for a project
   */
  async listSnapshots(
    projectId: ProjectId,
    limit = 10
  ): Promise<AuditSnapshot[]> {
    const result = await query<{
      id: string;
      project_id: string;
      root_hash: string;
      tree_size: string;
      created_at: Date;
    }>(
      `SELECT * FROM audit_snapshots
       WHERE project_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [projectId, limit]
    );

    return result.rows.map((row) => ({
      snapshotId: row.id,
      projectId: row.project_id as ProjectId,
      root: row.root_hash,
      treeSize: BigInt(row.tree_size),
      timestamp: row.created_at,
    }));
  }

  /**
   * Export proof bundle for offline verification
   */
  async exportProofBundle(entryIds: string[]): Promise<{
    entries: Array<{
      id: string;
      hash: string;
      proof: InclusionProof;
    }>;
    currentRoot: string;
    exportedAt: Date;
    verificationInstructions: string;
  }> {
    const veilchain = getVeilChainClient();
    const currentRoot = await veilchain.getRootHash();

    const entries = await Promise.all(
      entryIds.map(async (id) => {
        const entry = await veilchain.getEntry(id);
        const proof = await this.generateInclusionProof(id);
        return {
          id,
          hash: entry.hash,
          proof,
        };
      })
    );

    return {
      entries,
      currentRoot,
      exportedAt: new Date(),
      verificationInstructions: `
To verify these proofs offline:
1. Hash each entry using SHA-256
2. For each proof, compute the path from leaf to root
3. Compare computed root with the currentRoot
4. Verify the currentRoot against VeilChain's public root

All proofs can be verified using: veilchain verify-bundle <file>
      `.trim(),
    };
  }

  /**
   * Compute sibling directions for Merkle proof
   */
  private computeDirections(index: number, treeSize: number): ('left' | 'right')[] {
    const directions: ('left' | 'right')[] = [];
    let n = treeSize;
    let i = index;

    while (n > 1) {
      directions.push(i % 2 === 0 ? 'right' : 'left');
      i = Math.floor(i / 2);
      n = Math.floor((n + 1) / 2);
    }

    return directions;
  }

  /**
   * Get current tree state
   */
  async getTreeState(): Promise<{
    root: string;
    treeSize: bigint;
    lastEntryId: string | null;
  }> {
    const veilchain = getVeilChainClient();

    const root = await veilchain.getRootHash();
    const treeSize = await veilchain.getTreeSize();
    const lastEntry = await veilchain.getLatestEntry();

    return {
      root,
      treeSize,
      lastEntryId: lastEntry?.entryId ?? null,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

let proofService: ProofService | null = null;

export function getProofService(): ProofService {
  if (!proofService) {
    proofService = new ProofService();
  }
  return proofService;
}
