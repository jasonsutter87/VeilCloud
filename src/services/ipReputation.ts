/**
 * IP Reputation Service
 * Track IP behavior and manage blocklists
 */

import { query } from '../db/connection.js';

// ============================================================================
// Types
// ============================================================================

export interface IPReputation {
  ip: string;
  score: number; // 0-100, lower is worse
  requestCount: number;
  failedAttempts: number;
  lastSeen: Date;
  blocked: boolean;
  blockedReason?: string;
  blockedUntil?: Date;
}

export interface IPEvent {
  type: 'request' | 'auth_failure' | 'rate_limit' | 'attack_detected' | 'success';
  metadata?: Record<string, unknown>;
}

// ============================================================================
// Constants
// ============================================================================

const INITIAL_SCORE = 50;
const MAX_SCORE = 100;
const MIN_SCORE = 0;
const BLOCK_THRESHOLD = 20;

const SCORE_ADJUSTMENTS: Record<IPEvent['type'], number> = {
  request: 0,
  auth_failure: -10,
  rate_limit: -15,
  attack_detected: -50,
  success: 5,
};

const BLOCK_DURATIONS: { threshold: number; duration: number }[] = [
  { threshold: 10, duration: 24 * 60 * 60 * 1000 }, // 24 hours
  { threshold: 5, duration: 7 * 24 * 60 * 60 * 1000 }, // 7 days
  { threshold: 0, duration: 30 * 24 * 60 * 60 * 1000 }, // 30 days
];

// ============================================================================
// Service
// ============================================================================

export class IPReputationService {
  private cache: Map<string, IPReputation> = new Map();
  private cacheExpiry: Map<string, number> = new Map();
  private readonly cacheTtl = 5 * 60 * 1000; // 5 minutes

  /**
   * Get IP reputation
   */
  async getReputation(ip: string): Promise<IPReputation> {
    // Check cache
    const cached = this.getCached(ip);
    if (cached) {
      return cached;
    }

    // Query database
    const result = await query<{
      ip: string;
      score: number;
      request_count: number;
      failed_attempts: number;
      last_seen: Date;
      blocked: boolean;
      blocked_reason: string | null;
      blocked_until: Date | null;
    }>(
      `SELECT * FROM ip_reputation WHERE ip = $1`,
      [ip]
    );

    if (result.rows.length > 0) {
      const row = result.rows[0]!;
      const reputation: IPReputation = {
        ip: row.ip,
        score: row.score,
        requestCount: row.request_count,
        failedAttempts: row.failed_attempts,
        lastSeen: row.last_seen,
        blocked: row.blocked,
        blockedReason: row.blocked_reason ?? undefined,
        blockedUntil: row.blocked_until ?? undefined,
      };
      this.setCache(ip, reputation);
      return reputation;
    }

    // Create new reputation
    const newReputation: IPReputation = {
      ip,
      score: INITIAL_SCORE,
      requestCount: 0,
      failedAttempts: 0,
      lastSeen: new Date(),
      blocked: false,
    };

    await this.saveReputation(newReputation);
    this.setCache(ip, newReputation);
    return newReputation;
  }

  /**
   * Record an event for an IP
   */
  async recordEvent(ip: string, event: IPEvent): Promise<IPReputation> {
    const reputation = await this.getReputation(ip);

    // Update score
    const adjustment = SCORE_ADJUSTMENTS[event.type];
    reputation.score = Math.max(MIN_SCORE, Math.min(MAX_SCORE, reputation.score + adjustment));

    // Update counters
    reputation.requestCount++;
    if (event.type === 'auth_failure') {
      reputation.failedAttempts++;
    }
    reputation.lastSeen = new Date();

    // Check if should block
    if (reputation.score <= BLOCK_THRESHOLD && !reputation.blocked) {
      const blockDuration = this.getBlockDuration(reputation.score);
      reputation.blocked = true;
      reputation.blockedReason = `Score dropped to ${reputation.score} due to ${event.type}`;
      reputation.blockedUntil = new Date(Date.now() + blockDuration);
    }

    // Check if block expired
    if (reputation.blocked && reputation.blockedUntil && reputation.blockedUntil < new Date()) {
      reputation.blocked = false;
      reputation.blockedReason = undefined;
      reputation.blockedUntil = undefined;
      reputation.score = INITIAL_SCORE; // Reset score on unblock
    }

    await this.saveReputation(reputation);
    this.setCache(ip, reputation);
    return reputation;
  }

  /**
   * Check if IP is blocked
   */
  async isBlocked(ip: string): Promise<{
    blocked: boolean;
    reason?: string;
    until?: Date;
  }> {
    const reputation = await this.getReputation(ip);

    // Check if block expired
    if (reputation.blocked && reputation.blockedUntil && reputation.blockedUntil < new Date()) {
      await this.unblock(ip);
      return { blocked: false };
    }

    return {
      blocked: reputation.blocked,
      reason: reputation.blockedReason,
      until: reputation.blockedUntil,
    };
  }

