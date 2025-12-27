/**
 * Access Routes
 * Privacy-preserving credentials via VeilSign
 */

import type { FastifyInstance } from 'fastify';

import { authenticate } from '../middleware/auth.js';
import { getAccessService } from '../../services/access.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';
import type { ProjectId, TeamId, Permission } from '../../types.js';

// ============================================================================
// Routes
// ============================================================================

export async function accessRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * POST /v1/access/issue
   * Issue a new access credential
   */
  fastify.post<{
    Body: {
      projectId?: string;
      teamId?: string;
      permissions: Permission[];
      expiresIn?: string;
    };
  }>(
    '/issue',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['permissions'],
          properties: {
            projectId: { type: 'string', format: 'uuid' },
            teamId: { type: 'string', format: 'uuid' },
            permissions: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
            },
            expiresIn: {
              type: 'string',
              pattern: '^\\d+(h|d|w|m)$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { projectId, teamId, permissions, expiresIn } = request.body;

      const accessService = getAccessService();

      const result = await accessService.issueCredential({
        userId: user.id,
        projectId: projectId as ProjectId | undefined,
        teamId: teamId as TeamId | undefined,
        permissions,
        expiresIn,
        ipAddress: request.ip,
      });

      return reply.status(201).send(result);
    }
  );

  /**
   * POST /v1/access/issue/one-time
   * Issue a one-time access credential
   */
  fastify.post<{
    Body: {
      projectId?: string;
      teamId?: string;
      permissions: Permission[];
      expiresIn?: string;
    };
  }>(
    '/issue/one-time',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['permissions'],
          properties: {
            projectId: { type: 'string', format: 'uuid' },
            teamId: { type: 'string', format: 'uuid' },
            permissions: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
            },
            expiresIn: {
              type: 'string',
              pattern: '^\\d+(h|d|w|m)$',
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { projectId, teamId, permissions, expiresIn } = request.body;

      const accessService = getAccessService();

      const result = await accessService.issueOneTimeCredential({
        userId: user.id,
        projectId: projectId as ProjectId | undefined,
        teamId: teamId as TeamId | undefined,
        permissions,
        expiresIn,
        ipAddress: request.ip,
      });

      return reply.status(201).send({
        ...result,
        oneTime: true,
      });
    }
  );

  /**
   * POST /v1/access/verify
   * Verify a credential (public endpoint - no auth required)
   */
  fastify.post<{
    Body: {
      credential: string;
      requiredPermissions?: Permission[];
      projectId?: string;
      teamId?: string;
    };
  }>(
    '/verify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['credential'],
          properties: {
            credential: { type: 'string', minLength: 1 },
            requiredPermissions: {
              type: 'array',
              items: { type: 'string' },
            },
            projectId: { type: 'string', format: 'uuid' },
            teamId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const { credential, requiredPermissions, projectId, teamId } = request.body;

      const accessService = getAccessService();

      const result = await accessService.verifyCredential({
        credential,
        requiredPermissions,
        projectId: projectId as ProjectId | undefined,
        teamId: teamId as TeamId | undefined,
      });

      return reply.send(result);
    }
  );

  /**
   * POST /v1/access/verify/one-time
   * Verify and consume a one-time credential
   */
  fastify.post<{
    Body: {
      credential: string;
      requiredPermissions?: Permission[];
    };
  }>(
    '/verify/one-time',
    {
      schema: {
        body: {
          type: 'object',
          required: ['credential'],
          properties: {
            credential: { type: 'string', minLength: 1 },
            requiredPermissions: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { credential, requiredPermissions } = request.body;

      const accessService = getAccessService();

      const result = await accessService.verifyAndConsumeOneTime(
        credential,
        requiredPermissions
      );

      return reply.send(result);
    }
  );

  /**
   * POST /v1/access/revoke
   * Revoke a credential
   */
  fastify.post<{
    Body: {
      credentialId: string;
      reason?: string;
    };
  }>(
    '/revoke',
    {
      preHandler: authenticate,
      schema: {
        body: {
          type: 'object',
          required: ['credentialId'],
          properties: {
            credentialId: { type: 'string', minLength: 1 },
            reason: { type: 'string', maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { credentialId, reason } = request.body;

      const accessService = getAccessService();

      await accessService.revokeCredential({
        credentialId,
        userId: user.id,
        reason,
        ipAddress: request.ip,
      });

      return reply.send({ message: 'Credential revoked' });
    }
  );

  /**
   * GET /v1/access/credentials
   * List user's credentials
   */
  fastify.get<{
    Querystring: {
      projectId?: string;
      includeExpired?: boolean;
    };
  }>(
    '/credentials',
    {
      preHandler: authenticate,
      schema: {
        querystring: {
          type: 'object',
          properties: {
            projectId: { type: 'string', format: 'uuid' },
            includeExpired: { type: 'boolean', default: false },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { projectId, includeExpired } = request.query;

      const accessService = getAccessService();

      const credentials = await accessService.listCredentials(user.id, {
        projectId: projectId as ProjectId | undefined,
        includeExpired,
      });

      return reply.send({ credentials });
    }
  );

  /**
   * GET /v1/access/credentials/:credentialId
   * Get credential details
   */
  fastify.get<{ Params: { credentialId: string } }>(
    '/credentials/:credentialId',
    {
      preHandler: authenticate,
    },
    async (request, reply) => {
      const user = request.user!;
      const { credentialId } = request.params;

      const accessService = getAccessService();

      const credentials = await accessService.listCredentials(user.id, {
        includeExpired: true,
      });

      const credential = credentials.find((c) => c.id === credentialId);
      if (!credential) {
        throw new ForbiddenError('Credential not found or not yours');
      }

      return reply.send({ credential });
    }
  );
}
