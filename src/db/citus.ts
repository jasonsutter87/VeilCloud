/**
 * Citus Distributed Database Configuration
 *
 * Provides sharded PostgreSQL for handling 350M+ votes.
 * Votes are distributed by election_id for co-location.
 */

import { Pool, PoolConfig } from 'pg';

export interface CitusConfig {
  coordinator: PoolConfig;
  shardCount: number;
  replicationFactor: number;
}

/**
 * Get Citus configuration from environment
 */
export function getCitusConfig(): CitusConfig {
  const coordinatorUrl = process.env.CITUS_COORDINATOR_URL || process.env.DATABASE_URL;

  if (!coordinatorUrl) {
    throw new Error('CITUS_COORDINATOR_URL or DATABASE_URL must be set');
  }

  const url = new URL(coordinatorUrl);

  return {
    coordinator: {
      host: url.hostname,
      port: parseInt(url.port) || 5432,
      database: url.pathname.slice(1),
      user: url.username,
      password: url.password,
      ssl: url.searchParams.get('sslmode') === 'require' ? { rejectUnauthorized: false } : undefined,
      max: parseInt(process.env.CITUS_POOL_SIZE || '20'),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    },
    shardCount: parseInt(process.env.CITUS_SHARD_COUNT || '32'),
    replicationFactor: parseInt(process.env.CITUS_REPLICATION_FACTOR || '2'),
  };
}

export class CitusClient {
  private pool: Pool;
  private config: CitusConfig;

  constructor(config?: CitusConfig) {
    this.config = config || getCitusConfig();
    this.pool = new Pool(this.config.coordinator);
  }

  /**
   * Get the connection pool
   */
  getPool(): Pool {
    return this.pool;
  }

  /**
   * Execute a query on the coordinator (routes to correct shard)
   */
  async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
    const result = await this.pool.query(sql, params);
    return result.rows as T[];
  }

  /**
   * Execute a query and return single row
   */
  async queryOne<T = unknown>(sql: string, params?: unknown[]): Promise<T | null> {
    const result = await this.pool.query(sql, params);
    return (result.rows[0] as T) || null;
  }

  /**
   * Insert vote with nullifier check (atomic, runs on correct shard)
   */
  async insertVote(
    electionId: string,
    encryptedVote: object,
    commitment: string,
    nullifier: string,
    zkProof: object,
    merklePosition: number
  ): Promise<string> {
    const result = await this.queryOne<{ insert_vote: string }>(
      `SELECT insert_vote($1, $2, $3, $4, $5, $6)`,
      [
        electionId,
        JSON.stringify(encryptedVote),
        commitment,
        nullifier,
        JSON.stringify(zkProof),
        merklePosition,
      ]
    );

    if (!result) {
      throw new Error('Failed to insert vote');
    }

    return result.insert_vote;
  }

  /**
   * Check if nullifier exists
   */
  async checkNullifier(electionId: string, nullifier: string): Promise<boolean> {
    const result = await this.queryOne<{ check_nullifier_exists: boolean }>(
      `SELECT check_nullifier_exists($1, $2)`,
      [electionId, nullifier]
    );
    return result?.check_nullifier_exists || false;
  }

  /**
   * Get votes for election (paginated)
   */
  async getVotes(
    electionId: string,
    limit: number = 1000,
    offset: number = 0
  ): Promise<Array<{
    id: string;
    encrypted_vote: object;
    commitment: string;
    nullifier: string;
    zk_proof: object;
    merkle_position: number;
    created_at: Date;
  }>> {
    return this.query(
      `SELECT id, encrypted_vote, commitment, nullifier, zk_proof, merkle_position, created_at
       FROM votes
       WHERE election_id = $1
       ORDER BY merkle_position
       LIMIT $2 OFFSET $3`,
      [electionId, limit, offset]
    );
  }

  /**
   * Get vote count for election
   */
  async getVoteCount(electionId: string): Promise<number> {
    const result = await this.queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM votes WHERE election_id = $1`,
      [electionId]
    );
    return parseInt(result?.count || '0');
  }

  /**
   * Get shard information
   */
  async getShardInfo(): Promise<Array<{
    table_name: string;
    shard_id: number;
    shard_size: string;
    shard_node: string;
  }>> {
    return this.query(`
      SELECT
        logicalrelid::text as table_name,
        shardid as shard_id,
        pg_size_pretty(shard_size) as shard_size,
        nodename || ':' || nodeport as shard_node
      FROM citus_shards
      ORDER BY logicalrelid, shardid
    `);
  }

  /**
   * Get worker nodes
   */
  async getWorkerNodes(): Promise<Array<{
    node_name: string;
    node_port: number;
    is_active: boolean;
  }>> {
    return this.query(`
      SELECT
        nodename as node_name,
        nodeport as node_port,
        isactive as is_active
      FROM citus_get_active_worker_nodes()
    `);
  }

  /**
   * Add a worker node
   */
  async addWorkerNode(hostname: string, port: number = 5432): Promise<void> {
    await this.query(`SELECT citus_add_node($1, $2)`, [hostname, port]);
  }

  /**
   * Start shard rebalancing
   */
  async rebalanceShards(): Promise<void> {
    await this.query(`SELECT citus_rebalance_start()`);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    workerCount: number;
    shardCount: number;
    latencyMs: number;
  }> {
    const start = Date.now();
    try {
      // Check coordinator
      await this.query(`SELECT 1`);

      // Get worker count
      const workers = await this.getWorkerNodes();
      const activeWorkers = workers.filter((w) => w.is_active).length;

      // Get shard count
      const shards = await this.getShardInfo();

      return {
        healthy: activeWorkers > 0,
        workerCount: activeWorkers,
        shardCount: shards.length,
        latencyMs: Date.now() - start,
      };
    } catch (error) {
      return {
        healthy: false,
        workerCount: 0,
        shardCount: 0,
        latencyMs: Date.now() - start,
      };
    }
  }

  /**
   * Close connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}

// Singleton instance
let citusInstance: CitusClient | null = null;

export function getCitusClient(): CitusClient {
  if (!citusInstance) {
    citusInstance = new CitusClient();
  }
  return citusInstance;
}
