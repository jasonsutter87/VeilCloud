/**
 * Audit Service
 * Automatic audit logging via VeilChain
 */

import { getVeilChainClient } from '../integrations/veilchain.js';
import { query } from '../db/connection.js';
import type { AuditAction, AuditEntry, UserId, ProjectId, TeamId, MerkleProof } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface LogEventInput {
  action: AuditAction;
  userId: UserId;
  projectId?: ProjectId;
  teamId?: TeamId;
  context?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditResult {
  entryId: string;
  position: bigint;
  hash: string;
  proof?: MerkleProof;
}

// ============================================================================
// Service
// ============================================================================

export class AuditService {
  private veilchainAvailable = true;

  /**
   * Log an audit event
   * Writes to both local DB (cache) and VeilChain (immutable)
   */
  async log(input: LogEventInput): Promise<AuditResult> {
    const timestamp = new Date();

    // Try VeilChain first
    let veilchainEntry: AuditResult | null = null;

    if (this.veilchainAvailable) {
      try {
        const veilchain = getVeilChainClient();
        const result = await veilchain.log({
          action: input.action,
          userId: input.userId,
          projectId: input.projectId,
          teamId: input.teamId,
          context: input.context,
          ipAddress: input.ipAddress,
        });

        veilchainEntry = {
          entryId: result.entryId,
          position: result.position,
          hash: result.hash,
          proof: result.proof,
        };
      } catch (error) {
        console.warn('[Audit] VeilChain unavailable, falling back to local only');
        this.veilchainAvailable = false;

        // Retry periodically
        setTimeout(() => {
          this.veilchainAvailable = true;
        }, 60000);
      }
    }

    // Always write to local DB as cache
    const localResult = await query<{ id: string }>(
      `INSERT INTO audit_log (veilchain_entry_id, action, user_id, project_id, team_id, ip_address, user_agent, context, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        veilchainEntry?.entryId ?? null,
        input.action,
        input.userId,
        input.projectId ?? null,
        input.teamId ?? null,
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.context ? JSON.stringify(input.context) : null,
        timestamp,
      ]
    );

    return veilchainEntry ?? {
      entryId: localResult.rows[0]!.id,
      position: BigInt(0),
      hash: '',
    };
  }

  /**
   * Log blob read
   */
  async logBlobRead(
    userId: UserId,
    projectId: ProjectId,
    envName: string,
    ipAddress?: string
  ): Promise<void> {
    await this.log({
      action: 'blob.read',
      userId,
      projectId,
      context: { envName },
      ipAddress,
    });
  }

  /**
   * Log blob write
   */
  async logBlobWrite(
    userId: UserId,
    projectId: ProjectId,
    envName: string,
    size: number,
    ipAddress?: string
  ): Promise<void> {
    await this.log({
      action: 'blob.write',
      userId,
      projectId,
      context: { envName, size },
      ipAddress,
    });
  }

  /**
   * Log blob delete
   */
  async logBlobDelete(
    userId: UserId,
    projectId: ProjectId,
    envName: string,
    ipAddress?: string
  ): Promise<void> {
    await this.log({
      action: 'blob.delete',
      userId,
      projectId,
      context: { envName },
      ipAddress,
    });
  }

  /**
   * Log project creation
   */
  async logProjectCreate(
    userId: UserId,
    projectId: ProjectId,
    projectName: string,
    ipAddress?: string
  ): Promise<void> {
    await this.log({
      action: 'project.create',
      userId,
      projectId,
      context: { projectName },
      ipAddress,
    });
  }

  /**
   * Log project share
   */
  async logProjectShare(
    userId: UserId,
    projectId: ProjectId,
    teamId: TeamId,
    permissions: string[],
    ipAddress?: string
  ): Promise<void> {
    await this.log({
      action: 'project.share',
      userId,
      projectId,
      teamId,
      context: { permissions },
      ipAddress,
    });
  }

  /**
   * Log team creation
   */
  async logTeamCreate(
    userId: UserId,
    teamId: TeamId,
    teamName: string,
    threshold: number,
    ipAddress?: string
  ): Promise<void> {
    await this.log({
      action: 'team.create',
      userId,
      teamId,
      context: { teamName, threshold },
      ipAddress,
    });
  }

  /**
   * Log team member join
   */
  async logTeamJoin(
    userId: UserId,
    teamId: TeamId,
    newMemberId: UserId,
    shareIndex: number,
    ipAddress?: string
  ): Promise<void> {
    await this.log({
      action: 'team.join',
      userId,
      teamId,
      context: { newMemberId, shareIndex },
      ipAddress,
    });
  }

  /**
   * Log credential issuance
   */
  async logCredentialIssue(
    userId: UserId,
    credentialType: string,
    permissions: string[],
    ipAddress?: string
  ): Promise<void> {
    await this.log({
      action: 'credential.issue',
      userId,
      context: { credentialType, permissions },
      ipAddress,
    });
  }

  /**
   * Get local audit trail (from cache)
   */
  async getLocalTrail(
    projectId?: ProjectId,
    limit = 50,
    offset = 0
  ): Promise<AuditEntry[]> {
    const result = await query<{
      id: string;
      veilchain_entry_id: string | null;
      action: AuditAction;
      user_id: string;
      project_id: string | null;
      team_id: string | null;
      ip_address: string | null;
      context: Record<string, unknown> | null;
      created_at: Date;
    }>(
      `SELECT * FROM audit_log
       WHERE ($1::uuid IS NULL OR project_id = $1)
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [projectId ?? null, limit, offset]
    );

    return result.rows.map((row) => ({
      entryId: row.veilchain_entry_id ?? row.id,
      position: BigInt(0),
      action: row.action,
      userId: row.user_id,
      projectId: row.project_id ?? undefined,
      teamId: row.team_id ?? undefined,
      context: row.context ?? undefined,
      ipAddress: row.ip_address ?? undefined,
      timestamp: row.created_at,
    }));
  }
}

// ============================================================================
// Singleton
// ============================================================================

let auditService: AuditService | null = null;

export function getAuditService(): AuditService {
  if (!auditService) {
    auditService = new AuditService();
  }
  return auditService;
}
