/**
 * Team Routes
 * Team management and VeilKey integration with VeilChain audit logging
 */

import type { FastifyInstance } from 'fastify';

import { TeamRepository } from '../../db/repositories/team.js';
import { UserRepository } from '../../db/repositories/user.js';
import { getVeilKeyClient } from '../../integrations/veilkey.js';
import { getAuditService } from '../../services/audit.js';
import { authenticate } from '../middleware/auth.js';
import { NotFoundError, ForbiddenError, ValidationError } from '../../lib/errors.js';
import type { TeamRole, TeamId, UserId } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

interface CreateTeamBody {
  name: string;
  description?: string;
  threshold: number;
  totalShares: number;
}

interface AddMemberBody {
  email: string;
  role?: TeamRole;
}

// ============================================================================
// Routes
// ============================================================================

export async function teamRoutes(fastify: FastifyInstance): Promise<void> {
  const audit = getAuditService();

  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  /**
   * POST /v1/teams
   * Create a new team with VeilKey threshold key
   */
  fastify.post<{ Body: CreateTeamBody }>(
    '/',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'threshold', 'totalShares'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string', maxLength: 1000 },
            threshold: { type: 'number', minimum: 1, maximum: 10 },
            totalShares: { type: 'number', minimum: 2, maximum: 10 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { name, description, threshold, totalShares } = request.body;

      if (threshold > totalShares) {
        throw new ValidationError('Threshold cannot exceed total shares');
      }

      // Create team in database first
      const team = await TeamRepository.create({
        ownerId: user.id,
        name,
        description,
        threshold,
        totalShares,
      });

      // Try to create VeilKey group
      let veilkeyGroup = null;
      try {
        const veilkey = getVeilKeyClient();
        const result = await veilkey.generateTeamKey({
          teamId: team.id,
          threshold,
          totalMembers: totalShares,
        });

        veilkeyGroup = result.keyGroup;

        // Update team with VeilKey group ID
        await TeamRepository.update(team.id, {
          veilkeyGroupId: result.keyGroup.id,
        });

        // Store owner's share (index 1)
        // In production, encrypt this before storing
      } catch {
        // VeilKey not available - team still works without threshold crypto
      }

      // Audit log
      await audit.logTeamCreate(
        user.id,
        team.id as TeamId,
        name,
        threshold,
        request.ip
      );

      return reply.status(201).send({
        team: {
          ...team,
          veilkeyGroupId: veilkeyGroup?.id,
        },
        veilkey: veilkeyGroup
          ? {
              publicKey: veilkeyGroup.publicKey,
              threshold: veilkeyGroup.threshold,
              parties: veilkeyGroup.parties,
            }
          : null,
      });
    }
  );

  /**
   * GET /v1/teams
   * List user's teams
   */
  fastify.get('/', async (request, reply) => {
    const user = request.user!;

    const teams = await TeamRepository.findByMember(user.id);

    return reply.send({ teams });
  });

  /**
   * GET /v1/teams/:id
   * Get team details
   */
  fastify.get<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;

      const team = await TeamRepository.findById(id);
      if (!team) {
        throw new NotFoundError('Team', id);
      }

      // Check if user is a member
      const isMember = await TeamRepository.isMember(id, user.id);
      if (!isMember) {
        throw new ForbiddenError('Not a member of this team');
      }

      const members = await TeamRepository.getMembers(id);

      // Get member details
      const memberDetails = await Promise.all(
        members.map(async (m) => {
          const memberUser = await UserRepository.findById(m.userId);
          return {
            userId: m.userId,
            email: memberUser?.email,
            role: m.role,
            shareIndex: m.shareIndex,
            joinedAt: m.joinedAt,
          };
        })
      );

      return reply.send({
        team,
        members: memberDetails,
      });
    }
  );

  /**
   * PATCH /v1/teams/:id
   * Update team
   */
  fastify.patch<{ Params: { id: string }; Body: { name?: string; description?: string } }>(
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

      // Check if user is owner or admin
      const member = await TeamRepository.getMember(id, user.id);
      if (!member || !['owner', 'admin'].includes(member.role)) {
        throw new ForbiddenError('Only owner or admin can update team');
      }

      const team = await TeamRepository.update(id, request.body);

      return reply.send({ team });
    }
  );

  /**
   * DELETE /v1/teams/:id
   * Delete team
   */
  fastify.delete<{ Params: { id: string } }>(
    '/:id',
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;

      // Check if user is owner
      const member = await TeamRepository.getMember(id, user.id);
      if (!member || member.role !== 'owner') {
        throw new ForbiddenError('Only owner can delete team');
      }

      await TeamRepository.delete(id);

      return reply.status(204).send();
    }
  );

  /**
   * POST /v1/teams/:id/members
   * Add member to team
   */
  fastify.post<{ Params: { id: string }; Body: AddMemberBody }>(
    '/:id/members',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email'],
          properties: {
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['admin', 'member', 'viewer'] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id } = request.params;
      const { email, role } = request.body;

      // Check if user is owner or admin
      const member = await TeamRepository.getMember(id, user.id);
      if (!member || !['owner', 'admin'].includes(member.role)) {
        throw new ForbiddenError('Only owner or admin can add members');
      }

      // Find user by email
      const newMember = await UserRepository.findByEmail(email);
      if (!newMember) {
        throw new NotFoundError('User', email);
      }

      // Get next share index
      const shareIndex = await TeamRepository.getNextShareIndex(id);
      if (shareIndex === null) {
        throw new ValidationError('All shares have been assigned');
      }

      const teamMember = await TeamRepository.addMember({
        teamId: id,
        userId: newMember.id,
        shareIndex,
        role: role ?? 'member',
      });

      // Audit log
      await audit.logTeamJoin(
        user.id,
        id as TeamId,
        newMember.id as UserId,
        shareIndex,
        request.ip
      );

      return reply.status(201).send({
        member: {
          userId: teamMember.userId,
          email: newMember.email,
          role: teamMember.role,
          shareIndex: teamMember.shareIndex,
          joinedAt: teamMember.joinedAt,
        },
      });
    }
  );

  /**
   * DELETE /v1/teams/:id/members/:userId
   * Remove member from team
   */
  fastify.delete<{ Params: { id: string; userId: string } }>(
    '/:id/members/:userId',
    async (request, reply) => {
      const user = request.user!;
      const { id, userId } = request.params;

      // Check if user is owner or admin
      const member = await TeamRepository.getMember(id, user.id);
      if (!member || !['owner', 'admin'].includes(member.role)) {
        throw new ForbiddenError('Only owner or admin can remove members');
      }

      await TeamRepository.removeMember(id, userId);

      return reply.status(204).send();
    }
  );

  /**
   * PATCH /v1/teams/:id/members/:userId
   * Update member role
   */
  fastify.patch<{ Params: { id: string; userId: string }; Body: { role: TeamRole } }>(
    '/:id/members/:userId',
    {
      schema: {
        body: {
          type: 'object',
          required: ['role'],
          properties: {
            role: { type: 'string', enum: ['admin', 'member', 'viewer'] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { id, userId } = request.params;
      const { role } = request.body;

      // Check if user is owner
      const member = await TeamRepository.getMember(id, user.id);
      if (!member || member.role !== 'owner') {
        throw new ForbiddenError('Only owner can change roles');
      }

      const updated = await TeamRepository.updateMemberRole(id, userId, role);

      return reply.send({ member: updated });
    }
  );
}
