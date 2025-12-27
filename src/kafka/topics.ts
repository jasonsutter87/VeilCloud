/**
 * Kafka Topic Definitions
 *
 * Defines the structure of messages for each topic.
 */

/**
 * Vote submission event
 * Sent when a voter submits an encrypted vote
 */
export interface VoteIncomingMessage {
  /** Unique message ID for idempotency */
  messageId: string;
  /** Election ID */
  electionId: string;
  /** Encrypted vote blob (base64) */
  encryptedVote: string;
  /** Vote nullifier (prevents double voting) */
  nullifier: string;
  /** Vote commitment hash */
  commitment: string;
  /** ZK proof of vote validity */
  zkProof: {
    pi_a: string[];
    pi_b: string[][];
    pi_c: string[];
    protocol: string;
  };
  /** Credential signature */
  credentialSignature: string;
  /** Timestamp of submission */
  timestamp: number;
  /** Client metadata */
  metadata?: {
    clientIp?: string;
    userAgent?: string;
    region?: string;
  };
}

/**
 * Audit event
 * Sent for all mutations to be logged immutably
 */
export interface AuditEventMessage {
  /** Unique event ID */
  eventId: string;
  /** Action type */
  action:
    | 'vote.submitted'
    | 'vote.processed'
    | 'vote.rejected'
    | 'merkle.updated'
    | 'credential.issued'
    | 'credential.verified'
    | 'credential.revoked'
    | 'project.created'
    | 'project.updated'
    | 'project.deleted'
    | 'team.created'
    | 'team.member.added'
    | 'team.member.removed'
    | 'team.decryption.partial'
    | 'team.decryption.complete';
  /** Entity type */
  entityType: 'vote' | 'credential' | 'project' | 'team' | 'merkle';
  /** Entity ID */
  entityId: string;
  /** Actor (user/system) */
  actor: {
    type: 'user' | 'system' | 'service';
    id: string;
  };
  /** Event timestamp */
  timestamp: number;
  /** Event data (varies by action) */
  data: Record<string, unknown>;
  /** Hash of data for integrity */
  dataHash: string;
}

/**
 * Merkle tree update batch
 * Sent when votes need to be added to the Merkle tree
 */
export interface MerkleUpdateMessage {
  /** Batch ID */
  batchId: string;
  /** Election ID */
  electionId: string;
  /** Vote hashes to add */
  voteHashes: string[];
  /** Expected previous root (for optimistic locking) */
  previousRoot: string;
  /** Batch number in sequence */
  batchNumber: number;
  /** Timestamp */
  timestamp: number;
}

/**
 * Dead letter message
 * Contains failed messages for manual inspection
 */
export interface DeadLetterMessage {
  /** Original topic */
  originalTopic: string;
  /** Original message */
  originalMessage: unknown;
  /** Error details */
  error: {
    message: string;
    stack?: string;
    code?: string;
  };
  /** Retry count before DLQ */
  retryCount: number;
  /** Timestamp of failure */
  failedAt: number;
}

/**
 * Topic configuration for creation
 */
export const topicConfigs = {
  votesIncoming: {
    numPartitions: 32, // High parallelism for vote ingestion
    replicationFactor: 3, // High durability
    configEntries: [
      { name: 'retention.ms', value: '604800000' }, // 7 days
      { name: 'cleanup.policy', value: 'delete' },
      { name: 'min.insync.replicas', value: '2' },
    ],
  },
  auditEvents: {
    numPartitions: 16,
    replicationFactor: 3,
    configEntries: [
      { name: 'retention.ms', value: '-1' }, // Forever (audit trail)
      { name: 'cleanup.policy', value: 'compact' },
      { name: 'min.insync.replicas', value: '2' },
    ],
  },
  merkleUpdates: {
    numPartitions: 8,
    replicationFactor: 3,
    configEntries: [
      { name: 'retention.ms', value: '86400000' }, // 1 day
      { name: 'cleanup.policy', value: 'delete' },
      { name: 'min.insync.replicas', value: '2' },
    ],
  },
  deadLetter: {
    numPartitions: 4,
    replicationFactor: 3,
    configEntries: [
      { name: 'retention.ms', value: '2592000000' }, // 30 days
      { name: 'cleanup.policy', value: 'delete' },
    ],
  },
};
