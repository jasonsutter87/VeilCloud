/**
 * Storage Service
 * S3/MinIO encrypted blob storage (ZK - server never sees plaintext)
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type _Object as S3Object,
} from '@aws-sdk/client-s3';
import { createHash } from 'crypto';

import { config } from '../lib/config.js';
import { StorageError, BlobNotFoundError, ValidationError } from '../lib/errors.js';
import type {
  EncryptedBlob,
  StoragePutRequest,
  StorageGetResponse,
  ProjectId,
} from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface StorageListResult {
  blobs: EncryptedBlob[];
  continuationToken?: string;
  hasMore: boolean;
}

// ============================================================================
// Storage Service
// ============================================================================

export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    this.client = new S3Client({
      endpoint: config.storage.endpoint,
      region: config.storage.region,
      credentials: {
        accessKeyId: config.storage.accessKeyId,
        secretAccessKey: config.storage.secretAccessKey,
      },
      forcePathStyle: config.storage.forcePathStyle,
    });
    this.bucket = config.storage.bucket;
  }

  /**
   * Generate S3 key for a blob
   * Format: projects/{projectId}/envs/{envName}/blob
   */
  private getBlobKey(projectId: ProjectId, envName: string): string {
    return `projects/${projectId}/envs/${envName}/blob`;
  }

  /**
   * Store encrypted blob
   * NOTE: Data must be encrypted client-side before calling this
   */
  async put(
    projectId: ProjectId,
    envName: string,
    request: StoragePutRequest
  ): Promise<EncryptedBlob> {
    const key = this.getBlobKey(projectId, envName);

    // Validate input
    if (!request.data) {
      throw new ValidationError('Data is required');
    }

    // Decode base64 to get actual bytes
    const dataBuffer = Buffer.from(request.data, 'base64');
    const hash = createHash('sha256').update(dataBuffer).digest('hex');

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: dataBuffer,
          ContentType: request.contentType ?? 'application/octet-stream',
          Metadata: {
            'x-veilcloud-hash': hash,
            'x-veilcloud-metadata': request.metadata ?? '',
          },
        })
      );

      return {
        key,
        size: dataBuffer.length,
        hash,
        metadata: request.metadata,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    } catch (error) {
      throw new StorageError(
        `Failed to store blob: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { key, projectId, envName }
      );
    }
  }

  /**
   * Retrieve encrypted blob
   * NOTE: Data is returned encrypted, client must decrypt
   */
  async get(projectId: ProjectId, envName: string): Promise<StorageGetResponse> {
    const key = this.getBlobKey(projectId, envName);

    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      if (!response.Body) {
        throw new BlobNotFoundError(key);
      }

      // Read stream to buffer
      const chunks: Uint8Array[] = [];
      const body = response.Body as AsyncIterable<Uint8Array>;
      for await (const chunk of body) {
        chunks.push(chunk);
      }
      const dataBuffer = Buffer.concat(chunks);

      return {
        data: dataBuffer.toString('base64'),
        metadata: response.Metadata?.['x-veilcloud-metadata'],
        contentType: response.ContentType ?? 'application/octet-stream',
        size: dataBuffer.length,
        version: 1, // TODO: implement versioning
      };
    } catch (error) {
      if (error instanceof BlobNotFoundError) throw error;

      // Check if it's a NotFound error from S3
      if ((error as { name?: string }).name === 'NoSuchKey') {
        throw new BlobNotFoundError(key);
      }

      throw new StorageError(
        `Failed to retrieve blob: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { key, projectId, envName }
      );
    }
  }

  /**
   * Delete encrypted blob
   */
  async delete(projectId: ProjectId, envName: string): Promise<void> {
    const key = this.getBlobKey(projectId, envName);

    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
    } catch (error) {
      throw new StorageError(
        `Failed to delete blob: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { key, projectId, envName }
      );
    }
  }

  /**
   * Check if blob exists
   */
  async exists(projectId: ProjectId, envName: string): Promise<boolean> {
    const key = this.getBlobKey(projectId, envName);

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') {
        return false;
      }
      throw new StorageError(
        `Failed to check blob existence: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { key, projectId, envName }
      );
    }
  }

  /**
   * Get blob metadata without downloading content
   */
  async getMetadata(projectId: ProjectId, envName: string): Promise<EncryptedBlob | null> {
    const key = this.getBlobKey(projectId, envName);

    try {
      const response = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      return {
        key,
        size: response.ContentLength ?? 0,
        hash: response.Metadata?.['x-veilcloud-hash'] ?? '',
        metadata: response.Metadata?.['x-veilcloud-metadata'],
        createdAt: response.LastModified ?? new Date(),
        updatedAt: response.LastModified ?? new Date(),
      };
    } catch (error) {
      if ((error as { name?: string }).name === 'NotFound') {
        return null;
      }
      throw new StorageError(
        `Failed to get blob metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { key, projectId, envName }
      );
    }
  }

  /**
   * List all blobs for a project
   */
  async listByProject(
    projectId: ProjectId,
    continuationToken?: string
  ): Promise<StorageListResult> {
    const prefix = `projects/${projectId}/envs/`;

    try {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          MaxKeys: 100,
          ContinuationToken: continuationToken,
        })
      );

      const blobs: EncryptedBlob[] = (response.Contents ?? []).map((obj: S3Object) => ({
        key: obj.Key ?? '',
        size: obj.Size ?? 0,
        hash: '', // Not available in list
        createdAt: obj.LastModified ?? new Date(),
        updatedAt: obj.LastModified ?? new Date(),
      }));

      return {
        blobs,
        continuationToken: response.NextContinuationToken,
        hasMore: response.IsTruncated ?? false,
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
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const result = await this.listByProject(projectId, continuationToken);

      for (const blob of result.blobs) {
        try {
          await this.client.send(
            new DeleteObjectCommand({
              Bucket: this.bucket,
              Key: blob.key,
            })
          );
          deleted++;
        } catch {
          // Log but continue deleting others
        }
      }

      continuationToken = result.continuationToken;
    } while (continuationToken);

    return deleted;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let storageService: StorageService | null = null;

export function getStorageService(): StorageService {
  if (!storageService) {
    storageService = new StorageService();
  }
  return storageService;
}
