/**
 * Proofs Routes
 * Cryptographic proof generation and verification via VeilChain
 */

import type { FastifyInstance } from 'fastify';

import { authenticate } from '../middleware/auth.js';
import { getProofService } from '../../services/proof.js';
import { ProjectRepository } from '../../db/repositories/project.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import type { ProjectId } from '../../types.js';

// ============================================================================
// Routes
// ============================================================================

export async function proofRoutes(fastify: FastifyInstance): Promise<void> {
  const proofService = getProofService();

  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  /**
   * GET /v1/proofs/tree
   * Get current Merkle tree state
   */
  fastify.get('/tree', async (request, reply) => {
    const state = await proofService.getTreeState();

    return reply.send({
      root: state.root,
      treeSize: state.treeSize.toString(),
      lastEntryId: state.lastEntryId,
    });
  });

  /**
   * GET /v1/proofs/inclusion/:entryId
   * Generate inclusion proof for an audit entry
   */
  fastify.get<{ Params: { entryId: string } }>(
    '/inclusion/:entryId',
    async (request, reply) => {
      const { entryId } = request.params;

      const proof = await proofService.generateInclusionProof(entryId);

      return reply.send({
        ...proof,
        index: proof.index.toString(),
        treeSize: proof.treeSize.toString(),
      });
    }
  );

  /**
   * POST /v1/proofs/inclusion/verify
   * Verify an inclusion proof
   */
  fastify.post<{
    Body: {
      entryId: string;
      entryHash: string;
      root: string;
      proof: string[];
      index: string;
      treeSize: string;
    };
  }>(
    '/inclusion/verify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['entryId', 'entryHash', 'root', 'proof', 'index', 'treeSize'],
          properties: {
            entryId: { type: 'string' },
            entryHash: { type: 'string' },
            root: { type: 'string' },
            proof: { type: 'array', items: { type: 'string' } },
            index: { type: 'string' },
            treeSize: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body;

      const result = await proofService.verifyInclusionProof({
        entryId: body.entryId,
        entryHash: body.entryHash,
        root: body.root,
        proof: body.proof,
        index: BigInt(body.index),
        treeSize: BigInt(body.treeSize),
      });

      return reply.send(result);
    }
  );

  /**
   * POST /v1/proofs/snapshots/:projectId
   * Create an audit snapshot for a project
   */
  fastify.post<{ Params: { projectId: string } }>(
    '/snapshots/:projectId',
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

      const snapshot = await proofService.createSnapshot(projectId as ProjectId);

      return reply.status(201).send({
        ...snapshot,
        treeSize: snapshot.treeSize.toString(),
      });
    }
  );

  /**
   * GET /v1/proofs/snapshots/:projectId
   * List snapshots for a project
   */
  fastify.get<{
    Params: { projectId: string };
    Querystring: { limit?: number };
  }>(
    '/snapshots/:projectId',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            limit: { type: 'number', minimum: 1, maximum: 100, default: 10 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { projectId } = request.params;
      const { limit } = request.query;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(
        projectId,
        user.id,
        'audit:read'
      );
      if (!hasAccess) {
        throw new ForbiddenError('Access denied');
      }

      const snapshots = await proofService.listSnapshots(
        projectId as ProjectId,
        limit ?? 10
      );

      return reply.send({
        snapshots: snapshots.map((s) => ({
          ...s,
          treeSize: s.treeSize.toString(),
        })),
      });
    }
  );

  /**
   * POST /v1/proofs/consistency
   * Generate consistency proof between two snapshots
   */
  fastify.post<{
    Body: {
      fromSnapshotId: string;
      toSnapshotId: string;
    };
  }>(
    '/consistency',
    {
      schema: {
        body: {
          type: 'object',
          required: ['fromSnapshotId', 'toSnapshotId'],
          properties: {
            fromSnapshotId: { type: 'string', format: 'uuid' },
            toSnapshotId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      const { fromSnapshotId, toSnapshotId } = request.body;

      const proof = await proofService.generateConsistencyProof(
        fromSnapshotId,
        toSnapshotId
      );

      return reply.send({
        ...proof,
        treeSize: {
          from: proof.treeSize.from.toString(),
          to: proof.treeSize.to.toString(),
        },
      });
    }
  );

  /**
   * POST /v1/proofs/consistency/verify
   * Verify a consistency proof
   */
  fastify.post<{
    Body: {
      fromRoot: string;
      toRoot: string;
      proof: string[];
      treeSize: {
        from: string;
        to: string;
      };
    };
  }>(
    '/consistency/verify',
    {
      schema: {
        body: {
          type: 'object',
          required: ['fromRoot', 'toRoot', 'proof', 'treeSize'],
          properties: {
            fromRoot: { type: 'string' },
            toRoot: { type: 'string' },
            proof: { type: 'array', items: { type: 'string' } },
            treeSize: {
              type: 'object',
              required: ['from', 'to'],
              properties: {
                from: { type: 'string' },
                to: { type: 'string' },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const body = request.body;

      const result = await proofService.verifyConsistencyProof({
        fromRoot: body.fromRoot,
        toRoot: body.toRoot,
        proof: body.proof,
        treeSize: {
          from: BigInt(body.treeSize.from),
          to: BigInt(body.treeSize.to),
        },
      });

      return reply.send(result);
    }
  );

  /**
   * POST /v1/proofs/export
   * Export proof bundle for offline verification
   */
  fastify.post<{
    Body: { entryIds: string[] };
  }>(
    '/export',
    {
      schema: {
        body: {
          type: 'object',
          required: ['entryIds'],
          properties: {
            entryIds: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 100,
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { entryIds } = request.body;

      const bundle = await proofService.exportProofBundle(entryIds);

      return reply.send({
        ...bundle,
        entries: bundle.entries.map((e) => ({
          ...e,
          proof: {
            ...e.proof,
            index: e.proof.index.toString(),
            treeSize: e.proof.treeSize.toString(),
          },
        })),
      });
    }
  );
}
