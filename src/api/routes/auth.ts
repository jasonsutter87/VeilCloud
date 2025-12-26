/**
 * Auth Routes
 * User registration, login, and credential management
 */

import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'crypto';

import { UserRepository } from '../../db/repositories/user.js';
import { query } from '../../db/connection.js';
import { getVeilSignClient } from '../../integrations/veilsign.js';
import { authenticate } from '../middleware/auth.js';
import {
  ValidationError,
  UnauthorizedError,
  DuplicateError,
} from '../../lib/errors.js';

// ============================================================================
// Types
// ============================================================================

interface RegisterBody {
  email: string;
  password?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

// ============================================================================
// Routes
// ============================================================================

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/auth/register
   * Create a new account
   */
  fastify.post<{ Body: RegisterBody }>(
    '/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string', minLength: 8 },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      // Hash password if provided
      let passwordHash: string | undefined;
      if (password) {
        // Simple hash for now - in production use bcrypt
        passwordHash = createHash('sha256').update(password).digest('hex');
      }

      const user = await UserRepository.create({
        email: email.toLowerCase(),
        passwordHash,
      });

      // Issue VeilSign credential
      const veilsign = getVeilSignClient();
      let credential: { credential: string; signature: string; expiresAt: Date } | null = null;

      try {
        credential = await veilsign.issueCredential({
          userId: user.id,
          projectId: '*',
          permissions: ['project:read', 'project:write', 'project:delete', 'project:share', 'team:manage', 'audit:read'],
          expiresInSeconds: 86400, // 24 hours
        });

        // Store credential ID on user
        await UserRepository.update(user.id, {
          veilsignCredentialId: credential.credential.substring(0, 32),
        });
      } catch {
        // VeilSign not available - continue without credential
      }

      return reply.status(201).send({
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
        },
        credential: credential
          ? {
              credential: credential.credential,
              signature: credential.signature,
              expiresAt: credential.expiresAt,
            }
          : null,
      });
    }
  );

  /**
   * POST /v1/auth/login
   * Authenticate and get credential
   */
  fastify.post<{ Body: LoginBody }>(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string', format: 'email' },
            password: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body;

      // Get user and password hash
      const user = await UserRepository.findByEmail(email.toLowerCase());
      if (!user) {
        throw new UnauthorizedError('Invalid email or password');
      }

      const storedHash = await UserRepository.getPasswordHash(email.toLowerCase());
      if (!storedHash) {
        throw new UnauthorizedError('Invalid email or password');
      }

      // Verify password
      const inputHash = createHash('sha256').update(password).digest('hex');
      if (inputHash !== storedHash) {
        throw new UnauthorizedError('Invalid email or password');
      }

      // Issue VeilSign credential
      const veilsign = getVeilSignClient();
      let credential: { credential: string; signature: string; expiresAt: Date } | null = null;

      try {
        credential = await veilsign.issueCredential({
          userId: user.id,
          projectId: '*',
          permissions: ['project:read', 'project:write', 'project:delete', 'project:share', 'team:manage', 'audit:read'],
          expiresInSeconds: 86400,
        });
      } catch {
        // VeilSign not available
      }

      return reply.send({
        user: {
          id: user.id,
          email: user.email,
        },
        credential: credential
          ? {
              credential: credential.credential,
              signature: credential.signature,
              expiresAt: credential.expiresAt,
            }
          : null,
      });
    }
  );

  /**
   * POST /v1/auth/refresh
   * Refresh credential
   */
  fastify.post(
    '/refresh',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = request.user!;

      const veilsign = getVeilSignClient();
      const credential = await veilsign.issueCredential({
        userId: user.id,
        projectId: '*',
        permissions: user.permissions,
        expiresInSeconds: 86400,
      });

      return reply.send({
        credential: credential.credential,
        signature: credential.signature,
        expiresAt: credential.expiresAt,
      });
    }
  );

  /**
   * GET /v1/auth/me
   * Get current user
   */
  fastify.get(
    '/me',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = request.user!;

      return reply.send({
        id: user.id,
        email: user.email,
        permissions: user.permissions,
        createdAt: user.createdAt,
      });
    }
  );

  /**
   * POST /v1/auth/api-keys
   * Create API key
   */
  fastify.post<{ Body: { name?: string; permissions?: string[]; expiresInDays?: number } }>(
    '/api-keys',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            permissions: { type: 'array', items: { type: 'string' } },
            expiresInDays: { type: 'number', minimum: 1, maximum: 365 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { name, permissions, expiresInDays } = request.body;

      // Generate API key
      const keyValue = `vc_${randomBytes(32).toString('hex')}`;
      const keyHash = createHash('sha256').update(keyValue).digest('hex');
      const keyPrefix = keyValue.substring(0, 12);

      // Calculate expiration
      const expiresAt = expiresInDays
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null;

      const result = await query<{ id: string; created_at: Date }>(
        `INSERT INTO api_keys (user_id, key_hash, key_prefix, name, permissions, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, created_at`,
        [
          user.id,
          keyHash,
          keyPrefix,
          name ?? 'API Key',
          JSON.stringify(permissions ?? ['project:read']),
          expiresAt,
        ]
      );

      return reply.status(201).send({
        id: result.rows[0]!.id,
        key: keyValue, // Only shown once!
        name: name ?? 'API Key',
        permissions: permissions ?? ['project:read'],
        expiresAt,
        createdAt: result.rows[0]!.created_at,
      });
    }
  );

  /**
   * GET /v1/auth/api-keys
   * List API keys
   */
  fastify.get(
    '/api-keys',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = request.user!;

      const result = await query<{
        id: string;
        key_prefix: string;
        name: string;
        permissions: string[];
        last_used_at: Date | null;
        expires_at: Date | null;
        is_active: boolean;
        created_at: Date;
      }>(
        `SELECT id, key_prefix, name, permissions, last_used_at, expires_at, is_active, created_at
         FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
        [user.id]
      );

      return reply.send({
        keys: result.rows.map((row) => ({
          id: row.id,
          prefix: row.key_prefix,
          name: row.name,
          permissions: row.permissions,
          lastUsedAt: row.last_used_at,
          expiresAt: row.expires_at,
          isActive: row.is_active,
          createdAt: row.created_at,
        })),
      });
    }
  );

  /**
   * DELETE /v1/auth/api-keys/:id
   * Revoke API key
   */
  fastify.delete<{ Params: { id: string } }>(
    '/api-keys/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;

      const result = await query(
        'UPDATE api_keys SET is_active = false WHERE id = $1 AND user_id = $2',
        [id, user.id]
      );

      if (result.rowCount === 0) {
        return reply.status(404).send({ error: 'API key not found' });
      }

      return reply.status(204).send();
    }
  );
}
