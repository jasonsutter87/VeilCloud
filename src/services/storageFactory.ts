/**
 * Storage Factory
 *
 * Switches between storage backends based on config.
 *
 * Usage:
 *   STORAGE_TYPE=local    STORAGE_LOCAL_PATH=/path     → Local filesystem
 *   STORAGE_TYPE=netlify  NETLIFY_SITE_ID=xxx          → Netlify Blobs
 *   STORAGE_TYPE=s3                                    → S3/MinIO (default)
 */

import { StorageService, getStorageService, StorageListResult } from './storage.js';
import { LocalStorageService, getLocalStorageService } from './localStorage.js';
import { NetlifyStorageService, getNetlifyStorageService } from './netlifyStorage.js';
import type {
  EncryptedBlob,
  StoragePutRequest,
  StorageGetResponse,
  ProjectId,
} from '../types.js';

// ============================================================================
// Storage Interface (common to both implementations)
// ============================================================================

export interface IStorageService {
  put(projectId: ProjectId, envName: string, request: StoragePutRequest): Promise<EncryptedBlob>;
  get(projectId: ProjectId, envName: string): Promise<StorageGetResponse>;
  delete(projectId: ProjectId, envName: string): Promise<void>;
  exists(projectId: ProjectId, envName: string): Promise<boolean>;
  getMetadata(projectId: ProjectId, envName: string): Promise<EncryptedBlob | null>;
  listByProject(projectId: ProjectId, continuationToken?: string): Promise<StorageListResult>;
  deleteByProject(projectId: ProjectId): Promise<number>;
}

// ============================================================================
// Storage Type Detection
// ============================================================================

export type StorageType = 'local' | 's3' | 'netlify';

export function getStorageType(): StorageType {
  const type = process.env.STORAGE_TYPE?.toLowerCase();
  if (type === 'local' || type === 'filesystem' || type === 'fs') {
    return 'local';
  }
  if (type === 'netlify' || type === 'netlify-blobs') {
    return 'netlify';
  }
  return 's3';
}

export function getStorageConfig(): {
  type: StorageType;
  localPath?: string;
  s3Endpoint?: string;
  s3Bucket?: string;
  netlifySiteId?: string;
  netlifyStore?: string;
} {
  const type = getStorageType();
  return {
    type,
    localPath: process.env.STORAGE_LOCAL_PATH,
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Bucket: process.env.S3_BUCKET,
    netlifySiteId: process.env.NETLIFY_SITE_ID,
    netlifyStore: process.env.NETLIFY_BLOBS_STORE,
  };
}

// ============================================================================
// Factory Function
// ============================================================================

let storageInstance: IStorageService | null = null;

/**
 * Get the configured storage service
 * Automatically switches between local, Netlify, and S3 based on STORAGE_TYPE env var
 */
export function getStorage(): IStorageService {
  if (storageInstance) {
    return storageInstance;
  }

  const storageType = getStorageType();

  switch (storageType) {
    case 'local': {
      const path = process.env.STORAGE_LOCAL_PATH || './data/storage';
      console.log(`[Storage] Using LOCAL filesystem storage at: ${path}`);
      storageInstance = getLocalStorageService();
      break;
    }
    case 'netlify': {
      const store = process.env.NETLIFY_BLOBS_STORE || 'veilcloud';
      console.log(`[Storage] Using NETLIFY Blobs storage (store: ${store})`);
      storageInstance = getNetlifyStorageService();
      break;
    }
    case 's3':
    default: {
      const endpoint = process.env.S3_ENDPOINT || 'S3';
      console.log(`[Storage] Using S3 storage at: ${endpoint}`);
      storageInstance = getStorageService();
      break;
    }
  }

  return storageInstance;
}

/**
 * Reset storage instance (useful for testing)
 */
export function resetStorage(): void {
  storageInstance = null;
}

// ============================================================================
// Convenience Exports
// ============================================================================

export { StorageService, LocalStorageService, NetlifyStorageService, StorageListResult };
