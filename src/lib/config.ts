/**
 * VeilCloud Configuration
 * Environment-based configuration loader
 */

import type { VeilCloudConfig, StorageConfig, IntegrationConfig } from '../types.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optionalEnv(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function loadStorageConfig(): StorageConfig {
  return {
    endpoint: optionalEnv('S3_ENDPOINT', 'http://localhost:9000'),
    region: optionalEnv('S3_REGION', 'us-east-1'),
    bucket: optionalEnv('S3_BUCKET', 'veilcloud'),
    accessKeyId: optionalEnv('S3_ACCESS_KEY_ID', 'minioadmin'),
    secretAccessKey: optionalEnv('S3_SECRET_ACCESS_KEY', 'minioadmin'),
    forcePathStyle: optionalEnv('S3_FORCE_PATH_STYLE', 'true') === 'true',
  };
}

function loadIntegrationConfig(): IntegrationConfig {
  return {
    veilkeyUrl: process.env['VEILKEY_URL'],
    veilchainUrl: process.env['VEILCHAIN_URL'],
    veilsignUrl: process.env['VEILSIGN_URL'],
  };
}

export function loadConfig(): VeilCloudConfig {
  return {
    port: parseInt(optionalEnv('PORT', '3000'), 10),
    host: optionalEnv('HOST', '0.0.0.0'),
    databaseUrl: optionalEnv(
      'DATABASE_URL',
      'postgres://postgres:postgres@localhost:5432/veilcloud'
    ),
    redisUrl: process.env['REDIS_URL'],
    storage: loadStorageConfig(),
    integrations: loadIntegrationConfig(),
    rateLimit: {
      max: parseInt(optionalEnv('RATE_LIMIT_MAX', '100'), 10),
      timeWindow: parseInt(optionalEnv('RATE_LIMIT_WINDOW', '60000'), 10),
    },
  };
}

export const config = loadConfig();
