/**
 * User Repository
 * CRUD operations for users
 */

import { query, transaction } from '../connection.js';
import { NotFoundError, DuplicateError } from '../../lib/errors.js';
import type { User, UserId } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

export interface CreateUserInput {
  email: string;
  passwordHash?: string;
  veilsignCredentialId?: string;
  displayName?: string;
  avatarUrl?: string;
}

export interface UpdateUserInput {
  email?: string;
  passwordHash?: string;
  veilsignCredentialId?: string;
  displayName?: string;
  avatarUrl?: string;
  isActive?: boolean;
}

interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  veilsign_credential_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// ============================================================================
// Mappers
// ============================================================================

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ============================================================================
// Repository
// ============================================================================

export const UserRepository = {
  /**
   * Create a new user
   */
  async create(input: CreateUserInput): Promise<User> {
    try {
      const result = await query<UserRow>(
        `INSERT INTO users (email, password_hash, veilsign_credential_id, display_name, avatar_url)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          input.email,
          input.passwordHash ?? null,
          input.veilsignCredentialId ?? null,
          input.displayName ?? null,
          input.avatarUrl ?? null,
        ]
      );

      return rowToUser(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new DuplicateError('User', 'email');
      }
      throw error;
    }
  },

  /**
   * Find user by ID
   */
  async findById(id: UserId): Promise<User | null> {
    const result = await query<UserRow>(
      'SELECT * FROM users WHERE id = $1 AND is_active = true',
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToUser(result.rows[0]!);
  },

  /**
   * Find user by ID or throw
   */
  async findByIdOrThrow(id: UserId): Promise<User> {
    const user = await this.findById(id);
    if (!user) {
      throw new NotFoundError('User', id);
    }
    return user;
  },

  /**
   * Find user by email
   */
  async findByEmail(email: string): Promise<User | null> {
    const result = await query<UserRow>(
      'SELECT * FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToUser(result.rows[0]!);
  },

  /**
   * Find user by VeilSign credential ID
   */
  async findByCredentialId(credentialId: string): Promise<User | null> {
    const result = await query<UserRow>(
      'SELECT * FROM users WHERE veilsign_credential_id = $1 AND is_active = true',
      [credentialId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return rowToUser(result.rows[0]!);
  },

  /**
   * Update user
   */
  async update(id: UserId, input: UpdateUserInput): Promise<User> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (input.email !== undefined) {
      sets.push(`email = $${paramIndex++}`);
      values.push(input.email.toLowerCase());
    }
    if (input.passwordHash !== undefined) {
      sets.push(`password_hash = $${paramIndex++}`);
      values.push(input.passwordHash);
    }
    if (input.veilsignCredentialId !== undefined) {
      sets.push(`veilsign_credential_id = $${paramIndex++}`);
      values.push(input.veilsignCredentialId);
    }
    if (input.displayName !== undefined) {
      sets.push(`display_name = $${paramIndex++}`);
      values.push(input.displayName);
    }
    if (input.avatarUrl !== undefined) {
      sets.push(`avatar_url = $${paramIndex++}`);
      values.push(input.avatarUrl);
    }
    if (input.isActive !== undefined) {
      sets.push(`is_active = $${paramIndex++}`);
      values.push(input.isActive);
    }

    if (sets.length === 0) {
      return this.findByIdOrThrow(id);
    }

    values.push(id);

    try {
      const result = await query<UserRow>(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        throw new NotFoundError('User', id);
      }

      return rowToUser(result.rows[0]!);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new DuplicateError('User', 'email');
      }
      throw error;
    }
  },

  /**
   * Soft delete user (set is_active = false)
   */
  async delete(id: UserId): Promise<void> {
    const result = await query(
      'UPDATE users SET is_active = false WHERE id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      throw new NotFoundError('User', id);
    }
  },

  /**
   * Hard delete user (for testing)
   */
  async hardDelete(id: UserId): Promise<void> {
    await query('DELETE FROM users WHERE id = $1', [id]);
  },

  /**
   * Get password hash for authentication
   */
  async getPasswordHash(email: string): Promise<string | null> {
    const result = await query<{ password_hash: string | null }>(
      'SELECT password_hash FROM users WHERE email = $1 AND is_active = true',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0]!.password_hash;
  },

  /**
   * Count all active users
   */
  async count(): Promise<number> {
    const result = await query<{ count: string }>(
      'SELECT COUNT(*) as count FROM users WHERE is_active = true'
    );
    return parseInt(result.rows[0]!.count, 10);
  },
};
