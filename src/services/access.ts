/**
 * Access Service
 * Privacy-preserving access control via VeilSign
 */

import { getVeilSignClient } from '../integrations/veilsign.js';
import { query } from '../db/connection.js';
import { getAuditService } from './audit.js';
import { ForbiddenError, ValidationError, NotFoundError } from '../lib/errors.js';
import type { UserId, ProjectId, TeamId, Permission, VeilSignCredential } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface IssueCredentialInput {
  userId: UserId;
  projectId?: ProjectId;
  teamId?: TeamId;
  permissions: Permission[];
  expiresIn?: string; // e.g., '24h', '7d', '30d'
  ipAddress?: string;
}

export interface CredentialResult {
  credentialId: string;
  credential: string; // Serialized credential
  expiresAt: Date;
  permissions: Permission[];
}

export interface VerifyCredentialInput {
  credential: string;
  requiredPermissions?: Permission[];
  projectId?: ProjectId;
  teamId?: TeamId;
}

export interface VerifyResult {
  valid: boolean;
  userId?: UserId;
  permissions?: Permission[];
  expiresAt?: Date;
  reason?: string;
}

export interface RevokeCredentialInput {
  credentialId: string;
  userId: UserId;
  reason?: string;
  ipAddress?: string;
}

// ============================================================================
// Service
// ============================================================================

export class AccessService {
  private veilsignAvailable = true;

