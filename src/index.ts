/**
 * VeilCloud - Zero-Knowledge Cloud Storage Platform
 *
 * Encrypted storage with threshold cryptography, immutable audit, and privacy-preserving access.
 * Integrates VeilKey (team keys), VeilChain (audit), and VeilSign (credentials).
 *
 * @packageDocumentation
 */

// Types
export * from './types.js';

// Errors
export * from './lib/errors.js';

// Config
export { loadConfig, config } from './lib/config.js';
