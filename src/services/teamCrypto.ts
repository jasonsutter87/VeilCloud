/**
 * Team Crypto Service
 * Threshold cryptography operations via VeilKey
 */

import { getVeilKeyClient } from '../integrations/veilkey.js';
import { TeamRepository } from '../db/repositories/team.js';
import { getAuditService } from './audit.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../lib/errors.js';
import type { UserId, TeamId, DecryptionShare } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export interface DecryptRequest {
  teamId: TeamId;
  userId: UserId;
  ciphertext: string;
  ipAddress?: string;
}

export interface DecryptShare {
  shareIndex: number;
  partialDecryption: string;
  proof: string;
}

export interface CombineSharesRequest {
  teamId: TeamId;
  ciphertext: string;
  shares: DecryptShare[];
}

export interface EncryptForTeamRequest {
  teamId: TeamId;
  plaintext: string;
  userId: UserId;
  ipAddress?: string;
}

export interface TeamKeyInfo {
  teamId: TeamId;
  publicKey: string;
  threshold: number;
  totalShares: number;
  activeShares: number;
}

// ============================================================================
// Service
// ============================================================================

export class TeamCryptoService {
  private veilkeyAvailable = true;

  /**
   * Encrypt data for a team using their threshold public key
   */
  async encryptForTeam(input: EncryptForTeamRequest): Promise<string> {
    const { teamId, plaintext, userId, ipAddress } = input;

    // Verify user is a team member
    const isMember = await TeamRepository.isMember(teamId, userId);
    if (!isMember) {
      throw new ForbiddenError('Not a member of this team');
    }

    // Get team's VeilKey group
    const team = await TeamRepository.findById(teamId);
    if (!team) {
      throw new NotFoundError('Team', teamId);
    }

    if (!team.veilkeyGroupId) {
      throw new ValidationError('Team does not have threshold encryption enabled');
    }

    const veilkey = getVeilKeyClient();
    const ciphertext = await veilkey.encrypt({
      groupId: team.veilkeyGroupId,
      plaintext,
    });

    // Audit log
    const audit = getAuditService();
    await audit.log({
      action: 'team.encrypt',
      userId,
      teamId,
      context: { size: plaintext.length },
      ipAddress,
    });

    return ciphertext;
  }

  /**
   * Generate a partial decryption share
   * Each team member can generate their share independently
   */
  async generateDecryptionShare(input: DecryptRequest): Promise<DecryptShare> {
    const { teamId, userId, ciphertext, ipAddress } = input;

    // Get team member info
    const member = await TeamRepository.getMember(teamId, userId);
    if (!member) {
      throw new ForbiddenError('Not a member of this team');
    }

    // Get team's VeilKey group
    const team = await TeamRepository.findById(teamId);
    if (!team?.veilkeyGroupId) {
      throw new ValidationError('Team does not have threshold encryption enabled');
    }

    const veilkey = getVeilKeyClient();

    // Generate partial decryption using member's share
    const result = await veilkey.partialDecrypt({
      groupId: team.veilkeyGroupId,
      partyIndex: member.shareIndex,
      ciphertext,
    });

    // Audit log
    const audit = getAuditService();
    await audit.log({
      action: 'team.partial_decrypt',
      userId,
      teamId,
      context: { shareIndex: member.shareIndex },
      ipAddress,
    });

    return {
      shareIndex: member.shareIndex,
      partialDecryption: result.partialDecryption,
      proof: result.proof,
    };
  }

  /**
   * Combine partial decryption shares to recover plaintext
   * Requires at least threshold number of valid shares
   */
  async combineShares(input: CombineSharesRequest): Promise<string> {
    const { teamId, ciphertext, shares } = input;

    // Get team info
    const team = await TeamRepository.findById(teamId);
    if (!team) {
      throw new NotFoundError('Team', teamId);
    }

    if (!team.veilkeyGroupId) {
      throw new ValidationError('Team does not have threshold encryption enabled');
    }

    if (shares.length < team.threshold) {
      throw new ValidationError(
        `Need at least ${team.threshold} shares, got ${shares.length}`
      );
    }

    const veilkey = getVeilKeyClient();

    // Combine shares
    const plaintext = await veilkey.combineShares({
      groupId: team.veilkeyGroupId,
      ciphertext,
      shares: shares.map((s) => ({
        partyIndex: s.shareIndex,
        partialDecryption: s.partialDecryption,
        proof: s.proof,
      })),
    });

    return plaintext;
  }

