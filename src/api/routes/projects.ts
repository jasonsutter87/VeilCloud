/**
 * Project Routes
 * Project CRUD and sharing operations with VeilChain audit logging
 */

import type { FastifyInstance } from 'fastify';

import { ProjectRepository } from '../../db/repositories/project.js';
import { EnvironmentRepository } from '../../db/repositories/environment.js';
import { getStorageService } from '../../services/storage.js';
import { getAuditService } from '../../services/audit.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { NotFoundError, ForbiddenError } from '../../lib/errors.js';
import type { Permission, ProjectId, TeamId } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

interface CreateProjectBody {
  name: string;
  description?: string;
}

interface UpdateProjectBody {
  name?: string;
  description?: string;
}

interface ShareProjectBody {
  teamId: string;
  permissions?: Permission[];
}

// ============================================================================
// Routes
// ============================================================================

export async function projectRoutes(fastify: FastifyInstance): Promise<void> {
  const audit = getAuditService();

  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  /**
   * POST /v1/projects
   * Create a new project
   */
  fastify.post<{ Body: CreateProjectBody }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { name, description } = request.body;

      const project = await ProjectRepository.create({
        ownerId: user.id,
        name,
        description,
      });

      // Audit log
      await audit.logProjectCreate(
        user.id,
        project.id as ProjectId,
        name,
        request.ip
      );

      return reply.status(201).send({ project });
    }
  );

  /**
   * GET /v1/projects
   * List accessible projects
   */
  fastify.get('/', async (request, reply) => {
    const user = request.user!;

    const projects = await ProjectRepository.findAccessibleByUser(user.id);

    return reply.send({ projects });
  });

  /**
   * GET /v1/projects/:id
   * Get project details
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;

      const project = await ProjectRepository.findById(id);
      if (!project) {
        throw new NotFoundError('Project', id);
      }

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(id, user.id, 'project:read');
      if (!hasAccess) {
        throw new ForbiddenError('Access denied to this project');
      }

      // Get environments
      const environments = await EnvironmentRepository.findByProject(id);

      // Get shares
      const shares = await ProjectRepository.getShares(id);

      return reply.send({
        project,
        environments: environments.map((e) => ({
          name: e.name,
          version: e.version,
          updatedAt: e.updatedAt,
        })),
        shares,
      });
    }
  );

  /**
   * PATCH /v1/projects/:id
   * Update project
   */
  fastify.patch<{ Params: { id: string }; Body: UpdateProjectBody }>(
    '/:id',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;

      // Check ownership
      const project = await ProjectRepository.findById(id);
      if (!project) {
        throw new NotFoundError('Project', id);
      }
      if (project.ownerId !== user.id) {
        throw new ForbiddenError('Only the owner can update this project');
      }

      const updated = await ProjectRepository.update(id, request.body);

      return reply.send({ project: updated });
    }
  );

  /**
   * DELETE /v1/projects/:id
   * Delete project
   */
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;

      // Check ownership
      const project = await ProjectRepository.findById(id);
      if (!project) {
        throw new NotFoundError('Project', id);
      }
      if (project.ownerId !== user.id) {
        throw new ForbiddenError('Only the owner can delete this project');
      }

      // Delete storage blobs
      const storage = getStorageService();
      await storage.deleteByProject(id);

      // Audit log before delete
      await audit.log({
        action: 'project.delete',
        userId: user.id,
        projectId: id as ProjectId,
        context: { projectName: project.name },
        ipAddress: request.ip,
      });

      // Delete project (cascade deletes environments, shares)
      await ProjectRepository.delete(id);

      return reply.status(204).send();
    }
  );

  /**
   * POST /v1/projects/:id/share
   * Share project with team
   */
  fastify.post<{ Params: { id: string }; Body: ShareProjectBody }>(
    '/:id/share',
    {
      schema: {
        body: {
          type: 'object',
          required: ['teamId'],
          properties: {
            teamId: { type: 'string', format: 'uuid' },
            permissions: {
              type: 'array',
              items: { type: 'string' },
              default: ['project:read'],
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;
      const { teamId, permissions } = request.body;

      // Check ownership
      const project = await ProjectRepository.findById(id);
      if (!project) {
        throw new NotFoundError('Project', id);
      }
      if (project.ownerId !== user.id) {
        throw new ForbiddenError('Only the owner can share this project');
      }

      await ProjectRepository.share(
        id,
        teamId,
        permissions ?? ['project:read'],
        user.id
      );

      // Audit log
      await audit.logProjectShare(
        user.id,
        id as ProjectId,
        teamId as TeamId,
        permissions ?? ['project:read'],
        request.ip
      );

      return reply.status(201).send({ success: true });
    }
  );

  /**
   * DELETE /v1/projects/:id/share/:teamId
   * Unshare project from team
   */
  fastify.delete<{ Params: { id: string; teamId: string } }>(
    '/:id/share/:teamId',
    async (request, reply) => {
      const user = request.user!;
      const { id, teamId } = request.params;

      // Check ownership
      const project = await ProjectRepository.findById(id);
      if (!project) {
        throw new NotFoundError('Project', id);
      }
      if (project.ownerId !== user.id) {
        throw new ForbiddenError('Only the owner can manage sharing');
      }

      await ProjectRepository.unshare(id, teamId);

      return reply.status(204).send();
    }
  );

  /**
   * GET /v1/projects/:id/envs
   * List environments
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id/envs',
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(id, user.id, 'project:read');
      if (!hasAccess) {
        throw new ForbiddenError('Access denied');
      }

      const environments = await EnvironmentRepository.findByProject(id);

      return reply.send({ environments });
    }
  );

  /**
   * POST /v1/projects/:id/envs
   * Create environment
   */
  fastify.post<{ Params: { id: string }; Body: { name: string } }>(
    '/:id/envs',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 50 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;
      const { name } = request.body;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(id, user.id, 'project:write');
      if (!hasAccess) {
        throw new ForbiddenError('Access denied');
      }

      const blobKey = `projects/${id}/envs/${name}/blob`;

      const environment = await EnvironmentRepository.create({
        projectId: id,
        name,
        blobKey,
      });

      return reply.status(201).send({ environment });
    }
  );

  /**
   * DELETE /v1/projects/:id/envs/:name
   * Delete environment
   */
  fastify.delete<{ Params: { id: string; name: string } }>(
    '/:id/envs/:name',
    async (request, reply) => {
      const user = request.user!;
      const { id, name } = request.params;

      // Check permission
      const hasAccess = await ProjectRepository.hasPermission(id, user.id, 'project:write');
      if (!hasAccess) {
        throw new ForbiddenError('Access denied');
      }

      // Delete blob
      const storage = getStorageService();
      try {
        await storage.delete(id, name);
      } catch {
        // Blob might not exist
      }

      await EnvironmentRepository.delete(id, name);

      return reply.status(204).send();
    }
  );
}
