/**
 * Storage Routes
 * Encrypted blob CRUD operations
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getStorageService } from '../../services/storage.js';
import { ValidationError } from '../../lib/errors.js';
import type { StoragePutRequest } from '../../types.js';

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
      const { projectId, envName } = request.params;

      // TODO: Verify credential has project:write permission
      // const credential = request.headers['x-veilcloud-credential'];

      const result = await storage.put(projectId, envName, request.body);

      // TODO: Log to VeilChain
      // await audit.log({ action: 'blob.write', projectId, ... });

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
      const { projectId, envName } = request.params;

      // TODO: Verify credential has project:read permission

      const result = await storage.get(projectId, envName);

      // TODO: Log to VeilChain
      // await audit.log({ action: 'blob.read', projectId, ... });

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
      const { projectId, envName } = request.params;

      // TODO: Verify credential has project:delete permission

      await storage.delete(projectId, envName);

      // TODO: Log to VeilChain
      // await audit.log({ action: 'blob.delete', projectId, ... });

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
      const { projectId } = request.params;
      const { continuationToken } = request.query;

      // TODO: Verify credential has project:read permission

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
      const { projectId, envName } = request.params;

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