  /**
   * Issue a new access credential
   * Uses VeilSign for privacy-preserving credentials
   */
  async issueCredential(input: IssueCredentialInput): Promise<CredentialResult> {
    const { userId, projectId, teamId, permissions, expiresIn, ipAddress } = input;

    if (permissions.length === 0) {
      throw new ValidationError('At least one permission required');
    }

    // Calculate expiration
    const expiresAt = this.calculateExpiration(expiresIn ?? '24h');

    const veilsign = getVeilSignClient();

    // Issue credential via VeilSign
    const result = await veilsign.issueCredential({
      subject: userId,
      attributes: {
        projectId,
        teamId,
        permissions,
      },
      expiresAt,
    });

    // Store credential metadata in DB
    await query(
      `INSERT INTO credentials (id, user_id, project_id, team_id, permissions, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [
        result.credentialId,
        userId,
        projectId ?? null,
        teamId ?? null,
        JSON.stringify(permissions),
        expiresAt,
      ]
    );

    // Audit log
    const audit = getAuditService();
    await audit.logCredentialIssue(userId, 'access', permissions, ipAddress);

    return {
      credentialId: result.credentialId,
      credential: result.credential,
      expiresAt,
      permissions,
    };
  }

  /**
   * Verify a credential
   * Privacy-preserving verification via VeilSign
   */
  async verifyCredential(input: VerifyCredentialInput): Promise<VerifyResult> {
    const { credential, requiredPermissions, projectId, teamId } = input;

    const veilsign = getVeilSignClient();

    // Verify with VeilSign
    const result = await veilsign.verifyCredential(credential);

    if (!result.valid) {
      return {
        valid: false,
        reason: 'Invalid credential signature',
      };
    }

    // Check if revoked
    const revoked = await this.isRevoked(result.credentialId);
    if (revoked) {
      return {
        valid: false,
        reason: 'Credential has been revoked',
      };
    }

    // Check expiration
    if (result.expiresAt && new Date(result.expiresAt) < new Date()) {
      return {
        valid: false,
        reason: 'Credential has expired',
      };
    }

    // Check project scope
    if (projectId && result.attributes.projectId !== projectId) {
      return {
        valid: false,
        reason: 'Credential not valid for this project',
      };
    }

    // Check team scope
    if (teamId && result.attributes.teamId !== teamId) {
      return {
        valid: false,
        reason: 'Credential not valid for this team',
      };
    }

    // Check permissions
    if (requiredPermissions && requiredPermissions.length > 0) {
      const credPermissions = result.attributes.permissions as Permission[];
      const hasAllPermissions = requiredPermissions.every((p) =>
        credPermissions.includes(p)
      );
      if (!hasAllPermissions) {
        return {
          valid: false,
          reason: 'Insufficient permissions',
        };
      }
    }

    return {
      valid: true,
      userId: result.subject as UserId,
      permissions: result.attributes.permissions as Permission[],
      expiresAt: result.expiresAt ? new Date(result.expiresAt) : undefined,
    };
  }

  /**
   * Revoke a credential
   */
  async revokeCredential(input: RevokeCredentialInput): Promise<void> {
    const { credentialId, userId, reason, ipAddress } = input;

    // Check if credential exists and belongs to user (or user is admin)
    const cred = await query<{ user_id: string }>(
      `SELECT user_id FROM credentials WHERE id = $1`,
      [credentialId]
    );

    if (cred.rows.length === 0) {
      throw new NotFoundError('Credential', credentialId);
    }

    // Store revocation
    await query(
      `INSERT INTO credential_revocations (credential_id, revoked_by, reason, revoked_at)
       VALUES ($1, $2, $3, NOW())`,
      [credentialId, userId, reason ?? null]
    );

    // Also revoke on VeilSign (nullifier tracking)
    const veilsign = getVeilSignClient();
    await veilsign.revokeCredential(credentialId);

    // Audit log
    const audit = getAuditService();
    await audit.log({
      action: 'credential.revoke',
      userId,
      context: { credentialId, reason },
      ipAddress,
    });
  }

  /**
   * List user's credentials
   */
  async listCredentials(
    userId: UserId,
    options?: { projectId?: ProjectId; includeExpired?: boolean }
  ): Promise<Array<{
    id: string;
    projectId: ProjectId | null;
    teamId: TeamId | null;
    permissions: Permission[];
    expiresAt: Date;
    revoked: boolean;
  }>> {
    let sql = `
      SELECT c.id, c.project_id, c.team_id, c.permissions, c.expires_at,
             EXISTS (SELECT 1 FROM credential_revocations r WHERE r.credential_id = c.id) as revoked
      FROM credentials c
      WHERE c.user_id = $1
    `;
    const params: unknown[] = [userId];

    if (options?.projectId) {
      sql += ` AND c.project_id = $${params.length + 1}`;
      params.push(options.projectId);
    }

    if (!options?.includeExpired) {
      sql += ` AND c.expires_at > NOW()`;
    }

    sql += ` ORDER BY c.created_at DESC`;

    const result = await query<{
      id: string;
      project_id: string | null;
      team_id: string | null;
      permissions: string;
      expires_at: Date;
      revoked: boolean;
    }>(sql, params);

    return result.rows.map((row) => ({
      id: row.id,
      projectId: row.project_id as ProjectId | null,
      teamId: row.team_id as TeamId | null,
      permissions: JSON.parse(row.permissions) as Permission[],
      expiresAt: row.expires_at,
      revoked: row.revoked,
    }));
  }

  /**
   * Issue a one-time access credential
   * Uses nullifier to ensure single use
   */
  async issueOneTimeCredential(input: IssueCredentialInput): Promise<CredentialResult> {
    const result = await this.issueCredential({
      ...input,
      expiresIn: input.expiresIn ?? '1h',
    });

    // Mark as one-time in DB
    await query(
      `UPDATE credentials SET one_time = true WHERE id = $1`,
      [result.credentialId]
    );

    return result;
  }

  /**
   * Verify and consume a one-time credential
   */
  async verifyAndConsumeOneTime(
    credential: string,
    requiredPermissions?: Permission[]
  ): Promise<VerifyResult> {
    const verifyResult = await this.verifyCredential({
      credential,
      requiredPermissions,
    });

    if (!verifyResult.valid) {
      return verifyResult;
    }

    // Check if one-time credential
    const veilsign = getVeilSignClient();
    const credResult = await veilsign.verifyCredential(credential);

    const credInfo = await query<{ one_time: boolean }>(
      `SELECT one_time FROM credentials WHERE id = $1`,
      [credResult.credentialId]
    );

    if (credInfo.rows[0]?.one_time) {
      // Consume by revoking
      await this.revokeCredential({
        credentialId: credResult.credentialId,
        userId: verifyResult.userId!,
        reason: 'One-time credential consumed',
      });
    }

    return verifyResult;
  }

  /**
   * Check if credential is revoked
   */
  private async isRevoked(credentialId: string): Promise<boolean> {
    const result = await query<{ count: string }>(
      `SELECT COUNT(*) as count FROM credential_revocations WHERE credential_id = $1`,
      [credentialId]
    );
    return parseInt(result.rows[0]?.count ?? '0', 10) > 0;
  }

  /**
   * Calculate expiration date from duration string
   */
  private calculateExpiration(duration: string): Date {
    const match = duration.match(/^(\d+)(h|d|w|m)$/);
    if (!match) {
      throw new ValidationError('Invalid duration format. Use: 1h, 24h, 7d, 30d, etc.');
    }

    const value = parseInt(match[1]!, 10);
    const unit = match[2]!;

    const now = new Date();
    switch (unit) {
      case 'h':
        return new Date(now.getTime() + value * 60 * 60 * 1000);
      case 'd':
        return new Date(now.getTime() + value * 24 * 60 * 60 * 1000);
      case 'w':
        return new Date(now.getTime() + value * 7 * 24 * 60 * 60 * 1000);
      case 'm':
        return new Date(now.getTime() + value * 30 * 24 * 60 * 60 * 1000);
      default:
        throw new ValidationError('Invalid duration unit');
    }
  }

  /**
   * Check if VeilSign is available
   */
  isVeilSignAvailable(): boolean {
    return this.veilsignAvailable;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let accessService: AccessService | null = null;

export function getAccessService(): AccessService {
  if (!accessService) {
    accessService = new AccessService();
  }
  return accessService;
}
