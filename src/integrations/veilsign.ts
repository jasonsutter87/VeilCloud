/**
 * VeilSign Integration
 * Privacy-preserving credential verification using blind signatures
 */

import { config } from '../lib/config.js';
import { VeilSignError } from '../lib/errors.js';
import type { AccessCredential, Permission, UserId, ProjectId } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface VeilSignCredential {
  version: '1.0';
  type: string;
  claims: Record<string, unknown>;
  issuedAt: number;
  expiresAt: number;
  issuer: string;
  nonce: string;
}

export interface VeilSignAuthority {
  id: string;
  name: string;
  publicKey: string;
  fingerprint: string;
}

export interface BlindedMessage {
  blinded: string;
  blindingFactor: string;
}

export interface IssueCredentialRequest {
  userId: UserId;
  projectId: ProjectId | '*';
  permissions: Permission[];
  expiresInSeconds?: number;
}

export interface VerifyCredentialRequest {
  credential: string; // base64
  signature: string; // base64
}

export interface VerifyCredentialResponse {
  valid: boolean;
  credential?: VeilSignCredential;
  error?: string;
}

// ============================================================================
// VeilSign Client
// ============================================================================

export class VeilSignClient {
  private readonly baseUrl: string;
  private authorityId: string | null = null;
  private apiKey: string | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl ?? config.integrations.veilsignUrl ?? 'http://localhost:3001';
  }

  /**
   * Initialize with VeilSign authority credentials
   */
  async init(authorityId: string, apiKey: string): Promise<void> {
    this.authorityId = authorityId;
    this.apiKey = apiKey;
  }

  /**
   * Create a new authority for VeilCloud
   */
  async createAuthority(name: string, description?: string): Promise<{
    authority: VeilSignAuthority;
    apiKey: string;
  }> {
    const response = await this.request('POST', '/v1/authorities', {
      name,
      description,
      keyBits: 2048,
    });

    return {
      authority: response.authority,
      apiKey: response.apiKey,
    };
  }

  /**
   * Issue a credential for a user with specific permissions
   */
  async issueCredential(request: IssueCredentialRequest): Promise<{
    credential: string;
    signature: string;
    expiresAt: Date;
  }> {
    if (!this.authorityId || !this.apiKey) {
      throw new VeilSignError('VeilSign client not initialized');
    }

    const expiresInSeconds = request.expiresInSeconds ?? 86400; // 24 hours default
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    // Create credential structure
    const credential: VeilSignCredential = {
      version: '1.0',
      type: 'veilcloud-access',
      claims: {
        userId: request.userId,
        projectId: request.projectId,
        permissions: request.permissions,
      },
      issuedAt: Math.floor(Date.now() / 1000),
      expiresAt: Math.floor(expiresAt.getTime() / 1000),
      issuer: this.authorityId,
      nonce: crypto.randomUUID(),
    };

    // Issue credential via VeilSign
    const response = await this.request(
      'POST',
      `/v1/authorities/${this.authorityId}/issue`,
      { credential },
      { 'X-API-Key': this.apiKey }
    );

    return {
      credential: response.credential,
      signature: response.signature,
      expiresAt,
    };
  }

  /**
   * Verify a credential and signature
   */
  async verifyCredential(request: VerifyCredentialRequest): Promise<VerifyCredentialResponse> {
    if (!this.authorityId) {
      throw new VeilSignError('VeilSign client not initialized');
    }

    try {
      const response = await this.request('POST', '/v1/verify', {
        credential: request.credential,
        signature: request.signature,
        authorityId: this.authorityId,
      });

      return {
        valid: response.valid,
        credential: response.credential,
      };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  /**
   * Check if a nullifier has been used (prevents replay attacks)
   */
  async checkNullifier(nullifier: string, domain: string): Promise<boolean> {
    const response = await this.request('POST', '/v1/nullifiers/check', {
      nullifier,
      domain,
    });
    return response.used;
  }

  /**
   * Mark a nullifier as used
   */
  async useNullifier(nullifier: string, domain: string): Promise<void> {
    if (!this.apiKey) {
      throw new VeilSignError('VeilSign client not initialized');
    }

    await this.request(
      'POST',
      '/v1/nullifiers/use',
      { nullifier, domain },
      { 'X-API-Key': this.apiKey }
    );
  }

  /**
   * Generate a nullifier from credential secret and domain
   */
  async generateNullifier(credentialSecret: string, domain: string): Promise<string> {
    const response = await this.request('POST', '/v1/nullifiers/generate', {
      secret: credentialSecret,
      domain,
    });
    return response.nullifier;
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
        throw new VeilSignError(error.message ?? 'VeilSign request failed', {
          status: response.status,
          path,
        });
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof VeilSignError) throw error;
      throw new VeilSignError(
        error instanceof Error ? error.message : 'VeilSign connection failed',
        { path }
      );
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let veilSignClient: VeilSignClient | null = null;

export function getVeilSignClient(): VeilSignClient {
  if (!veilSignClient) {
    veilSignClient = new VeilSignClient();
  }
  return veilSignClient;
}

export function initVeilSign(authorityId: string, apiKey: string): Promise<void> {
  return getVeilSignClient().init(authorityId, apiKey);
}
