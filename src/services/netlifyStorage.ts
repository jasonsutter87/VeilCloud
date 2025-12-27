/**
 * Netlify Blobs Storage Service
 *
 * Lightweight storage option for edge deployments and Netlify hosting.
 * Set STORAGE_TYPE=netlify
 *
 * @see https://docs.netlify.com/blobs/overview/
 */

import { createHash } from 'crypto';

import { StorageError, BlobNotFoundError, ValidationError } from '../lib/errors.js';
import type {
  EncryptedBlob,
  StoragePutRequest,
  StorageGetResponse,
  ProjectId,
} from '../types.js';
import type { StorageListResult } from './storage.js';

// ============================================================================
// Configuration
// ============================================================================

export interface NetlifyStorageConfig {
  siteId?: string;
  token?: string;
  storeName: string;
}

export function getNetlifyStorageConfig(): NetlifyStorageConfig {
  return {
    siteId: process.env.NETLIFY_SITE_ID,
    token: process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN,
    storeName: process.env.NETLIFY_BLOBS_STORE || 'veilcloud',
  };
}

// ============================================================================
// Netlify Blobs Client (Edge Runtime Compatible)
// ============================================================================

interface BlobMetadata {
  key: string;
  size: number;
  hash: string;
  metadata?: string;
  contentType: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Simple Netlify Blobs client
 * Works in both Node.js and edge runtimes
 */
class NetlifyBlobsClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly storeName: string;

  constructor(config: NetlifyStorageConfig) {
    this.storeName = config.storeName;

    // In Netlify Functions/Edge, use the built-in context
    // Otherwise, use the REST API
    if (process.env.NETLIFY && !config.token) {
      // Running in Netlify environment - use local API
      this.baseUrl = `/.netlify/blobs/${this.storeName}`;
      this.headers = {};
    } else {
      // External access - use REST API
      const siteId = config.siteId;
      if (!siteId || !config.token) {
        throw new StorageError(
          'NETLIFY_SITE_ID and NETLIFY_BLOBS_TOKEN required for external access'
        );
      }
      this.baseUrl = `https://api.netlify.com/api/v1/blobs/${siteId}/${this.storeName}`;
      this.headers = {
        Authorization: `Bearer ${config.token}`,
      };
    }
  }

  private getKey(projectId: string, envName: string): string {
    return `projects/${projectId}/envs/${envName}`;
  }

