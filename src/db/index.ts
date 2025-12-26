/**
 * Database Layer
 */

// Connection
export {
  getPool,
  query,
  getClient,
  transaction,
  checkHealth,
  closePool,
  initDatabase,
  type DatabaseHealth,
} from './connection.js';

// Repositories
export * from './repositories/index.js';
