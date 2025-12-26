/**
 * Team Repository
 * CRUD operations for teams and team members
 */

import { query, transaction } from '../connection.js';
import { NotFoundError, DuplicateError, ValidationError } from '../../lib/errors.js';
import type { Team, TeamMember, TeamRole, TeamId, UserId } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

export interface CreateTeamInput {
  ownerId: UserId;
  name: string;
  description?: string;
  threshold: number;
  totalShares: number;
  veilkeyGroupId?: string;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
  veilkeyGroupId?: string;
}

export interface AddMemberInput {
  teamId: TeamId;
  userId: UserId;
  shareIndex: number;
  role?: TeamRole;
}

interface TeamRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  veilkey_group_id: string | null;
  threshold: number;
  total_shares: number;
  created_at: Date;
  updated_at: Date;
}

interface TeamMemberRow {
  team_id: string;
  user_id: string;
  share_index: number;
  role: string;
  joined_at: Date;
}

// ============================================================================
// Mappers
// ============================================================================

function rowToTeam(row: TeamRow): Team {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    veilkeyGroupId: row.veilkey_group_id ?? undefined,
    threshold: row.threshold,
    totalShares: row.total_shares,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToTeamMember(row: TeamMemberRow): TeamMember {
  return {
    teamId: row.team_id,
    userId: row.user_id,
    shareIndex: row.share_index,
    role: row.role as TeamRole,
    joinedAt: row.joined_at,
  };
}

// ============================================================================
// Repository
// ============================================================================

export const TeamRepository = {
  /**
   * Create a new team
   */
  async create(input: CreateTeamInput): Promise<Team> {
    if (input.threshold > input.totalShares) {
      throw new ValidationError('Threshold cannot exceed total shares');
    }

    if (input.threshold < 1) {
      throw new ValidationError('Threshold must be at least 1');
    }

    const result = await query<TeamRow>(
      `INSERT INTO teams (owner_id, name, description, veilkey_group_id, threshold, total_shares)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        input.ownerId,
        input.name,
        input.description ?? null,
        input.veilkeyGroupId ?? null,
        input.threshold,
        input.totalShares,
      ]
    );

    const team = rowToTeam(result.rows[0]!);

    // Add owner as first member with share_index 1
    await this.addMember({
      teamId: team.id,
      userId: input.ownerId,
      shareIndex: 1,
      role: 'owner',
    });

    return team;
  },

  /**
   * Find team by ID
   */
  async findById(id: TeamId): Promise<Team | null> {
    const result = await query<TeamRow>(
      'SELECT * FROM teams WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToTeam(result.rows[0]!);
  },

  /**
   * Find team by ID or throw
   */
  async findByIdOrThrow(id: TeamId): Promise<Team> {
    const team = await this.findById(id);
    if (!team) {
      throw new NotFoundError('Team', id);
    }
    return team;
  },

  /**
   * Find teams by owner
   */
  async findByOwner(ownerId: UserId): Promise<Team[]> {
    const result = await query<TeamRow>(
      'SELECT * FROM teams WHERE owner_id = $1 ORDER BY created_at DESC',
      [ownerId]
    );

    return result.rows.map(rowToTeam);
  },

  /**
   * Find teams user is a member of
   */
  async findByMember(userId: UserId): Promise<Team[]> {
    const result = await query<TeamRow>(
      `SELECT t.* FROM teams t
       JOIN team_members tm ON t.id = tm.team_id
       WHERE tm.user_id = $1
       ORDER BY t.created_at DESC`,
      [userId]
    );

    return result.rows.map(rowToTeam);
  },

  /**
   * Update team
   */
  async update(id: TeamId, input: UpdateTeamInput): Promise<Team> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.name !== undefined) {
      sets.push(`name = $${paramIndex++}`);
      values.push(input.name);
    }
    if (input.description !== undefined) {
      sets.push(`description = $${paramIndex++}`);
      values.push(input.description);
    }
    if (input.veilkeyGroupId !== undefined) {
      sets.push(`veilkey_group_id = $${paramIndex++}`);
      values.push(input.veilkeyGroupId);
    }

    if (sets.length === 0) {
      return this.findByIdOrThrow(id);
    }

    values.push(id);

    const result = await query<TeamRow>(
      `UPDATE teams SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Team', id);
    }

    return rowToTeam(result.rows[0]!);
  },

  /**
   * Delete team
   */
  async delete(id: TeamId): Promise<void> {
    const result = await query('DELETE FROM teams WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      throw new NotFoundError('Team', id);
    }
  },

  /**
   * Add member to team
   */
  async addMember(input: AddMemberInput): Promise<TeamMember> {
    const team = await this.findByIdOrThrow(input.teamId);

    // Check if share index is valid
    if (input.shareIndex < 1 || input.shareIndex > team.totalShares) {
      throw new ValidationError(
        `Share index must be between 1 and ${team.totalShares}`
      );
    }

    // Check if share index is already taken
    const existingShare = await query<{ user_id: string }>(
      'SELECT user_id FROM team_members WHERE team_id = $1 AND share_index = $2',
      [input.teamId, input.shareIndex]
    );

    if (existingShare.rows.length > 0) {
      throw new DuplicateError('TeamMember', 'share_index');
    }

    try {
      const result = await query<TeamMemberRow>(
        `INSERT INTO team_members (team_id, user_id, share_index, role)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [input.teamId, input.userId, input.shareIndex, input.role ?? 'member']
      );

      return rowToTeamMember(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new DuplicateError('TeamMember', 'user');
      }
      throw error;
    }
  },

  /**
   * Remove member from team
   */
  async removeMember(teamId: TeamId, userId: UserId): Promise<void> {
    // Can't remove the owner
    const team = await this.findByIdOrThrow(teamId);
    const owner = await query<{ owner_id: string }>(
      'SELECT owner_id FROM teams WHERE id = $1',
      [teamId]
    );

    if (owner.rows[0]?.owner_id === userId) {
      throw new ValidationError('Cannot remove team owner');
    }

    const result = await query(
      'DELETE FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('TeamMember', `${teamId}/${userId}`);
    }
  },

  /**
   * Get all members of a team
   */
  async getMembers(teamId: TeamId): Promise<TeamMember[]> {
    const result = await query<TeamMemberRow>(
      'SELECT * FROM team_members WHERE team_id = $1 ORDER BY share_index',
      [teamId]
    );

    return result.rows.map(rowToTeamMember);
  },

  /**
   * Get member by team and user
   */
  async getMember(teamId: TeamId, userId: UserId): Promise<TeamMember | null> {
    const result = await query<TeamMemberRow>(
      'SELECT * FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToTeamMember(result.rows[0]!);
  },

  /**
   * Update member role
   */
  async updateMemberRole(
    teamId: TeamId,
    userId: UserId,
    role: TeamRole
  ): Promise<TeamMember> {
    const result = await query<TeamMemberRow>(
      `UPDATE team_members SET role = $3
       WHERE team_id = $1 AND user_id = $2
       RETURNING *`,
      [teamId, userId, role]
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('TeamMember', `${teamId}/${userId}`);
    }

    return rowToTeamMember(result.rows[0]!);
  },

  /**
   * Check if user is member of team
   */
  async isMember(teamId: TeamId, userId: UserId): Promise<boolean> {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM team_members WHERE team_id = $1 AND user_id = $2',
      [teamId, userId]
    );

    return parseInt(result.rows[0]!.count, 10) > 0;
  },

  /**
   * Get member count
   */
  async getMemberCount(teamId: TeamId): Promise<number> {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM team_members WHERE team_id = $1',
      [teamId]
    );

    return parseInt(result.rows[0]!.count, 10);
  },

  /**
   * Get next available share index
   */
  async getNextShareIndex(teamId: TeamId): Promise<number | null> {
    const team = await this.findByIdOrThrow(teamId);

    const result = await query<{ share_index: number }>(
      'SELECT share_index FROM team_members WHERE team_id = $1 ORDER BY share_index',
      [teamId]
    );

    const usedIndexes = new Set(result.rows.map((r) => r.share_index));

    for (let i = 1; i <= team.totalShares; i++) {
      if (!usedIndexes.has(i)) {
        return i;
      }
    }

    return null; // All shares assigned
  },
};