  /**
   * Get team key info without exposing private shares
   */
  async getTeamKeyInfo(teamId: TeamId, userId: UserId): Promise<TeamKeyInfo> {
    // Verify user is a team member
    const isMember = await TeamRepository.isMember(teamId, userId);
    if (!isMember) {
      throw new ForbiddenError('Not a member of this team');
    }

    const team = await TeamRepository.findById(teamId);
    if (!team) {
      throw new NotFoundError('Team', teamId);
    }

    if (!team.veilkeyGroupId) {
      throw new ValidationError('Team does not have threshold encryption enabled');
    }

    const veilkey = getVeilKeyClient();
    const keyGroup = await veilkey.getKeyGroup(team.veilkeyGroupId);

    const members = await TeamRepository.getMembers(teamId);

    return {
      teamId,
      publicKey: keyGroup.publicKey,
      threshold: team.threshold,
      totalShares: team.totalShares,
      activeShares: members.length,
    };
  }

  /**
   * Rotate team key (admin operation)
   * Creates new key group and re-encrypts data
   */
  async rotateTeamKey(
    teamId: TeamId,
    userId: UserId,
    ipAddress?: string
  ): Promise<TeamKeyInfo> {
    // Check if user is owner or admin
    const member = await TeamRepository.getMember(teamId, userId);
    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenError('Only owner or admin can rotate keys');
    }

    const team = await TeamRepository.findById(teamId);
    if (!team) {
      throw new NotFoundError('Team', teamId);
    }

    const members = await TeamRepository.getMembers(teamId);

    const veilkey = getVeilKeyClient();

    // Generate new key group
    const result = await veilkey.generateTeamKey({
      teamId,
      threshold: team.threshold,
      totalMembers: team.totalShares,
    });

    // Update team with new VeilKey group ID
    await TeamRepository.update(teamId, {
      veilkeyGroupId: result.keyGroup.id,
    });

    // Audit log
    const audit = getAuditService();
    await audit.log({
      action: 'team.key_rotate',
      userId,
      teamId,
      context: {
        oldGroupId: team.veilkeyGroupId,
        newGroupId: result.keyGroup.id,
      },
      ipAddress,
    });

    return {
      teamId,
      publicKey: result.keyGroup.publicKey,
      threshold: team.threshold,
      totalShares: team.totalShares,
      activeShares: members.length,
    };
  }

  /**
   * Re-share a team key after member changes
   * Used after adding/removing members
   */
  async reshareTeamKey(
    teamId: TeamId,
    userId: UserId,
    ipAddress?: string
  ): Promise<void> {
    // Check if user is owner or admin
    const member = await TeamRepository.getMember(teamId, userId);
    if (!member || !['owner', 'admin'].includes(member.role)) {
      throw new ForbiddenError('Only owner or admin can reshare keys');
    }

    const team = await TeamRepository.findById(teamId);
    if (!team?.veilkeyGroupId) {
      throw new ValidationError('Team does not have threshold encryption enabled');
    }

    const members = await TeamRepository.getMembers(teamId);

    const veilkey = getVeilKeyClient();

    // Reshare key group
    await veilkey.reshareKeyGroup({
      groupId: team.veilkeyGroupId,
      newPartyCount: members.length,
    });

    // Audit log
    const audit = getAuditService();
    await audit.log({
      action: 'team.key_reshare',
      userId,
      teamId,
      context: { partyCount: members.length },
      ipAddress,
    });
  }

  /**
   * Check if VeilKey is available
   */
  isVeilKeyAvailable(): boolean {
    return this.veilkeyAvailable;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let teamCryptoService: TeamCryptoService | null = null;

export function getTeamCryptoService(): TeamCryptoService {
  if (!teamCryptoService) {
    teamCryptoService = new TeamCryptoService();
  }
  return teamCryptoService;
}
