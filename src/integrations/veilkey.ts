/**
 * VeilKey Integration
 * Threshold cryptography for team key management
 */

import { config } from '../lib/config.js';
import { VeilKeyError, ThresholdNotMetError } from '../lib/errors.js';
import type { TeamId, UserId } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export type Algorithm = 'RSA-2048' | 'RSA-4096';

export interface KeyGroup {
  id: string;
  publicKey: string;
  algorithm: Algorithm;
  threshold: number;
  parties: number;
  createdAt: Date;
}

export interface Share {
  index: number;
  value: string;
  verificationKey: string;
}

export interface PartialSignature {
  index: number;
  partial: string;
}

export interface PartialDecryption {
  index: number;
  partial: string;
}

export interface CreateTeamKeyRequest {
  teamId: TeamId;
  threshold: number;
  totalMembers: number;
  algorithm?: Algorithm;
}

export interface CreateTeamKeyResponse {
  keyGroup: KeyGroup;
  shares: Share[];
}

export interface DistributeShareRequest {
  teamId: TeamId;
  userId: UserId;
  shareIndex: number;
  encryptedShare: string; // Share encrypted with user's public key
}

// ============================================================================
// VeilKey Client
// ============================================================================

export class VeilKeyClient {
  private readonly baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? config.integrations.veilkeyUrl ?? 'http://localhost:3002';
  }

  /**
   * Generate a threshold key group for a team
   */
  async generateTeamKey(request: CreateTeamKeyRequest): Promise<CreateTeamKeyResponse> {
    const response = await this.request('POST', '/v1/keys/generate', {
      groupId: request.teamId,
      threshold: request.threshold,
      parties: request.totalMembers,
      algorithm: request.algorithm ?? 'RSA-2048',
    });

    return {
      keyGroup: {
        id: response.id,
        publicKey: response.publicKey,
        algorithm: response.algorithm,
        threshold: response.threshold,
        parties: response.parties,
        createdAt: new Date(response.createdAt),
      },
      shares: response.shares,
    };
  }

  /**
   * Get key group info (public key, threshold, etc.)
   */
  async getKeyGroup(groupId: string): Promise<KeyGroup | null> {
    try {
      const response = await this.request('GET', `/v1/keys/${groupId}`);
      return {
        id: response.id,
        publicKey: response.publicKey,
        algorithm: response.algorithm,
        threshold: response.threshold,
        parties: response.parties,
        createdAt: new Date(response.createdAt),
      };
    } catch (error) {
      if (error instanceof VeilKeyError && error.details?.['status'] === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Encrypt data with a team's public key
   * Returns encrypted data that requires threshold decryption
   */
  async encrypt(groupId: string, plaintext: string): Promise<string> {
    const response = await this.request('POST', `/v1/keys/${groupId}/encrypt`, {
      plaintext,
    });
    return response.ciphertext;
  }

  /**
   * Create a partial decryption using a member's share
   */
  async partialDecrypt(
    groupId: string,
    ciphertext: string,
    shareIndex: number,
    shareValue: string
  ): Promise<PartialDecryption> {
    const response = await this.request('POST', `/v1/keys/${groupId}/partial-decrypt`, {
      ciphertext,
      shareIndex,
      shareValue,
    });

    return {
      index: response.index,
      partial: response.partial,
    };
  }

  /**
   * Combine partial decryptions to recover plaintext
   * Requires at least `threshold` partials
   */
  async combineDecryptions(
    groupId: string,
    ciphertext: string,
    partials: PartialDecryption[]
  ): Promise<string> {
    const keyGroup = await this.getKeyGroup(groupId);
    if (!keyGroup) {
      throw new VeilKeyError(`Key group not found: ${groupId}`);
    }

    if (partials.length < keyGroup.threshold) {
      throw new ThresholdNotMetError(keyGroup.threshold, partials.length);
    }

    const response = await this.request('POST', `/v1/keys/${groupId}/combine-decrypt`, {
      ciphertext,
      partials,
    });

    return response.plaintext;
  }

  /**
   * Create a partial signature using a member's share
   */
  async partialSign(
    groupId: string,
    message: string,
    shareIndex: number,
    shareValue: string
  ): Promise<PartialSignature> {
    const response = await this.request('POST', `/v1/keys/${groupId}/partial-sign`, {
      message,
      shareIndex,
      shareValue,
    });

    return {
      index: response.index,
      partial: response.partial,
    };
  }

  /**
   * Combine partial signatures into a full signature
   * Requires at least `threshold` partials
   */
  async combineSignatures(
    groupId: string,
    message: string,
    partials: PartialSignature[]
  ): Promise<string> {
    const keyGroup = await this.getKeyGroup(groupId);
    if (!keyGroup) {
      throw new VeilKeyError(`Key group not found: ${groupId}`);
    }

    if (partials.length < keyGroup.threshold) {
      throw new ThresholdNotMetError(keyGroup.threshold, partials.length);
    }

    const response = await this.request('POST', `/v1/keys/${groupId}/combine-sign`, {
      message,
      partials,
    });

    return response.signature;
  }

  /**
   * Verify a signature against a key group's public key
   */
  async verify(groupId: string, message: string, signature: string): Promise<boolean> {
    const response = await this.request('POST', `/v1/keys/${groupId}/verify`, {
      message,
      signature,
    });
    return response.valid;
  }

  /**
   * Refresh shares without changing the public key (proactive security)
   */
  async refreshShares(groupId: string): Promise<Share[]> {
    const response = await this.request('POST', `/v1/keys/${groupId}/refresh`);
    return response.shares;
  }

  // ============================================================================
  // HTTP Client
  // ============================================================================

  private async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        throw new VeilKeyError(error.message ?? 'VeilKey request failed', {
          status: response.status,
          path,
        });
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof VeilKeyError) throw error;
      throw new VeilKeyError(
        error instanceof Error ? error.message : 'VeilKey connection failed',
        { path }
      );
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let veilKeyClient: VeilKeyClient | null = null;

export function getVeilKeyClient(): VeilKeyClient {
  if (!veilKeyClient) {
    veilKeyClient = new VeilKeyClient();
  }
  return veilKeyClient;
}
