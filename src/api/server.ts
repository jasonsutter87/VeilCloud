/**
 * VeilCloud API Server
 * Fastify-based REST API
 */

import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';

import { config } from '../lib/config.js';
import { VeilCloudError } from '../lib/errors.js';

export async function createServer(): Promise<FastifyInstance> {
  const server = Fastify({
    logger: {
      level: process.env['LOG_LEVEL'] ?? 'info',
      transport:
        process.env['NODE_ENV'] === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
  });

  // ============================================================================
  // Plugins
  // ============================================================================

  // CORS
  await server.register(cors, {
    origin: process.env['CORS_ORIGIN'] ?? true,
    credentials: true,
  });

  // Security headers
  await server.register(helmet, {
    contentSecurityPolicy: false, // API doesn't serve HTML
  });

  // Rate limiting
  if (config.rateLimit) {
    await server.register(rateLimit, {
      max: config.rateLimit.max,
      timeWindow: config.rateLimit.timeWindow,
    });
  }

  // ============================================================================
  // Error Handler
  // ============================================================================

  server.setErrorHandler((error, request, reply) => {
    if (error instanceof VeilCloudError) {
      request.log.warn({ err: error }, 'VeilCloud error');
      return reply.status(error.statusCode).send(error.toJSON());
    }

    // Fastify validation errors
    if (error.validation) {
      request.log.warn({ err: error }, 'Validation error');
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: error.message,
        details: error.validation,
      });
    }

    // Unexpected errors
    request.log.error({ err: error }, 'Unexpected error');
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    });
  });

  // ============================================================================
  // Health Check
  // ============================================================================

  server.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      service: 'veilcloud',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    };
  });

  server.get('/health/ready', async (request, reply) => {
    // TODO: Check database, S3, integrations
    const checks = {
      database: true, // TODO: actual check
      storage: true, // TODO: actual check
      veilkey: config.integrations.veilkeyUrl ? true : 'not_configured',
      veilchain: config.integrations.veilchainUrl ? true : 'not_configured',
      veilsign: config.integrations.veilsignUrl ? true : 'not_configured',
    };

    const allHealthy = Object.values(checks).every((v) => v === true || v === 'not_configured');

    return reply.status(allHealthy ? 200 : 503).send({
      status: allHealthy ? 'ready' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  // ============================================================================
  // API Info
  // ============================================================================

  server.get('/', async (request, reply) => {
    return {
      name: 'VeilCloud',
      description: 'Zero-knowledge cloud storage platform',
      version: '0.1.0',
      docs: '/docs',
      health: '/health',
      api: {
        auth: '/v1/auth',
        storage: '/v1/storage',
        projects: '/v1/projects',
        teams: '/v1/teams',
        audit: '/v1/audit',
        crypto: '/v1/crypto',
        access: '/v1/access',
      },
    };
  });

  // ============================================================================
  // Register Middleware
  // ============================================================================

  const { authPlugin } = await import('./middleware/index.js');
  await server.register(authPlugin);

  // ============================================================================
  // Register Routes
  // ============================================================================

  const {
    storageRoutes,
    authRoutes,
    projectRoutes,
    teamRoutes,
    auditRoutes,
    cryptoRoutes,
    accessRoutes,
  } = await import('./routes/index.js');

  await server.register(authRoutes, { prefix: '/v1/auth' });
  await server.register(storageRoutes, { prefix: '/v1/storage' });
  await server.register(projectRoutes, { prefix: '/v1/projects' });
  await server.register(teamRoutes, { prefix: '/v1/teams' });
  await server.register(auditRoutes, { prefix: '/v1/audit' });
  await server.register(cryptoRoutes, { prefix: '/v1/crypto' });
  await server.register(accessRoutes, { prefix: '/v1/access' });

  return server;
}

export async function startServer(): Promise<void> {
  const server = await createServer();

  try {
    await server.listen({ port: config.port, host: config.host });
    server.log.info(`VeilCloud server listening on ${config.host}:${config.port}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

// Run if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  startServer();
}
