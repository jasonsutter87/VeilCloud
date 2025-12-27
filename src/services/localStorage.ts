/**
 * Local Filesystem Storage Service
 *
 * Drop-in replacement for S3 storage during development/testing.
 * Set STORAGE_TYPE=local and STORAGE_LOCAL_PATH=/your/path
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { join, dirname } from 'path';

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

export interface LocalStorageConfig {
  basePath: string;
}

export function getLocalStorageConfig(): LocalStorageConfig {
  const basePath = process.env.STORAGE_LOCAL_PATH || './data/storage';
  return { basePath };
}

// ============================================================================
// Local Storage Service
// ============================================================================

export class LocalStorageService {
  private readonly basePath: string;

  constructor(config?: LocalStorageConfig) {
    this.basePath = config?.basePath || getLocalStorageConfig().basePath;
  }

  /**
   * Get file path for a blob
   */
  private getBlobPath(projectId: ProjectId, envName: string): string {
    return join(this.basePath, 'projects', projectId, 'envs', envName, 'blob');
  }

  /**
   * Get metadata file path
   */
  private getMetadataPath(projectId: ProjectId, envName: string): string {
    return join(this.basePath, 'projects', projectId, 'envs', envName, 'metadata.json');
  }

  /**
   * Ensure directory exists
   */
  private async ensureDir(filePath: string): Promise<void> {
    const dir = dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
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

    const blobPath = this.getBlobPath(projectId, envName);
    const metadataPath = this.getMetadataPath(projectId, envName);

    // Decode base64 to get actual bytes
    const dataBuffer = Buffer.from(request.data, 'base64');
    const hash = createHash('sha256').update(dataBuffer).digest('hex');

    try {
      await this.ensureDir(blobPath);

      // Write blob data
      await fs.writeFile(blobPath, dataBuffer);

      // Write metadata
      const metadata = {
        key: `projects/${projectId}/envs/${envName}/blob`,
        size: dataBuffer.length,
        hash,
        metadata: request.metadata,
        contentType: request.contentType ?? 'application/octet-stream',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

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
    const blobPath = this.getBlobPath(projectId, envName);
    const metadataPath = this.getMetadataPath(projectId, envName);

    try {
      // Check if blob exists
      await fs.access(blobPath);

      // Read blob data
      const dataBuffer = await fs.readFile(blobPath);

      // Read metadata
      let metadata: Record<string, unknown> = {};
      try {
        const metadataJson = await fs.readFile(metadataPath, 'utf-8');
        metadata = JSON.parse(metadataJson);
      } catch {
        // Metadata file might not exist for old blobs
      }

      return {
        data: dataBuffer.toString('base64'),
        metadata: metadata.metadata as string | undefined,
        contentType: (metadata.contentType as string) ?? 'application/octet-stream',
        size: dataBuffer.length,
        version: 1,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new BlobNotFoundError(`projects/${projectId}/envs/${envName}/blob`);
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
    const blobPath = this.getBlobPath(projectId, envName);
    const metadataPath = this.getMetadataPath(projectId, envName);

    try {
      await fs.unlink(blobPath).catch(() => {});
      await fs.unlink(metadataPath).catch(() => {});

      // Try to clean up empty directories
      const envDir = dirname(blobPath);
      const projectDir = dirname(dirname(envDir));
      await fs.rmdir(envDir).catch(() => {});
      await fs.rmdir(dirname(envDir)).catch(() => {});
      await fs.rmdir(projectDir).catch(() => {});
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
    const blobPath = this.getBlobPath(projectId, envName);
    try {
      await fs.access(blobPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get blob metadata without downloading content
   */
  async getMetadata(projectId: ProjectId, envName: string): Promise<EncryptedBlob | null> {
    const metadataPath = this.getMetadataPath(projectId, envName);

    try {
      const metadataJson = await fs.readFile(metadataPath, 'utf-8');
      const metadata = JSON.parse(metadataJson);

      return {
        key: metadata.key,
        size: metadata.size,
        hash: metadata.hash,
        metadata: metadata.metadata,
        createdAt: new Date(metadata.createdAt),
        updatedAt: new Date(metadata.updatedAt),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw new StorageError(
        `Failed to get blob metadata: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { projectId, envName }
      );
    }
  }

  /**
   * List all blobs for a project
   */
  async listByProject(
    projectId: ProjectId,
    _continuationToken?: string
  ): Promise<StorageListResult> {
    const projectPath = join(this.basePath, 'projects', projectId, 'envs');

    try {
      const envs = await fs.readdir(projectPath);
      const blobs: EncryptedBlob[] = [];

      for (const envName of envs) {
        const metadata = await this.getMetadata(projectId, envName);
        if (metadata) {
          blobs.push(metadata);
        }
      }

      return {
        blobs,
        hasMore: false,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { blobs: [], hasMore: false };
      }
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
    const projectPath = join(this.basePath, 'projects', projectId);

    try {
      const result = await this.listByProject(projectId);
      const count = result.blobs.length;

      // Remove entire project directory
      await fs.rm(projectPath, { recursive: true, force: true });

      return count;
    } catch {
      return 0;
    }
  }

  /**
   * Get storage stats
   */
  async getStats(): Promise<{
    totalFiles: number;
    totalSizeBytes: number;
    totalSizeMB: number;
    totalSizeGB: number;
  }> {
    let totalFiles = 0;
    let totalSizeBytes = 0;

    const countDir = async (dirPath: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(dirPath, entry.name);
          if (entry.isDirectory()) {
            await countDir(fullPath);
          } else if (entry.name === 'blob') {
            totalFiles++;
            const stat = await fs.stat(fullPath);
            totalSizeBytes += stat.size;
          }
        }
      } catch {
        // Directory doesn't exist
      }
    };

    await countDir(this.basePath);

    return {
      totalFiles,
      totalSizeBytes,
      totalSizeMB: Math.round(totalSizeBytes / 1024 / 1024 * 100) / 100,
      totalSizeGB: Math.round(totalSizeBytes / 1024 / 1024 / 1024 * 100) / 100,
    };
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let localStorageService: LocalStorageService | null = null;

export function getLocalStorageService(): LocalStorageService {
  if (!localStorageService) {
    localStorageService = new LocalStorageService();
  }
  return localStorageService;
}