  async put(
    key: string,
    data: Buffer,
    metadata?: Record<string, string>
  ): Promise<void> {
    const url = `${this.baseUrl}/${encodeURIComponent(key)}`;

    const headers: Record<string, string> = {
      ...this.headers,
      'Content-Type': 'application/octet-stream',
    };

    // Netlify Blobs supports metadata via headers
    if (metadata) {
      headers['x-amz-meta-veilcloud'] = JSON.stringify(metadata);
    }

    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: data,
    });

    if (!response.ok) {
      throw new StorageError(`Failed to put blob: ${response.statusText}`);
    }
  }

  async get(key: string): Promise<{ data: Buffer; metadata?: Record<string, string> } | null> {
    const url = `${this.baseUrl}/${encodeURIComponent(key)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: this.headers,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new StorageError(`Failed to get blob: ${response.statusText}`);
    }

    const data = Buffer.from(await response.arrayBuffer());
    const metadataHeader = response.headers.get('x-amz-meta-veilcloud');
    const metadata = metadataHeader ? JSON.parse(metadataHeader) : undefined;

    return { data, metadata };
  }

  async delete(key: string): Promise<void> {
    const url = `${this.baseUrl}/${encodeURIComponent(key)}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: this.headers,
    });

    // 404 is fine for delete
    if (!response.ok && response.status !== 404) {
      throw new StorageError(`Failed to delete blob: ${response.statusText}`);
    }
  }

  async head(key: string): Promise<{ size: number; metadata?: Record<string, string> } | null> {
    const url = `${this.baseUrl}/${encodeURIComponent(key)}`;

    const response = await fetch(url, {
      method: 'HEAD',
      headers: this.headers,
    });

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new StorageError(`Failed to head blob: ${response.statusText}`);
    }

    const size = parseInt(response.headers.get('content-length') || '0', 10);
    const metadataHeader = response.headers.get('x-amz-meta-veilcloud');
    const metadata = metadataHeader ? JSON.parse(metadataHeader) : undefined;

    return { size, metadata };
  }

  async list(prefix: string): Promise<string[]> {
    const url = `${this.baseUrl}?prefix=${encodeURIComponent(prefix)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...this.headers,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new StorageError(`Failed to list blobs: ${response.statusText}`);
    }

    const result = await response.json() as { blobs?: Array<{ key: string }> };
    return (result.blobs || []).map((b) => b.key);
  }
}

// ============================================================================
// Netlify Storage Service
// ============================================================================

export class NetlifyStorageService {
  private readonly client: NetlifyBlobsClient;
  private readonly metadataCache: Map<string, BlobMetadata> = new Map();

  constructor(config?: NetlifyStorageConfig) {
    this.client = new NetlifyBlobsClient(config || getNetlifyStorageConfig());
  }

  /**
   * Get blob key for a project/env
   */
  private getBlobKey(projectId: ProjectId, envName: string): string {
    return `projects/${projectId}/envs/${envName}/blob`;
  }

  /**
   * Get metadata key for a project/env
   */
  private getMetadataKey(projectId: ProjectId, envName: string): string {
    return `projects/${projectId}/envs/${envName}/metadata`;
  }

  /**
   * Store encrypted blob
   */
  async put(
    projectId: ProjectId,
    envName: string,
    request: StoragePutRequest
  ): Promise<EncryptedBlob> {
    if (!request.data) {
      throw new ValidationError('Data is required');
    }

    const blobKey = this.getBlobKey(projectId, envName);
    const metadataKey = this.getMetadataKey(projectId, envName);

    // Decode base64 to get actual bytes
    const dataBuffer = Buffer.from(request.data, 'base64');
    const hash = createHash('sha256').update(dataBuffer).digest('hex');

    try {
      // Store blob data
      await this.client.put(blobKey, dataBuffer);

      // Store metadata separately (Netlify Blobs metadata has size limits)
      const metadata: BlobMetadata = {
        key: blobKey,
        size: dataBuffer.length,
        hash,
        metadata: request.metadata,
        contentType: request.contentType ?? 'application/octet-stream',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await this.client.put(
        metadataKey,
        Buffer.from(JSON.stringify(metadata)),
        { type: 'metadata' }
      );

      // Cache metadata
      this.metadataCache.set(`${projectId}/${envName}`, metadata);

      return {
        key: metadata.key,
        size: metadata.size,
        hash,
        metadata: request.metadata,
        createdAt: new Date(metadata.createdAt),
        updatedAt: new Date(metadata.updatedAt),
      };
    } catch (error) {
      throw new StorageError(
        `Failed to store blob: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectId, envName }
      );
    }
  }

  /**
   * Retrieve encrypted blob
   */
  async get(projectId: ProjectId, envName: string): Promise<StorageGetResponse> {
    const blobKey = this.getBlobKey(projectId, envName);
    const metadataKey = this.getMetadataKey(projectId, envName);

    try {
      // Get blob data
      const result = await this.client.get(blobKey);
      if (!result) {
        throw new BlobNotFoundError(blobKey);
      }

      // Get metadata
      let metadata: BlobMetadata | undefined;
      const metadataResult = await this.client.get(metadataKey);
      if (metadataResult) {
        metadata = JSON.parse(metadataResult.data.toString());
      }

      return {
        data: result.data.toString('base64'),
        metadata: metadata?.metadata,
        contentType: metadata?.contentType ?? 'application/octet-stream',
        size: result.data.length,
        version: 1,
      };
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        throw error;
      }
      throw new StorageError(
        `Failed to retrieve blob: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectId, envName }
      );
    }
  }

  /**
   * Delete encrypted blob
   */
  async delete(projectId: ProjectId, envName: string): Promise<void> {
    const blobKey = this.getBlobKey(projectId, envName);
    const metadataKey = this.getMetadataKey(projectId, envName);

    try {
      await Promise.all([
        this.client.delete(blobKey),
        this.client.delete(metadataKey),
      ]);
      this.metadataCache.delete(`${projectId}/${envName}`);
    } catch (error) {
      throw new StorageError(
        `Failed to delete blob: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectId, envName }
      );
    }
  }

  /**
   * Check if blob exists
   */
  async exists(projectId: ProjectId, envName: string): Promise<boolean> {
    const blobKey = this.getBlobKey(projectId, envName);
    const result = await this.client.head(blobKey);
    return result !== null;
  }

  /**
   * Get blob metadata without downloading content
   */
  async getMetadata(projectId: ProjectId, envName: string): Promise<EncryptedBlob | null> {
    // Check cache first
    const cached = this.metadataCache.get(`${projectId}/${envName}`);
    if (cached) {
      return {
        key: cached.key,
        size: cached.size,
        hash: cached.hash,
        metadata: cached.metadata,
        createdAt: new Date(cached.createdAt),
        updatedAt: new Date(cached.updatedAt),
      };
    }

    const metadataKey = this.getMetadataKey(projectId, envName);

    try {
      const result = await this.client.get(metadataKey);
      if (!result) {
        return null;
      }

      const metadata: BlobMetadata = JSON.parse(result.data.toString());
      this.metadataCache.set(`${projectId}/${envName}`, metadata);

      return {
        key: metadata.key,
        size: metadata.size,
        hash: metadata.hash,
        metadata: metadata.metadata,
        createdAt: new Date(metadata.createdAt),
        updatedAt: new Date(metadata.updatedAt),
      };
    } catch {
      return null;
    }
  }

  /**
   * List all blobs for a project
   */
  async listByProject(
    projectId: ProjectId,
    _continuationToken?: string
  ): Promise<StorageListResult> {
    const prefix = `projects/${projectId}/envs/`;

    try {
      const keys = await this.client.list(prefix);

      // Filter to just blob keys (not metadata)
      const blobKeys = keys.filter((k) => k.endsWith('/blob'));

      // Extract env names and get metadata
      const blobs: EncryptedBlob[] = [];
      for (const key of blobKeys) {
        // Extract envName from key: projects/{projectId}/envs/{envName}/blob
        const match = key.match(/projects\/[^/]+\/envs\/([^/]+)\/blob/);
        if (match) {
          const envName = match[1];
          const metadata = await this.getMetadata(projectId, envName);
          if (metadata) {
            blobs.push(metadata);
          }
        }
      }

      return {
        blobs,
        hasMore: false, // Netlify Blobs doesn't have pagination in basic API
      };
    } catch (error) {
      throw new StorageError(
        `Failed to list blobs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectId }
      );
    }
  }

  /**
   * Delete all blobs for a project
   */
  async deleteByProject(projectId: ProjectId): Promise<number> {
    try {
      const result = await this.listByProject(projectId);
      const count = result.blobs.length;

      // Delete each blob
      for (const blob of result.blobs) {
        // Extract envName from key
        const match = blob.key.match(/projects\/[^/]+\/envs\/([^/]+)\/blob/);
        if (match) {
          await this.delete(projectId, match[1]);
        }
      }

      return count;
    } catch {
      return 0;
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let netlifyStorageService: NetlifyStorageService | null = null;

export function getNetlifyStorageService(): NetlifyStorageService {
  if (!netlifyStorageService) {
    netlifyStorageService = new NetlifyStorageService();
  }
  return netlifyStorageService;
}
