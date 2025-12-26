/**
 * Project Repository
 * CRUD operations for projects
 */

import { query, transaction } from '../connection.js';
import { NotFoundError, DuplicateError } from '../../lib/errors.js';
import type { Project, ProjectId, UserId, TeamId, Permission } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

export interface CreateProjectInput {
  ownerId: UserId;
  name: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  isArchived?: boolean;
}

export interface ProjectShare {
  projectId: ProjectId;
  teamId: TeamId;
  permissions: Permission[];
  sharedBy: UserId;
  sharedAt: Date;
}

interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  is_archived: boolean;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Mappers
// ============================================================================

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    description: row.description ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// Repository
// ============================================================================

export const ProjectRepository = {
  /**
   * Create a new project
   */
  async create(input: CreateProjectInput): Promise<Project> {
    try {
      const result = await query<ProjectRow>(
        `INSERT INTO projects (owner_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [input.ownerId, input.name, input.description ?? null]
      );

      return rowToProject(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new DuplicateError('Project', 'name');
      }
      throw error;
    }
  },

  /**
   * Find project by ID
   */
  async findById(id: ProjectId): Promise<Project | null> {
    const result = await query<ProjectRow>(
      'SELECT * FROM projects WHERE id = $1 AND is_archived = false',
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToProject(result.rows[0]!);
  },

  /**
   * Find project by ID or throw
   */
  async findByIdOrThrow(id: ProjectId): Promise<Project> {
    const project = await this.findById(id);
    if (!project) {
      throw new NotFoundError('Project', id);
    }
    return project;
  },

  /**
   * Find all projects owned by a user
   */
  async findByOwner(ownerId: UserId): Promise<Project[]> {
    const result = await query<ProjectRow>(
      `SELECT * FROM projects
       WHERE owner_id = $1 AND is_archived = false
       ORDER BY updated_at DESC`,
      [ownerId]
    );

    return result.rows.map(rowToProject);
  },

  /**
   * Find all projects accessible by a user (owned + shared)
   */
  async findAccessibleByUser(userId: UserId): Promise<Project[]> {
    const result = await query<ProjectRow>(
      `SELECT DISTINCT p.* FROM projects p
       LEFT JOIN project_shares ps ON p.id = ps.project_id
       LEFT JOIN team_members tm ON ps.team_id = tm.team_id
       WHERE (p.owner_id = $1 OR tm.user_id = $1)
       AND p.is_archived = false
       ORDER BY p.updated_at DESC`,
      [userId]
    );

    return result.rows.map(rowToProject);
  },

  /**
   * Update project
   */
  async update(id: ProjectId, input: UpdateProjectInput): Promise<Project> {
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
    if (input.isArchived !== undefined) {
      sets.push(`is_archived = $${paramIndex++}`);
      values.push(input.isArchived);
    }

    if (sets.length === 0) {
      return this.findByIdOrThrow(id);
    }

    values.push(id);

    try {
      const result = await query<ProjectRow>(
        `UPDATE projects SET ${sets.join(', ')} WHERE id = $${paramIndex} AND is_archived = false RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('Project', id);
      }

      return rowToProject(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new DuplicateError('Project', 'name');
      }
      throw error;
    }
  },

  /**
   * Archive project (soft delete)
   */
  async archive(id: ProjectId): Promise<void> {
    const result = await query(
      'UPDATE projects SET is_archived = true WHERE id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Project', id);
    }
  },

  /**
   * Hard delete project
   */
  async delete(id: ProjectId): Promise<void> {
    const result = await query('DELETE FROM projects WHERE id = $1', [id]);

    if (result.rowCount === 0) {
      throw new NotFoundError('Project', id);
    }
  },

  /**
   * Share project with a team
   */
  async share(
    projectId: ProjectId,
    teamId: TeamId,
    permissions: Permission[],
    sharedBy: UserId
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO project_shares (project_id, team_id, permissions, shared_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, team_id)
         DO UPDATE SET permissions = $3`,
        [projectId, teamId, JSON.stringify(permissions), sharedBy]
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23503') {
        throw new NotFoundError('Project or Team', `${projectId}/${teamId}`);
      }
      throw error;
    }
  },

  /**
   * Unshare project from a team
   */
  async unshare(projectId: ProjectId, teamId: TeamId): Promise<void> {
    await query(
      'DELETE FROM project_shares WHERE project_id = $1 AND team_id = $2',
      [projectId, teamId]
    );
  },

  /**
   * Get all shares for a project
   */
  async getShares(projectId: ProjectId): Promise<ProjectShare[]> {
    const result = await query<{
      project_id: string;
      team_id: string;
      permissions: Permission[];
      shared_by: string;
      shared_at: Date;
    }>(
      `SELECT project_id, team_id, permissions, shared_by, shared_at
       FROM project_shares WHERE project_id = $1`,
      [projectId]
    );

    return result.rows.map((row) => ({
      projectId: row.project_id,
      teamId: row.team_id,
      permissions: row.permissions,
      sharedBy: row.shared_by,
      sharedAt: row.shared_at,
    }));
  },

  /**
   * Check if user has permission on project
   */
  async hasPermission(
    projectId: ProjectId,
    userId: UserId,
    permission: Permission
  ): Promise<boolean> {
    // Check if owner
    const ownerResult = await query<{ owner_id: string }>(
      'SELECT owner_id FROM projects WHERE id = $1 AND is_archived = false',
      [projectId]
    );

    if (ownerResult.rows.length === 0) {
      return false;
    }

    if (ownerResult.rows[0]!.owner_id === userId) {
      return true; // Owner has all permissions
    }

    // Check team permissions
    const shareResult = await query<{ permissions: Permission[] }>(
      `SELECT ps.permissions FROM project_shares ps
       JOIN team_members tm ON ps.team_id = tm.team_id
       WHERE ps.project_id = $1 AND tm.user_id = $2`,
      [projectId, userId]
    );

    for (const row of shareResult.rows) {
      if (row.permissions.includes(permission)) {
        return true;
      }
    }

    return false;
  },

  /**
   * Count projects by owner
   */
  async countByOwner(ownerId: UserId): Promise<number> {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM projects WHERE owner_id = $1 AND is_archived = false',
      [ownerId]
    );
    return parseInt(result.rows[0]!.count, 10);
  },
};
