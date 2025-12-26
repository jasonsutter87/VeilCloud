/**
 * Audit Routes
 * VeilChain integration for immutable audit logs
 */

import type { FastifyInstance } from 'fastify';

import { ProjectRepository } from '../../db/repositories/project.js';
import { getVeilChainClient } from '../../integrations/veilchain.js';
import { authenticate } from '../middleware/auth.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import type { AuditAction, MerkleProof } from '../../types.js';

// ============================================================================
// Routes
// ============================================================================

export async function auditRoutes(fastify: FastifyInstance): Promise<void> {
  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  /**
   * GET /v1/audit/:projectId
   * Get audit trail for a project
   */
  fastify.get<{
    Params: { projectId: string };
    Querystring: {
      action?: AuditAction;
      userId?: string;
      limit?: number;
      offset?: number;
      startDate?: string;
      endDate?: string;
    };
  }>(
    '/:projectId',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            action: { type: 'string' },
            userId: { type: 'string' },
            limit: { type: 'number', minimum: 1, maximum: 100, default: 50 },
            offset: { type: 'number', minimum: 0, default: 0 },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { projectId } = request.params;
      const { action, userId, limit, offset, startDate, endDate } = request.query;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(
        projectId,
        user.id,
        'audit:read'
      );
      if (!hasAccess) {
        throw new ForbiddenError('Access denied to audit logs');
      }

      const veilchain = getVeilChainClient();

      const result = await veilchain.getAuditTrail({
        projectId,
        action,
        userId,
        limit: limit ?? 50,
        offset: offset ?? 0,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      });

      return reply.send(result);
    }
  );

  /**
   * GET /v1/audit/:projectId/proof/:entryId
   * Get Merkle proof for an audit entry
   */
  fastify.get<{ Params: { projectId: string; entryId: string } }>(
    '/:projectId/proof/:entryId',
    async (request, reply) => {
      const user = request.user!;
      const { projectId, entryId } = request.params;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(
        projectId,
        user.id,
        'audit:read'
      );
      if (!hasAccess) {
        throw new ForbiddenError('Access denied');
      }

      const veilchain = getVeilChainClient();
      const proof = await veilchain.getProof(entryId);

      return reply.send({ proof });
    }
  );

  /**
   * POST /v1/audit/verify
   * Verify a Merkle proof (can be done offline)
   */
  fastify.post<{ Body: { proof: MerkleProof } }>(
    '/verify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['proof'],
          properties: {
            proof: {
              type: 'object',
              required: ['leaf', 'index', 'proof', 'directions', 'root'],
              properties: {
                leaf: { type: 'string' },
                index: { type: 'number' },
                proof: { type: 'array', items: { type: 'string' } },
                directions: { type: 'array', items: { type: 'string' } },
                root: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { proof } = request.body;

      const veilchain = getVeilChainClient();
      const valid = await veilchain.verifyProof(proof);

      return reply.send({ valid });
    }
  );

  /**
   * GET /v1/audit/:projectId/root
   * Get current root hash
   */
  fastify.get<{ Params: { projectId: string } }>(
    '/:projectId/root',
    async (request, reply) => {
      const user = request.user!;
      const { projectId } = request.params;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(
        projectId,
        user.id,
        'audit:read'
      );
      if (!hasAccess) {
        throw new ForbiddenError('Access denied');
      }

      const veilchain = getVeilChainClient();
      const root = await veilchain.getRootHash();

      return reply.send({ root, timestamp: new Date().toISOString() });
    }
  );

  /**
   * GET /v1/audit/:projectId/export
   * Export audit trail
   */
  fastify.get<{
    Params: { projectId: string };
    Querystring: { format?: 'json' | 'csv' };
  }>(
    '/:projectId/export',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['json', 'csv'], default: 'json' },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { projectId } = request.params;
      const { format } = request.query;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(
        projectId,
        user.id,
        'audit:read'
      );
      if (!hasAccess) {
        throw new ForbiddenError('Access denied');
      }

      const veilchain = getVeilChainClient();
      const result = await veilchain.getAuditTrail({
        projectId,
        limit: 1000, // Max export
      });

      if (format === 'csv') {
        const headers = 'entryId,action,userId,projectId,timestamp\n';
        const rows = result.entries
          .map(
            (e) =>
              `${e.entryId},${e.action},${e.userId},${e.projectId ?? ''},${e.timestamp.toISOString()}`
          )
          .join('\n');

        return reply
          .header('Content-Type', 'text/csv')
          .header(
            'Content-Disposition',
            `attachment; filename="audit-${projectId}.csv"`
          )
          .send(headers + rows);
      }

      return reply.send(result);
    }
  );
}
