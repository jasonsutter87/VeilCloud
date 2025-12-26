/**
 * Environment Repository
 * CRUD operations for project environments
 */

import { query } from '../connection.js';
import { NotFoundError, DuplicateError } from '../../lib/errors.js';
import type { Environment, ProjectId } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

export interface CreateEnvironmentInput {
  projectId: ProjectId;
  name: string;
  blobKey: string;
  blobHash?: string;
  blobSize?: number;
}

export interface UpdateEnvironmentInput {
  blobKey?: string;
  blobHash?: string;
  blobSize?: number;
}

interface EnvironmentRow {
  id: string;
  project_id: string;
  name: string;
  blob_key: string;
  blob_hash: string | null;
  blob_size: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Mappers
// ============================================================================

function rowToEnvironment(row: EnvironmentRow): Environment {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    blobKey: row.blob_key,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// Repository
// ============================================================================

export const EnvironmentRepository = {
  /**
   * Create a new environment
   */
  async create(input: CreateEnvironmentInput): Promise<Environment> {
    try {
      const result = await query<EnvironmentRow>(
        `INSERT INTO environments (project_id, name, blob_key, blob_hash, blob_size)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          input.projectId,
          input.name,
          input.blobKey,
          input.blobHash ?? null,
          input.blobSize ?? 0,
        ]
      );

      return rowToEnvironment(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new DuplicateError('Environment', 'name');
      }
      if ((error as { code?: string }).code === '23503') {
        throw new NotFoundError('Project', input.projectId);
      }
      throw error;
    }
  },

  /**
   * Find environment by ID
   */
  async findById(id: string): Promise<Environment | null> {
    const result = await query<EnvironmentRow>(
      'SELECT * FROM environments WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToEnvironment(result.rows[0]!);
  },

  /**
   * Find environment by project and name
   */
  async findByProjectAndName(
    projectId: ProjectId,
    name: string
  ): Promise<Environment | null> {
    const result = await query<EnvironmentRow>(
      'SELECT * FROM environments WHERE project_id = $1 AND name = $2',
      [projectId, name]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToEnvironment(result.rows[0]!);
  },

  /**
   * Find all environments for a project
   */
  async findByProject(projectId: ProjectId): Promise<Environment[]> {
    const result = await query<EnvironmentRow>(
      `SELECT * FROM environments
       WHERE project_id = $1
       ORDER BY
         CASE name
           WHEN 'development' THEN 1
           WHEN 'staging' THEN 2
           WHEN 'production' THEN 3
           ELSE 4
         END,
         name`,
      [projectId]
    );

    return result.rows.map(rowToEnvironment);
  },

  /**
   * Update environment (increments version)
   */
  async update(
    projectId: ProjectId,
    name: string,
    input: UpdateEnvironmentInput
  ): Promise<Environment> {
    const sets: string[] = ['version = version + 1'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.blobKey !== undefined) {
      sets.push(`blob_key = $${paramIndex++}`);
      values.push(input.blobKey);
    }
    if (input.blobHash !== undefined) {
      sets.push(`blob_hash = $${paramIndex++}`);
      values.push(input.blobHash);
    }
    if (input.blobSize !== undefined) {
      sets.push(`blob_size = $${paramIndex++}`);
      values.push(input.blobSize);
    }

    values.push(projectId, name);

    const result = await query<EnvironmentRow>(
      `UPDATE environments SET ${sets.join(', ')}
       WHERE project_id = $${paramIndex++} AND name = $${paramIndex}
       RETURNING *`,
      values
    );

    if (result.rows.length === 0) {
      throw new NotFoundError('Environment', `${projectId}/${name}`);
    }

    return rowToEnvironment(result.rows[0]!);
  },

  /**
   * Delete environment
   */
  async delete(projectId: ProjectId, name: string): Promise<void> {
    const result = await query(
      'DELETE FROM environments WHERE project_id = $1 AND name = $2',
      [projectId, name]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('Environment', `${projectId}/${name}`);
    }
  },

  /**
   * Delete all environments for a project
   */
  async deleteByProject(projectId: ProjectId): Promise<number> {
    const result = await query(
      'DELETE FROM environments WHERE project_id = $1',
      [projectId]
    );

    return result.rowCount ?? 0;
  },

  /**
   * Clone an environment
   */
  async clone(
    projectId: ProjectId,
    sourceName: string,
    targetName: string,
    newBlobKey: string
  ): Promise<Environment> {
    const source = await this.findByProjectAndName(projectId, sourceName);
    if (!source) {
      throw new NotFoundError('Environment', `${projectId}/${sourceName}`);
    }

    return this.create({
      projectId,
      name: targetName,
      blobKey: newBlobKey,
    });
  },

  /**
   * Count environments for a project
   */
  async countByProject(projectId: ProjectId): Promise<number> {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM environments WHERE project_id = $1',
      [projectId]
    );

    return parseInt(result.rows[0]!.count, 10);
  },

  /**
   * Check if environment exists
   */
  async exists(projectId: ProjectId, name: string): Promise<boolean> {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM environments WHERE project_id = $1 AND name = $2',
      [projectId, name]
    );

    return parseInt(result.rows[0]!.count, 10) > 0;
  },
};
