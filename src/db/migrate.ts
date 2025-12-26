/**
 * Database Migration Runner
 * Applies schema.sql to the database
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { query, closePool, checkHealth } from './connection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function migrate(): Promise<void> {
  console.log('[Migration] Starting...');

  // Check connection
  const health = await checkHealth();
  if (!health.connected) {
    console.error('[Migration] Failed to connect to database');
    process.exit(1);
  }

  console.log(`[Migration] Connected to database (latency: ${health.latencyMs}ms)`);

  try {
    // Read schema file
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    console.log('[Migration] Applying schema...');

    // Execute schema
    await query(schema);

    console.log('[Migration] Schema applied successfully');

    // Verify tables exist
    const result = await query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('[Migration] Tables created:');
    for (const row of result.rows) {
      console.log(`  - ${row['table_name']}`);
    }

  } catch (error) {
    console.error('[Migration] Failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }

  console.log('[Migration] Complete');
}

// Run if executed directly
migrate().catch(console.error);
