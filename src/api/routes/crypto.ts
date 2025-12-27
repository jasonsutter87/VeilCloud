/**
 * Team Crypto Routes
 * Threshold encryption/decryption operations via VeilKey
 */

import type { FastifyInstance } from 'fastify';

import { authenticate } from '../middleware/auth.js';
import { getTeamCryptoService } from '../../services/teamCrypto.js';
import { TeamRepository } from '../../db/repositories/team.js';
import { query } from '../../db/connection.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors.js';
import type { TeamId } from '../../types.js';

// ============================================================================
// Routes
// ============================================================================

export async function cryptoRoutes(fastify: FastifyInstance): Promise<void> {
  // All routes require authentication
  fastify.addHook('preHandler', authenticate);

  /**
   * POST /v1/crypto/:teamId/encrypt
   * Encrypt data for a team using their threshold public key
   */
  fastify.post<{
    Params: { teamId: string };
    Body: { plaintext: string };
  }>(
    '/:teamId/encrypt',
    {
      schema: {
        body: {
          type: 'object',
          required: ['plaintext'],
          properties: {
            plaintext: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { teamId } = request.params;
      const { plaintext } = request.body;

      const cryptoService = getTeamCryptoService();

      const ciphertext = await cryptoService.encryptForTeam({
        teamId: teamId as TeamId,
        plaintext,
        userId: user.id,
        ipAddress: request.ip,
      });

      return reply.send({ ciphertext });
    }
  );

  /**
   * GET /v1/crypto/:teamId/key-info
   * Get team's public key info (without private shares)
   */
  fastify.get<{ Params: { teamId: string } }>(
    '/:teamId/key-info',
    async (request, reply) => {
      const user = request.user!;
      const { teamId } = request.params;

      const cryptoService = getTeamCryptoService();

      const keyInfo = await cryptoService.getTeamKeyInfo(
        teamId as TeamId,
        user.id
      );

      return reply.send(keyInfo);
    }
  );

  /**
   * POST /v1/crypto/:teamId/decrypt/request
   * Create a decryption request (initiates threshold decryption)
   */
  fastify.post<{
    Params: { teamId: string };
    Body: { ciphertext: string };
  }>(
    '/:teamId/decrypt/request',
    {
      schema: {
        body: {
          type: 'object',
          required: ['ciphertext'],
          properties: {
            ciphertext: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { teamId } = request.params;
      const { ciphertext } = request.body;

      // Verify membership
      const isMember = await TeamRepository.isMember(teamId, user.id);
      if (!isMember) {
        throw new ForbiddenError('Not a member of this team');
      }

      const team = await TeamRepository.findById(teamId);
      if (!team) {
        throw new NotFoundError('Team', teamId);
      }

      // Create decryption request
      const ciphertextHash = Buffer.from(ciphertext).toString('base64').slice(0, 64);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      const result = await query<{ id: string }>(
        `INSERT INTO decryption_requests (team_id, requester_id, ciphertext_hash, shares_needed, expires_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [teamId, user.id, ciphertextHash, team.threshold, expiresAt]
      );

      return reply.status(201).send({
        requestId: result.rows[0]!.id,
        teamId,
        sharesNeeded: team.threshold,
        sharesCollected: 0,
        expiresAt: expiresAt.toISOString(),
        status: 'pending',
      });
    }
  );

  /**
   * POST /v1/crypto/:teamId/decrypt/:requestId/share
   * Submit a partial decryption share
   */
  fastify.post<{
    Params: { teamId: string; requestId: string };
    Body: { ciphertext: string };
  }>(
    '/:teamId/decrypt/:requestId/share',
    {
      schema: {
        body: {
          type: 'object',
          required: ['ciphertext'],
          properties: {
            ciphertext: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { teamId, requestId } = request.params;
      const { ciphertext } = request.body;

      // Verify request exists and is pending
      const reqResult = await query<{
        id: string;
        status: string;
        shares_collected: number;
        shares_needed: number;
      }>(
        `SELECT id, status, shares_collected, shares_needed
         FROM decryption_requests
         WHERE id = $1 AND team_id = $2`,
        [requestId, teamId]
      );

      if (reqResult.rows.length === 0) {
        throw new NotFoundError('DecryptionRequest', requestId);
      }

      const decryptRequest = reqResult.rows[0]!;
      if (decryptRequest.status !== 'pending') {
        throw new ValidationError(`Request is ${decryptRequest.status}`);
      }

      // Generate partial decryption
      const cryptoService = getTeamCryptoService();
      const share = await cryptoService.generateDecryptionShare({
        teamId: teamId as TeamId,
        userId: user.id,
        ciphertext,
        ipAddress: request.ip,
      });

      // Store share
      await query(
        `INSERT INTO decryption_shares (request_id, user_id, share_index, partial_decryption, proof)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (request_id, user_id) DO UPDATE SET
           partial_decryption = EXCLUDED.partial_decryption,
           proof = EXCLUDED.proof,
           submitted_at = NOW()`,
        [requestId, user.id, share.shareIndex, share.partialDecryption, share.proof]
      );

      // Update shares collected
      await query(
        `UPDATE decryption_requests
         SET shares_collected = (
           SELECT COUNT(*) FROM decryption_shares WHERE request_id = $1
         )
         WHERE id = $1`,
        [requestId]
      );

      // Get updated request
      const updated = await query<{ shares_collected: number; shares_needed: number }>(
        `SELECT shares_collected, shares_needed FROM decryption_requests WHERE id = $1`,
        [requestId]
      );

      return reply.send({
        requestId,
        shareIndex: share.shareIndex,
        sharesCollected: updated.rows[0]!.shares_collected,
        sharesNeeded: updated.rows[0]!.shares_needed,
        canComplete: updated.rows[0]!.shares_collected >= updated.rows[0]!.shares_needed,
      });
    }
  );

  /**
   * POST /v1/crypto/:teamId/decrypt/:requestId/complete
   * Complete decryption by combining shares
   */
  fastify.post<{
    Params: { teamId: string; requestId: string };
    Body: { ciphertext: string };
  }>(
    '/:teamId/decrypt/:requestId/complete',
    {
      schema: {
        body: {
          type: 'object',
          required: ['ciphertext'],
          properties: {
            ciphertext: { type: 'string', minLength: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = request.user!;
      const { teamId, requestId } = request.params;
      const { ciphertext } = request.body;

      // Verify membership
      const isMember = await TeamRepository.isMember(teamId, user.id);
      if (!isMember) {
        throw new ForbiddenError('Not a member of this team');
      }

      // Get request and shares
      const reqResult = await query<{
        status: string;
        shares_collected: number;
        shares_needed: number;
      }>(
        `SELECT status, shares_collected, shares_needed
         FROM decryption_requests WHERE id = $1 AND team_id = $2`,
        [requestId, teamId]
      );

      if (reqResult.rows.length === 0) {
        throw new NotFoundError('DecryptionRequest', requestId);
      }

      const decryptRequest = reqResult.rows[0]!;
      if (decryptRequest.status !== 'pending') {
        throw new ValidationError(`Request is ${decryptRequest.status}`);
      }

      if (decryptRequest.shares_collected < decryptRequest.shares_needed) {
        throw new ValidationError(
          `Need ${decryptRequest.shares_needed} shares, have ${decryptRequest.shares_collected}`
        );
      }

      // Get all shares
      const sharesResult = await query<{
        share_index: number;
        partial_decryption: string;
        proof: string;
      }>(
        `SELECT share_index, partial_decryption, proof FROM decryption_shares WHERE request_id = $1`,
        [requestId]
      );

      const cryptoService = getTeamCryptoService();
      const plaintext = await cryptoService.combineShares({
        teamId: teamId as TeamId,
        ciphertext,
        shares: sharesResult.rows.map((s) => ({
          shareIndex: s.share_index,
          partialDecryption: s.partial_decryption,
          proof: s.proof,
        })),
      });

      // Mark request as complete
      await query(
        `UPDATE decryption_requests SET status = 'complete', completed_at = NOW() WHERE id = $1`,
        [requestId]
      );

      return reply.send({
        requestId,
        plaintext,
        status: 'complete',
      });
    }
  );

  /**
   * GET /v1/crypto/:teamId/decrypt/requests
   * List pending decryption requests for a team
   */
  fastify.get<{ Params: { teamId: string } }>(
    '/:teamId/decrypt/requests',
    async (request, reply) => {
      const user = request.user!;
      const { teamId } = request.params;

      // Verify membership
      const isMember = await TeamRepository.isMember(teamId, user.id);
      if (!isMember) {
        throw new ForbiddenError('Not a member of this team');
      }

      const result = await query<{
        id: string;
        requester_id: string;
        ciphertext_hash: string;
        shares_collected: number;
        shares_needed: number;
        status: string;
        expires_at: Date;
        created_at: Date;
      }>(
        `SELECT * FROM decryption_requests
         WHERE team_id = $1 AND status = 'pending' AND expires_at > NOW()
         ORDER BY created_at DESC`,
        [teamId]
      );

      // Check which requests user has contributed to
      const userShares = await query<{ request_id: string }>(
        `SELECT request_id FROM decryption_shares
         WHERE user_id = $1 AND request_id = ANY($2)`,
        [user.id, result.rows.map((r) => r.id)]
      );

      const userShareSet = new Set(userShares.rows.map((s) => s.request_id));

      return reply.send({
        requests: result.rows.map((r) => ({
          id: r.id,
          requesterId: r.requester_id,
          sharesCollected: r.shares_collected,
          sharesNeeded: r.shares_needed,
          status: r.status,
          expiresAt: r.expires_at.toISOString(),
          createdAt: r.created_at.toISOString(),
          userHasContributed: userShareSet.has(r.id),
        })),
      });
    }
  );

  /**
   * POST /v1/crypto/:teamId/rotate
   * Rotate team key (admin only)
   */
  fastify.post<{ Params: { teamId: string } }>(
    '/:teamId/rotate',
    async (request, reply) => {
      const user = request.user!;
      const { teamId } = request.params;

      const cryptoService = getTeamCryptoService();

      const keyInfo = await cryptoService.rotateTeamKey(
        teamId as TeamId,
        user.id,
        request.ip
      );

      return reply.send({
        message: 'Key rotated successfully',
        keyInfo,
      });
    }
  );
}
