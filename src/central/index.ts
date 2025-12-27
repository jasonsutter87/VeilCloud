/**
 * VeilCloud Central Module
 *
 * Handles aggregation of votes from edge nodes.
 * Provides ingest API, edge node management, and forwarding to Kafka/DB.
 */

// Ingest Service
export {
  CentralIngestService,
  getCentralIngestService,
  resetCentralIngestService,
  type IngestVote,
  type IngestBatch,
  type IngestResult,
  type EdgeNodeInfo,
} from './ingest.js';

// Routes
export { registerCentralRoutes } from './routes.js';
