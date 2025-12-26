/**
 * VeilCloud Core Types
 * Zero-knowledge cloud storage platform
 */

// ============================================================================
// Core Identifiers
// ============================================================================

export type UserId = string;
export type ProjectId = string;
export type TeamId = string;
export type BlobId = string;
export type CredentialId = string;

// ============================================================================
// User Types
// ============================================================================

export interface User {
  id: UserId;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserCredentials {
  userId: UserId;
  credentialId: CredentialId;
  permissions: Permission[];
  expiresAt: Date;
}

// ============================================================================
// Project Types
// ============================================================================

export interface Project {
  id: ProjectId;
  ownerId: UserId;
  name: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Environment {
  id: string;
  projectId: ProjectId;
  name: string; // 'development' | 'staging' | 'production' | custom
  blobKey: string; // S3 key for encrypted blob
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================================
// Storage Types (ZK - Server never sees plaintext)
// ============================================================================

export interface EncryptedBlob {
  /** S3/MinIO key */
  key: string;
  /** Size in bytes */
  size: number;
  /** Content hash (of encrypted data) */
  hash: string;
  /** Client-provided metadata (encrypted by client) */
  metadata?: string;
  /** Upload timestamp */
  createdAt: Date;
  /** Last modified */
  updatedAt: Date;
}

export interface StoragePutRequest {
  /** Encrypted data (base64) */
  data: string;
  /** Optional encrypted metadata */
  metadata?: string;
  /** Content type */
  contentType?: string;
}

export interface StorageGetResponse {
  /** Encrypted data (base64) */
  data: string;
  /** Encrypted metadata */
  metadata?: string;
  /** Content type */
  contentType: string;
  /** Size in bytes */
  size: number;
  /** Version number */
  version: number;
}

// ============================================================================
// Team Types (VeilKey Integration)
// ============================================================================

export interface Team {
  id: TeamId;
  name: string;
  description?: string;
  /** VeilKey KeyGroup ID for threshold crypto */
  veilkeyGroupId?: string;
  /** Minimum shares needed to decrypt */
  threshold: number;
  /** Total shares distributed */
  totalShares: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface TeamMember {
  teamId: TeamId;
  userId: UserId;
  /** VeilKey share index (1-based) */
  shareIndex: number;
  role: TeamRole;
  joinedAt: Date;
}

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface TeamInvite {
  id: string;
  teamId: TeamId;
  email: string;
  role: TeamRole;
  expiresAt: Date;
  createdAt: Date;
}

// ============================================================================
// Access Control Types (VeilSign Integration)
// ============================================================================

export type Permission =
  | 'project:read'
  | 'project:write'
  | 'project:delete'
  | 'project:share'
  | 'team:manage'
  | 'audit:read';

export interface AccessCredential {
  /** VeilSign credential ID */
  credentialId: CredentialId;
  /** User this credential belongs to */
  userId: UserId;
  /** Project scope (or '*' for all) */
  projectId: ProjectId | '*';
  /** Granted permissions */
  permissions: Permission[];
  /** Credential expiration */
  expiresAt: Date;
  /** When credential was issued */
  issuedAt: Date;
}

export interface AccessRequest {
  /** Project to access */
  projectId: ProjectId;
  /** Required permission */
  permission: Permission;
  /** VeilSign credential (base64) */
  credential: string;
  /** VeilSign signature (base64) */
  signature: string;
}

// ============================================================================
// Audit Types (VeilChain Integration)
// ============================================================================

export type AuditAction =
  | 'blob.read'
  | 'blob.write'
  | 'blob.delete'
  | 'project.create'
  | 'project.update'
  | 'project.delete'
  | 'project.share'
  | 'team.create'
  | 'team.join'
  | 'team.leave'
  | 'credential.issue'
  | 'credential.verify'
  | 'credential.revoke';

export interface AuditEntry {
  /** VeilChain entry ID */
  entryId: string;
  /** Position in ledger */
  position: bigint;
  /** Action performed */
  action: AuditAction;
  /** User who performed action */
  userId: UserId;
  /** Affected project */
  projectId?: ProjectId;
  /** Affected team */
  teamId?: TeamId;
  /** Additional context */
  context?: Record<string, unknown>;
  /** Client IP address */
  ipAddress?: string;
  /** Timestamp */
  timestamp: Date;
  /** VeilChain Merkle proof */
  proof?: MerkleProof;
}

export interface MerkleProof {
  leaf: string;
  index: number;
  proof: string[];
  directions: ('left' | 'right')[];
  root: string;
}

export interface AuditQuery {
  projectId?: ProjectId;
  userId?: UserId;
  action?: AuditAction;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

// ============================================================================
// API Types
// ============================================================================

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface VeilCloudConfig {
  /** Server port */
  port: number;
  /** Server host */
  host: string;

  /** PostgreSQL connection string */
  databaseUrl: string;

  /** Redis connection string */
  redisUrl?: string;

  /** S3/MinIO configuration */
  storage: StorageConfig;

  /** VeilSuite integration URLs */
  integrations: IntegrationConfig;

  /** Rate limiting */
  rateLimit?: RateLimitConfig;
}

export interface StorageConfig {
  /** S3 endpoint (use MinIO URL for local dev) */
  endpoint: string;
  /** S3 region */
  region: string;
  /** S3 bucket name */
  bucket: string;
  /** Access key ID */
  accessKeyId: string;
  /** Secret access key */
  secretAccessKey: string;
  /** Force path style (required for MinIO) */
  forcePathStyle?: boolean;
}

export interface IntegrationConfig {
  /** VeilKey API URL */
  veilkeyUrl?: string;
  /** VeilChain API URL */
  veilchainUrl?: string;
  /** VeilSign API URL */
  veilsignUrl?: string;
}

export interface RateLimitConfig {
  /** Max requests per window */
  max: number;
  /** Time window in milliseconds */
  timeWindow: number;
}
