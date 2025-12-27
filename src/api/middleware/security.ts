/**
 * Security Middleware
 * IP blocking, request analysis, and security headers
 */

import type { FastifyInstance, FastifyRequest, FastifyReply, FastifyPluginAsync } from 'fastify';

import { getIPReputationService } from '../../services/ipReputation.js';
import { getSecurityService } from '../../services/security.js';
import { query } from '../../db/connection.js';
import type { UserId } from '../../types.js';

// ============================================================================
// Types
// ============================================================================

interface SecurityConfig {
  enableIPBlocking?: boolean;
  enableRequestAnalysis?: boolean;
  blockSuspiciousRequests?: boolean;
  logSecurityEvents?: boolean;
}

// ============================================================================
// Middleware
// ============================================================================

/**
 * Security plugin for Fastify
 */
export const securityPlugin: FastifyPluginAsync<SecurityConfig> = async (
  fastify: FastifyInstance,
  options: SecurityConfig
) => {
  const {
    enableIPBlocking = true,
    enableRequestAnalysis = true,
    blockSuspiciousRequests = true,
    logSecurityEvents = true,
  } = options;

  const ipReputation = getIPReputationService();
  const security = getSecurityService();

  // Add security headers to all responses
  fastify.addHook('onSend', async (request, reply) => {
    const headers = security.getSecurityHeaders();
    for (const [key, value] of Object.entries(headers)) {
      reply.header(key, value);
    }
  });

  // Check IP reputation before handling request
  if (enableIPBlocking) {
    fastify.addHook('onRequest', async (request, reply) => {
      const ip = request.ip;

      const blockStatus = await ipReputation.isBlocked(ip);
      if (blockStatus.blocked) {
        if (logSecurityEvents) {
          await logSecurityEvent('blocked_request', ip, undefined, 'warning', {
            reason: blockStatus.reason,
            until: blockStatus.until?.toISOString(),
          });
        }

        return reply.status(403).send({
          code: 'IP_BLOCKED',
          message: 'Your IP has been temporarily blocked',
          until: blockStatus.until?.toISOString(),
        });
      }

      // Record the request
      await ipReputation.recordEvent(ip, { type: 'request' });
    });
  }

  // Analyze request for suspicious patterns
  if (enableRequestAnalysis) {
    fastify.addHook('preHandler', async (request, reply) => {
      const analysis = security.analyzeRequest(request);

      if (analysis.suspicious) {
        if (logSecurityEvents) {
          await logSecurityEvent(
            'suspicious_request',
            request.ip,
            request.user?.id,
            analysis.riskScore >= 80 ? 'critical' : 'warning',
            {
              reasons: analysis.reasons,
              riskScore: analysis.riskScore,
              url: request.url,
              method: request.method,
            }
          );
        }

        // Record attack detection
        await ipReputation.recordEvent(request.ip, { type: 'attack_detected' });

        if (blockSuspiciousRequests && analysis.riskScore >= 80) {
          return reply.status(403).send({
            code: 'SUSPICIOUS_REQUEST',
            message: 'Request blocked for security reasons',
          });
        }
      }
    });
  }

  // Handle authentication failures
  fastify.addHook('onError', async (request, reply, error) => {
    // Check if it's an auth error
    if (
      error.statusCode === 401 ||
      error.statusCode === 403 ||
      (error as { code?: string }).code === 'UNAUTHORIZED'
    ) {
      await ipReputation.recordEvent(request.ip, { type: 'auth_failure' });

      if (logSecurityEvents) {
        await logSecurityEvent('auth_failure', request.ip, request.user?.id, 'warning', {
          url: request.url,
          method: request.method,
          error: error.message,
        });
      }
    }
  });

  // Log rate limit hits
  fastify.addHook('onError', async (request, reply, error) => {
    if (error.statusCode === 429) {
      await ipReputation.recordEvent(request.ip, { type: 'rate_limit' });

      if (logSecurityEvents) {
        await logSecurityEvent('rate_limit_hit', request.ip, request.user?.id, 'info', {
          url: request.url,
          method: request.method,
        });
      }
    }
  });
};

/**
 * Validate request body middleware
 */
export async function validateRequestBody(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (request.body && typeof request.body === 'object') {
    const security = getSecurityService();
    const result = security.validateInput(request.body);

    if (!result.valid) {
      return reply.status(400).send({
        code: 'INVALID_INPUT',
        message: 'Request contains invalid input',
        errors: result.errors,
      });
    }

    // Replace body with sanitized version
    (request as { body: unknown }).body = result.sanitized;
  }
}

/**
 * CSRF protection middleware
 */
export async function csrfProtection(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Only protect state-changing methods
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
    return;
  }

  // Skip for API key authentication
  if (request.headers['x-api-key']) {
    return;
  }

  const csrfToken = request.headers['x-csrf-token'] as string | undefined;
  const sessionCsrf = (request as { session?: { csrf?: string } }).session?.csrf;

  if (!csrfToken || !sessionCsrf) {
    return reply.status(403).send({
      code: 'CSRF_REQUIRED',
      message: 'CSRF token required',
    });
  }

  const security = getSecurityService();
  if (!security.verifyCsrfToken(csrfToken, sessionCsrf)) {
    await logSecurityEvent('csrf_failure', request.ip, undefined, 'warning', {
      url: request.url,
      method: request.method,
    });

    return reply.status(403).send({
      code: 'CSRF_INVALID',
      message: 'Invalid CSRF token',
    });
  }
}

/**
 * Log a security event
 */
async function logSecurityEvent(
  eventType: string,
  ip: string,
  userId: UserId | undefined,
  severity: 'info' | 'warning' | 'critical',
  details: Record<string, unknown>
): Promise<void> {
  try {
    await query(
      `INSERT INTO security_events (event_type, ip, user_id, severity, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [eventType, ip, userId ?? null, severity, JSON.stringify(details)]
    );
  } catch (error) {
    console.error('[Security] Failed to log event:', error);
  }
}

/**
 * Get security event middleware
 */
export function requireSecurityHeaders() {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const security = getSecurityService();
    const headers = security.getSecurityHeaders();

    for (const [key, value] of Object.entries(headers)) {
      reply.header(key, value);
    }
  };
}
