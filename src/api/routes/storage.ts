/**
 * Storage Routes
 * Encrypted blob CRUD operations with VeilChain audit logging
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { getStorageService } from '../../services/storage.js';
import { getAuditService } from '../../services/audit.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { ProjectRepository } from '../../db/repositories/project.js';
import { ForbiddenError, ValidationError } from '../../lib/errors.js';
import type { StoragePutRequest, ProjectId } from '../../types.js';

// ============================================================================
// Request Types
// ============================================================================

interface StorageParams {
  projectId: string;
  envName: string;
}

interface PutStorageBody extends StoragePutRequest {}

// ============================================================================
// Routes
// ============================================================================

export async function storageRoutes(fastify: FastifyInstance): Promise<void> {
  const storage = getStorageService();
  const audit = getAuditService();

  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  /**
   * PUT /v1/storage/:projectId/:envName
   * Store encrypted blob
   */
  fastify.put<{ Params: StorageParams; Body: PutStorageBody }>(
    '/:projectId/:envName',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId', 'envName'],
          properties: {
            projectId: { type: 'string', minLength: 1 },
            envName: { type: 'string', minLength: 1 },
          },
        },
        body: {
          type: 'object',
          required: ['data'],
          properties: {
            data: { type: 'string', description: 'Base64 encoded encrypted data' },
            metadata: { type: 'string', description: 'Encrypted metadata' },
            contentType: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { projectId, envName } = request.params;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(
        projectId,
        user.id,
        'blob:write'
      );
      if (!hasAccess) {
        throw new ForbiddenError('No write access to this project');
      }

      const result = await storage.put(projectId, envName, request.body);

      // Audit log to VeilChain
      await audit.logBlobWrite(
        user.id,
        projectId as ProjectId,
        envName,
        result.size,
        request.ip
      );

      return reply.status(201).send({
        success: true,
        blob: result,
      });
    }
  );

  /**
   * GET /v1/storage/:projectId/:envName
   * Retrieve encrypted blob
   */
  fastify.get<{ Params: StorageParams }>(
    '/:projectId/:envName',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId', 'envName'],
          properties: {
            projectId: { type: 'string', minLength: 1 },
            envName: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { projectId, envName } = request.params;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(
        projectId,
        user.id,
        'blob:read'
      );
      if (!hasAccess) {
        throw new ForbiddenError('No read access to this project');
      }

      const result = await storage.get(projectId, envName);

      // Audit log to VeilChain
      await audit.logBlobRead(
        user.id,
        projectId as ProjectId,
        envName,
        request.ip
      );

      return reply.send(result);
    }
  );

  /**
   * DELETE /v1/storage/:projectId/:envName
   * Delete encrypted blob
   */
  fastify.delete<{ Params: StorageParams }>(
    '/:projectId/:envName',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId', 'envName'],
          properties: {
            projectId: { type: 'string', minLength: 1 },
            envName: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { projectId, envName } = request.params;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(
        projectId,
        user.id,
        'blob:delete'
      );
      if (!hasAccess) {
        throw new ForbiddenError('No delete access to this project');
      }

      await storage.delete(projectId, envName);

      // Audit log to VeilChain
      await audit.logBlobDelete(
        user.id,
        projectId as ProjectId,
        envName,
        request.ip
      );

      return reply.status(204).send();
    }
  );

  /**
   * GET /v1/storage/:projectId
   * List all blobs for a project
   */
  fastify.get<{ Params: { projectId: string }; Querystring: { continuationToken?: string } }>(
    '/:projectId',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId'],
          properties: {
            projectId: { type: 'string', minLength: 1 },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            continuationToken: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { projectId } = request.params;
      const { continuationToken } = request.query;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(
        projectId,
        user.id,
        'blob:read'
      );
      if (!hasAccess) {
        throw new ForbiddenError('No read access to this project');
      }

      const result = await storage.listByProject(projectId, continuationToken);

      return reply.send(result);
    }
  );

  /**
   * HEAD /v1/storage/:projectId/:envName
   * Check if blob exists and get metadata
   */
  fastify.head<{ Params: StorageParams }>(
    '/:projectId/:envName',
    {
      schema: {
        params: {
          type: 'object',
          required: ['projectId', 'envName'],
          properties: {
            projectId: { type: 'string', minLength: 1 },
            envName: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { projectId, envName } = request.params;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(
        projectId,
        user.id,
        'blob:read'
      );
      if (!hasAccess) {
        throw new ForbiddenError('No read access to this project');
      }

      const metadata = await storage.getMetadata(projectId, envName);

      if (!metadata) {
        return reply.status(404).send();
      }

      return reply
        .header('X-VeilCloud-Size', String(metadata.size))
        .header('X-VeilCloud-Hash', metadata.hash)
        .status(200)
        .send();
    }
  );
}
