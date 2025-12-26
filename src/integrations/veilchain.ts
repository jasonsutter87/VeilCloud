/**
 * VeilChain Integration
 * Immutable audit logging with Merkle proofs
 */

import { config } from '../lib/config.js';
import { VeilChainError } from '../lib/errors.js';
import type { AuditEntry, AuditAction, AuditQuery, MerkleProof, UserId, ProjectId, TeamId } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface LedgerInfo {
  id: string;
  name: string;
  rootHash: string;
  entryCount: bigint;
  createdAt: Date;
}

export interface AppendResult {
  entryId: string;
  position: bigint;
  hash: string;
  proof: MerkleProof;
  previousRoot: string;
  newRoot: string;
}

export interface AuditLogRequest {
  action: AuditAction;
  userId: UserId;
  projectId?: ProjectId;
  teamId?: TeamId;
  context?: Record<string, unknown>;
  ipAddress?: string;
}

// ============================================================================
// VeilChain Client
// ============================================================================

export class VeilChainClient {
  private readonly baseUrl: string;
  private ledgerId: string | null = null;
  private apiKey: string | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? config.integrations.veilchainUrl ?? 'http://localhost:3003';
  }

  /**
   * Initialize with VeilChain ledger credentials
   */
  async init(ledgerId: string, apiKey: string): Promise<void> {
    this.ledgerId = ledgerId;
    this.apiKey = apiKey;
  }

  /**
   * Create a new audit ledger for VeilCloud
   */
  async createLedger(name: string, description?: string): Promise<{
    ledger: LedgerInfo;
    apiKey: string;
  }> {
    const response = await this.request('POST', '/v1/ledgers', {
      name,
      description,
    });

    return {
      ledger: {
        id: response.id,
        name: response.name,
        rootHash: response.rootHash,
        entryCount: BigInt(response.entryCount),
        createdAt: new Date(response.createdAt),
      },
      apiKey: response.apiKey,
    };
  }

  /**
   * Get ledger info
   */
  async getLedger(ledgerId?: string): Promise<LedgerInfo | null> {
    const id = ledgerId ?? this.ledgerId;
    if (!id) {
      throw new VeilChainError('Ledger ID not specified');
    }

    try {
      const response = await this.request('GET', `/v1/ledgers/${id}`);
      return {
        id: response.id,
        name: response.name,
        rootHash: response.rootHash,
        entryCount: BigInt(response.entryCount),
        createdAt: new Date(response.createdAt),
      };
    } catch (error) {
      if (error instanceof VeilChainError && error.details?.['status'] === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Log an audit event (immutable append)
   */
  async log(request: AuditLogRequest): Promise<AppendResult> {
    if (!this.ledgerId || !this.apiKey) {
      throw new VeilChainError('VeilChain client not initialized');
    }

    const entry = {
      action: request.action,
      userId: request.userId,
      projectId: request.projectId,
      teamId: request.teamId,
      context: request.context,
      ipAddress: request.ipAddress,
      timestamp: new Date().toISOString(),
    };

    const response = await this.request(
      'POST',
      `/v1/ledgers/${this.ledgerId}/entries`,
      { data: entry },
      { Authorization: `Bearer ${this.apiKey}` }
    );

    return {
      entryId: response.entry.id,
      position: BigInt(response.entry.position),
      hash: response.entry.hash,
      proof: response.proof,
      previousRoot: response.previousRoot,
      newRoot: response.newRoot,
    };
  }

  /**
   * Get audit entries with optional filtering
   */
  async getAuditTrail(query: AuditQuery = {}): Promise<{
    entries: AuditEntry[];
    total: number;
    hasMore: boolean;
  }> {
    if (!this.ledgerId) {
      throw new VeilChainError('VeilChain client not initialized');
    }

    const params = new URLSearchParams();
    if (query.projectId) params.set('projectId', query.projectId);
    if (query.userId) params.set('userId', query.userId);
    if (query.action) params.set('action', query.action);
    if (query.startDate) params.set('startDate', query.startDate.toISOString());
    if (query.endDate) params.set('endDate', query.endDate.toISOString());
    if (query.limit) params.set('limit', String(query.limit));
    if (query.offset) params.set('offset', String(query.offset));

    const queryString = params.toString();
    const path = `/v1/ledgers/${this.ledgerId}/entries${queryString ? `?${queryString}` : ''}`;

    const response = await this.request('GET', path);

    return {
      entries: response.entries.map((e: Record<string, unknown>) => ({
        entryId: e['id'],
        position: BigInt(e['position'] as string),
        action: e['data']?.['action'] as AuditAction,
        userId: e['data']?.['userId'] as string,
        projectId: e['data']?.['projectId'] as string | undefined,
        teamId: e['data']?.['teamId'] as string | undefined,
        context: e['data']?.['context'] as Record<string, unknown> | undefined,
        ipAddress: e['data']?.['ipAddress'] as string | undefined,
        timestamp: new Date(e['createdAt'] as string),
      })),
      total: response.total,
      hasMore: response.hasMore,
    };
  }

  /**
   * Get cryptographic proof for an audit entry
   */
  async getProof(entryId: string): Promise<MerkleProof> {
    if (!this.ledgerId) {
      throw new VeilChainError('VeilChain client not initialized');
    }

    const response = await this.request(
      'GET',
      `/v1/ledgers/${this.ledgerId}/proof/${entryId}`
    );

    return {
      leaf: response.proof.leaf,
      index: response.proof.index,
      proof: response.proof.proof,
      directions: response.proof.directions,
      root: response.proof.root,
    };
  }

  /**
   * Verify a proof (can be done offline with just the proof)
   */
  async verifyProof(proof: MerkleProof): Promise<boolean> {
    const response = await this.request('POST', '/v1/verify', { proof });
    return response.valid;
  }

  /**
   * Get current root hash
   */
  async getRootHash(): Promise<string> {
    if (!this.ledgerId) {
      throw new VeilChainError('VeilChain client not initialized');
    }

    const response = await this.request('GET', `/v1/ledgers/${this.ledgerId}/root`);
    return response.root;
  }

  // ============================================================================
  // HTTP Client
  // ============================================================================

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new VeilChainError(error.message ?? 'VeilChain request failed', {
          status: response.status,
          path,
        });
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof VeilChainError) throw error;
      throw new VeilChainError(
        error instanceof Error ? error.message : 'VeilChain connection failed',
        { path }
      );
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let veilChainClient: VeilChainClient | null = null;

export function getVeilChainClient(): VeilChainClient {
  if (!veilChainClient) {
    veilChainClient = new VeilChainClient();
  }
  return veilChainClient;
}

export function initVeilChain(ledgerId: string, apiKey: string): Promise<void> {
  return getVeilChainClient().init(ledgerId, apiKey);
}