  /**
   * Manually block an IP
   */
  async block(ip: string, reason: string, durationMs?: number): Promise<void> {
    const reputation = await this.getReputation(ip);

    reputation.blocked = true;
    reputation.blockedReason = reason;
    reputation.blockedUntil = durationMs
      ? new Date(Date.now() + durationMs)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days
    reputation.score = 0;

    await this.saveReputation(reputation);
    this.invalidateCache(ip);
  }

  /**
   * Unblock an IP
   */
  async unblock(ip: string): Promise<void> {
    const reputation = await this.getReputation(ip);

    reputation.blocked = false;
    reputation.blockedReason = undefined;
    reputation.blockedUntil = undefined;
    reputation.score = INITIAL_SCORE;
    reputation.failedAttempts = 0;

    await this.saveReputation(reputation);
    this.invalidateCache(ip);
  }

  /**
   * Get blocked IPs
   */
  async getBlockedIPs(limit = 100): Promise<IPReputation[]> {
    const result = await query<{
      ip: string;
      score: number;
      request_count: number;
      failed_attempts: number;
      last_seen: Date;
      blocked: boolean;
      blocked_reason: string | null;
      blocked_until: Date | null;
    }>(
      `SELECT * FROM ip_reputation
       WHERE blocked = true
       ORDER BY blocked_until DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => ({
      ip: row.ip,
      score: row.score,
      requestCount: row.request_count,
      failedAttempts: row.failed_attempts,
      lastSeen: row.last_seen,
      blocked: row.blocked,
      blockedReason: row.blocked_reason ?? undefined,
      blockedUntil: row.blocked_until ?? undefined,
    }));
  }

  /**
   * Get suspicious IPs (low score but not blocked)
   */
  async getSuspiciousIPs(limit = 100): Promise<IPReputation[]> {
    const result = await query<{
      ip: string;
      score: number;
      request_count: number;
      failed_attempts: number;
      last_seen: Date;
      blocked: boolean;
      blocked_reason: string | null;
      blocked_until: Date | null;
    }>(
      `SELECT * FROM ip_reputation
       WHERE score < 50 AND blocked = false
       ORDER BY score ASC
       LIMIT $1`,
      [limit]
    );

    return result.rows.map((row) => ({
      ip: row.ip,
      score: row.score,
      requestCount: row.request_count,
      failedAttempts: row.failed_attempts,
      lastSeen: row.last_seen,
      blocked: row.blocked,
      blockedReason: row.blocked_reason ?? undefined,
      blockedUntil: row.blocked_until ?? undefined,
    }));
  }

  /**
   * Cleanup old entries
   */
  async cleanup(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const result = await query<{ count: string }>(
      `DELETE FROM ip_reputation
       WHERE last_seen < $1 AND blocked = false
       RETURNING COUNT(*) as count`,
      [cutoff]
    );

    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  // Private methods

  private getBlockDuration(score: number): number {
    for (const { threshold, duration } of BLOCK_DURATIONS) {
      if (score >= threshold) {
        return duration;
      }
    }
    return BLOCK_DURATIONS[BLOCK_DURATIONS.length - 1]!.duration;
  }

  private getCached(ip: string): IPReputation | null {
    const expiry = this.cacheExpiry.get(ip);
    if (!expiry || expiry < Date.now()) {
      this.cache.delete(ip);
      this.cacheExpiry.delete(ip);
      return null;
    }
    return this.cache.get(ip) ?? null;
  }

  private setCache(ip: string, reputation: IPReputation): void {
    this.cache.set(ip, reputation);
    this.cacheExpiry.set(ip, Date.now() + this.cacheTtl);
  }

  private invalidateCache(ip: string): void {
    this.cache.delete(ip);
    this.cacheExpiry.delete(ip);
  }

  private async saveReputation(reputation: IPReputation): Promise<void> {
    await query(
      `INSERT INTO ip_reputation (ip, score, request_count, failed_attempts, last_seen, blocked, blocked_reason, blocked_until)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (ip) DO UPDATE SET
         score = EXCLUDED.score,
         request_count = EXCLUDED.request_count,
         failed_attempts = EXCLUDED.failed_attempts,
         last_seen = EXCLUDED.last_seen,
         blocked = EXCLUDED.blocked,
         blocked_reason = EXCLUDED.blocked_reason,
         blocked_until = EXCLUDED.blocked_until`,
      [
        reputation.ip,
        reputation.score,
        reputation.requestCount,
        reputation.failedAttempts,
        reputation.lastSeen,
        reputation.blocked,
        reputation.blockedReason ?? null,
        reputation.blockedUntil ?? null,
      ]
    );
  }
}

// ============================================================================
// Singleton
// ============================================================================

let ipReputationService: IPReputationService | null = null;

export function getIPReputationService(): IPReputationService {
  if (!ipReputationService) {
    ipReputationService = new IPReputationService();
  }
  return ipReputationService;
}
