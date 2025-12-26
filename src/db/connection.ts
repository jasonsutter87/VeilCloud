/**
 * Database Connection
 * PostgreSQL connection pool with health checks
 */

import pg from 'pg';
import { config } from '../lib/config.js';

const { Pool } = pg;

// ============================================================================
// Types
// ============================================================================

export interface DatabaseHealth {
  connected: boolean;
  latencyMs: number;
  poolSize: number;
  idleCount: number;
  waitingCount: number;
}

// ============================================================================
// Connection Pool
// ============================================================================

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    // Log pool events in development
    if (process.env['NODE_ENV'] === 'development') {
      pool.on('connect', () => console.log('[DB] Client connected'));
      pool.on('remove', () => console.log('[DB] Client removed'));
    }

    pool.on('error', (err) => {
      console.error('[DB] Unexpected error on idle client', err);
    });
  }

  return pool;
}

/**
 * Execute a query with automatic client acquisition/release
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const result = await getPool().query<T>(text, params);
  const duration = Date.now() - start;

  if (process.env['NODE_ENV'] === 'development' && duration > 100) {
    console.log(`[DB] Slow query (${duration}ms):`, text.substring(0, 100));
  }

  return result;
}

/**
 * Get a client for transactions
 */
export async function getClient(): Promise<pg.PoolClient> {
  return getPool().connect();
}

/**
 * Execute a transaction
 */
export async function transaction<T>(
  callback: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Check database health
 */
export async function checkHealth(): Promise<DatabaseHealth> {
  const p = getPool();
  const start = Date.now();

  try {
    await p.query('SELECT 1');
    const latencyMs = Date.now() - start;

    return {
      connected: true,
      latencyMs,
      poolSize: p.totalCount,
      idleCount: p.idleCount,
      waitingCount: p.waitingCount,
    };
  } catch {
    return {
      connected: false,
      latencyMs: -1,
      poolSize: p.totalCount,
      idleCount: p.idleCount,
      waitingCount: p.waitingCount,
    };
  }
}

/**
 * Close the pool (for graceful shutdown)
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Initialize database (run migrations, etc.)
 */
export async function initDatabase(): Promise<void> {
  // Verify connection
  const health = await checkHealth();
  if (!health.connected) {
    throw new Error('Failed to connect to database');
  }

  console.log(`[DB] Connected (latency: ${health.latencyMs}ms)`);
}
