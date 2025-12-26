/**
 * VeilCloud SDK Client
 * TypeScript client for VeilCloud API
 *
 * Usage:
 * ```typescript
 * import { VeilCloudClient } from '@veilcloud/sdk';
 *
 * const client = new VeilCloudClient({
 *   baseUrl: 'https://api.veilcloud.io',
 *   credential: myCredential,
 *   signature: mySignature,
 * });
 *
 * // Store encrypted data
 * await client.storage.put('my-project', 'production', {
 *   data: encryptedBase64,
 * });
 *
 * // Retrieve encrypted data
 * const blob = await client.storage.get('my-project', 'production');
 * ```
 */

import type {
  EncryptedBlob,
  StoragePutRequest,
  StorageGetResponse,
  Project,
  Team,
  AuditEntry,
  AuditQuery,
  MerkleProof,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface VeilCloudClientConfig {
  /** VeilCloud API base URL */
  baseUrl: string;
  /** VeilSign credential (base64) */
  credential?: string;
  /** VeilSign signature (base64) */
  signature?: string;
  /** Request timeout in ms */
  timeout?: number;
  /** Max retries on failure */
  maxRetries?: number;
}

export interface StorageListResult {
  blobs: EncryptedBlob[];
  continuationToken?: string;
  hasMore: boolean;
}

// ============================================================================
// Client
// ============================================================================

export class VeilCloudClient {
  private readonly config: Required<VeilCloudClientConfig>;

  public readonly storage: StorageClient;
  public readonly projects: ProjectsClient;
  public readonly teams: TeamsClient;
  public readonly audit: AuditClient;

  constructor(config: VeilCloudClientConfig) {
    this.config = {
      baseUrl: config.baseUrl.replace(/\/$/, ''),
      credential: config.credential ?? '',
      signature: config.signature ?? '',
      timeout: config.timeout ?? 30000,
      maxRetries: config.maxRetries ?? 3,
    };

    this.storage = new StorageClient(this);
    this.projects = new ProjectsClient(this);
    this.teams = new TeamsClient(this);
    this.audit = new AuditClient(this);
  }

  /**
   * Update credentials
   */
  setCredentials(credential: string, signature: string): void {
    this.config.credential = credential;
    this.config.signature = signature;
  }

  /**
   * Make authenticated request
   */
  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.config.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(this.config.credential && {
              'X-VeilCloud-Credential': this.config.credential,
              'X-VeilCloud-Signature': this.config.signature,
            }),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = await response.json().catch(() => ({
            code: 'UNKNOWN',
            message: response.statusText,
          }));
          throw new VeilCloudAPIError(error.code, error.message, response.status);
        }

        // Handle 204 No Content
        if (response.status === 204) {
          return undefined as T;
        }

        return response.json() as Promise<T>;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Don't retry on client errors (4xx)
        if (error instanceof VeilCloudAPIError && error.status < 500) {
          throw error;
        }

        // Wait before retry (exponential backoff)
        if (attempt < this.config.maxRetries - 1) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }
    }

    throw lastError ?? new Error('Request failed');
  }

  /**
   * Health check
   */
  async health(): Promise<{ status: string; version: string }> {
    return this.request('GET', '/health');
  }
}

// ============================================================================
// Sub-Clients
// ============================================================================

class StorageClient {
  constructor(private readonly client: VeilCloudClient) {}

  async put(
    projectId: string,
    envName: string,
    request: StoragePutRequest
  ): Promise<EncryptedBlob> {
    const response = await this.client.request<{ blob: EncryptedBlob }>(
      'PUT',
      `/v1/storage/${projectId}/${envName}`,
      request
    );
    return response.blob;
  }

  async get(projectId: string, envName: string): Promise<StorageGetResponse> {
    return this.client.request('GET', `/v1/storage/${projectId}/${envName}`);
  }

  async delete(projectId: string, envName: string): Promise<void> {
    await this.client.request('DELETE', `/v1/storage/${projectId}/${envName}`);
  }

  async list(projectId: string, continuationToken?: string): Promise<StorageListResult> {
    const query = continuationToken ? `?continuationToken=${continuationToken}` : '';
    return this.client.request('GET', `/v1/storage/${projectId}${query}`);
  }

  async exists(projectId: string, envName: string): Promise<boolean> {
    try {
      await this.client.request('HEAD', `/v1/storage/${projectId}/${envName}`);
      return true;
    } catch (error) {
      if (error instanceof VeilCloudAPIError && error.status === 404) {
        return false;
      }
      throw error;
    }
  }
}

class ProjectsClient {
  constructor(private readonly client: VeilCloudClient) {}

  async create(name: string, description?: string): Promise<Project> {
    return this.client.request('POST', '/v1/projects', { name, description });
  }

  async get(projectId: string): Promise<Project> {
    return this.client.request('GET', `/v1/projects/${projectId}`);
  }

  async list(): Promise<Project[]> {
    const response = await this.client.request<{ projects: Project[] }>('GET', '/v1/projects');
    return response.projects;
  }

  async delete(projectId: string): Promise<void> {
    await this.client.request('DELETE', `/v1/projects/${projectId}`);
  }
}

class TeamsClient {
  constructor(private readonly client: VeilCloudClient) {}

  async create(
    name: string,
    threshold: number,
    memberEmails: string[]
  ): Promise<Team> {
    return this.client.request('POST', '/v1/teams', {
      name,
      threshold,
      memberEmails,
    });
  }

  async get(teamId: string): Promise<Team> {
    return this.client.request('GET', `/v1/teams/${teamId}`);
  }

  async addMember(teamId: string, email: string): Promise<void> {
    await this.client.request('POST', `/v1/teams/${teamId}/members`, { email });
  }

  async removeMember(teamId: string, userId: string): Promise<void> {
    await this.client.request('DELETE', `/v1/teams/${teamId}/members/${userId}`);
  }
}

class AuditClient {
  constructor(private readonly client: VeilCloudClient) {}

  async getTrail(projectId: string, query?: AuditQuery): Promise<AuditEntry[]> {
    const params = new URLSearchParams();
    if (query?.action) params.set('action', query.action);
    if (query?.userId) params.set('userId', query.userId);
    if (query?.limit) params.set('limit', String(query.limit));
    if (query?.offset) params.set('offset', String(query.offset));

    const queryString = params.toString();
    const path = `/v1/audit/${projectId}${queryString ? `?${queryString}` : ''}`;

    const response = await this.client.request<{ entries: AuditEntry[] }>('GET', path);
    return response.entries;
  }

  async getProof(projectId: string, entryId: string): Promise<MerkleProof> {
    const response = await this.client.request<{ proof: MerkleProof }>(
      'GET',
      `/v1/audit/${projectId}/proof/${entryId}`
    );
    return response.proof;
  }

  async verifyProof(proof: MerkleProof): Promise<boolean> {
    const response = await this.client.request<{ valid: boolean }>(
      'POST',
      '/v1/audit/verify',
      { proof }
    );
    return response.valid;
  }
}

// ============================================================================
// Error
// ============================================================================

export class VeilCloudAPIError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = 'VeilCloudAPIError';
  }
}
