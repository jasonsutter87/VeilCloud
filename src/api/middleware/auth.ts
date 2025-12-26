/**
 * Authentication Middleware
 * VeilSign credential verification + API key fallback
 */

import type { FastifyRequest, FastifyReply, FastifyInstance } from 'fastify';
import { createHash } from 'crypto';

import { getVeilSignClient } from '../../integrations/veilsign.js';
import { UserRepository } from '../../db/repositories/user.js';
import { query } from '../../db/connection.js';
import {
  UnauthorizedError,
  InvalidCredentialError,
  ForbiddenError,
} from '../../lib/errors.js';
import type { User, Permission } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

export interface AuthenticatedUser extends User {
  permissions: Permission[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
    credential?: {
      id: string;
      type: 'veilsign' | 'apikey';
    };
  }
}

// ============================================================================
// Credential Verification
// ============================================================================

async function verifyVeilSignCredential(
  credential: string,
  signature: string
): Promise<{ userId: string; permissions: Permission[] } | null> {
  try {
    const veilsign = getVeilSignClient();
    const result = await veilsign.verifyCredential({ credential, signature });

    if (!result.valid || !result.credential) {
      return null;
    }

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (result.credential.expiresAt < now) {
      return null;
    }

    const claims = result.credential.claims as {
      userId?: string;
      permissions?: Permission[];
    };

    if (!claims.userId) {
      return null;
    }

    return {
      userId: claims.userId,
      permissions: claims.permissions ?? [],
    };
  } catch {
    return null;
  }
}

async function verifyApiKey(
  apiKey: string
): Promise<{ userId: string; permissions: Permission[] } | null> {
  // API key format: vc_<random>
  if (!apiKey.startsWith('vc_')) {
    return null;
  }

  const keyHash = createHash('sha256').update(apiKey).digest('hex');
  const keyPrefix = apiKey.substring(0, 12);

  const result = await query<{
    user_id: string;
    permissions: Permission[];
    expires_at: Date | null;
    is_active: boolean;
  }>(
    `UPDATE api_keys
     SET last_used_at = NOW()
     WHERE key_hash = $1 AND key_prefix = $2 AND is_active = true
     RETURNING user_id, permissions, expires_at, is_active`,
    [keyHash, keyPrefix]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const key = result.rows[0]!;

  // Check expiration
  if (key.expires_at && new Date(key.expires_at) < new Date()) {
    return null;
  }

  return {
    userId: key.user_id,
    permissions: key.permissions,
  };
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Authentication middleware
 * Checks for VeilSign credential or API key
 */
export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Try VeilSign credential first
  const credential = request.headers['x-veilcloud-credential'] as string | undefined;
  const signature = request.headers['x-veilcloud-signature'] as string | undefined;

  if (credential && signature) {
    const result = await verifyVeilSignCredential(credential, signature);

    if (result) {
      const user = await UserRepository.findById(result.userId);

      if (user) {
        request.user = {
          ...user,
          permissions: result.permissions,
        };
        request.credential = { id: credential, type: 'veilsign' };
        return;
      }
    }
  }

  // Try API key
  const apiKey =
    (request.headers['x-api-key'] as string | undefined) ??
    (request.headers['authorization']?.replace('Bearer ', '') as string | undefined);

  if (apiKey) {
    const result = await verifyApiKey(apiKey);

    if (result) {
      const user = await UserRepository.findById(result.userId);

      if (user) {
        request.user = {
          ...user,
          permissions: result.permissions,
        };
        request.credential = { id: apiKey.substring(0, 12), type: 'apikey' };
        return;
      }
    }
  }

  throw new UnauthorizedError('Valid credential or API key required');
}

/**
 * Optional authentication - doesn't fail if no credential
 */
export async function optionalAuthenticate(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    await authenticate(request, reply);
  } catch {
    // Ignore auth errors for optional auth
  }
}

/**
 * Require specific permission
 */
export function requirePermission(permission: Permission) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new UnauthorizedError();
    }

    // Check if user has the required permission
    if (!request.user.permissions.includes(permission)) {
      throw new ForbiddenError(`Missing required permission: ${permission}`);
    }
  };
}

/**
 * Require any of the specified permissions
 */
export function requireAnyPermission(permissions: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new UnauthorizedError();
    }

    const hasPermission = permissions.some((p) =>
      request.user!.permissions.includes(p)
    );

    if (!hasPermission) {
      throw new ForbiddenError(
        `Requires one of: ${permissions.join(', ')}`
      );
    }
  };
}

/**
 * Require all specified permissions
 */
export function requireAllPermissions(permissions: Permission[]) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.user) {
      throw new UnauthorizedError();
    }

    const missingPermissions = permissions.filter(
      (p) => !request.user!.permissions.includes(p)
    );

    if (missingPermissions.length > 0) {
      throw new ForbiddenError(
        `Missing permissions: ${missingPermissions.join(', ')}`
      );
    }
  };
}

// ============================================================================
// Plugin Registration
// ============================================================================

export async function authPlugin(fastify: FastifyInstance): Promise<void> {
  // Decorate request with user
  fastify.decorateRequest('user', null);
  fastify.decorateRequest('credential', null);

  // Add authenticate hook helper
  fastify.decorate('authenticate', authenticate);
  fastify.decorate('optionalAuthenticate', optionalAuthenticate);
}

// Extend FastifyInstance type
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: typeof authenticate;
    optionalAuthenticate: typeof optionalAuthenticate;
  }
}
