/**
 * IP Reputation Service Tests
 */

// Mock the database before importing
jest.mock('../../src/db/connection.js', () => ({
  query: jest.fn(),
}));

import { IPReputationService } from '../../src/services/ipReputation.js';
import { query } from '../../src/db/connection.js';

const mockQuery = query as jest.Mock;

describe('IPReputationService', () => {
  let service: IPReputationService;

  beforeEach(() => {
    service = new IPReputationService();
    jest.clearAllMocks();
  });

  describe('getReputation', () => {
    it('should return existing reputation from database', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 75,
          request_count: 100,
          failed_attempts: 5,
          last_seen: new Date('2024-01-01'),
          blocked: false,
          blocked_reason: null,
          blocked_until: null,
        }],
      });

      const result = await service.getReputation('192.168.1.1');

      expect(result.ip).toBe('192.168.1.1');
      expect(result.score).toBe(75);
      expect(result.requestCount).toBe(100);
      expect(result.blocked).toBe(false);
    });

    it('should create new reputation for unknown IP', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // First query - not found
        .mockResolvedValueOnce({ rows: [] }); // Insert

      const result = await service.getReputation('10.0.0.1');

      expect(result.ip).toBe('10.0.0.1');
      expect(result.score).toBe(50); // Initial score
      expect(result.requestCount).toBe(0);
      expect(result.blocked).toBe(false);
    });

    it('should cache reputation', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 75,
          request_count: 100,
          failed_attempts: 5,
          last_seen: new Date(),
          blocked: false,
          blocked_reason: null,
          blocked_until: null,
        }],
      });

      // First call
      await service.getReputation('192.168.1.1');
      // Second call - should use cache
      await service.getReputation('192.168.1.1');

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('recordEvent', () => {
    beforeEach(() => {
      mockQuery.mockResolvedValue({ rows: [] });
    });

    it('should not change score for regular requests', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 50,
          request_count: 0,
          failed_attempts: 0,
          last_seen: new Date(),
          blocked: false,
          blocked_reason: null,
          blocked_until: null,
        }],
      });

      const result = await service.recordEvent('192.168.1.1', { type: 'request' });

      expect(result.score).toBe(50);
      expect(result.requestCount).toBe(1);
    });

    it('should decrease score for auth failures', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 50,
          request_count: 0,
          failed_attempts: 0,
          last_seen: new Date(),
          blocked: false,
          blocked_reason: null,
          blocked_until: null,
        }],
      });

      const result = await service.recordEvent('192.168.1.1', { type: 'auth_failure' });

      expect(result.score).toBe(40); // -10 for auth failure
      expect(result.failedAttempts).toBe(1);
    });

    it('should decrease score for rate limiting', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 50,
          request_count: 0,
          failed_attempts: 0,
          last_seen: new Date(),
          blocked: false,
          blocked_reason: null,
          blocked_until: null,
        }],
      });

      const result = await service.recordEvent('192.168.1.1', { type: 'rate_limit' });

      expect(result.score).toBe(35); // -15 for rate limit
    });

    it('should severely decrease score for attack detection', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 50,
          request_count: 0,
          failed_attempts: 0,
          last_seen: new Date(),
          blocked: false,
          blocked_reason: null,
          blocked_until: null,
        }],
      });

      const result = await service.recordEvent('192.168.1.1', { type: 'attack_detected' });

      expect(result.score).toBe(0); // -50 for attack
      expect(result.blocked).toBe(true);
    });

    it('should increase score for successful operations', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 50,
          request_count: 0,
          failed_attempts: 0,
          last_seen: new Date(),
          blocked: false,
          blocked_reason: null,
          blocked_until: null,
        }],
      });

      const result = await service.recordEvent('192.168.1.1', { type: 'success' });

      expect(result.score).toBe(55); // +5 for success
    });

    it('should not exceed max score', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 98,
          request_count: 0,
          failed_attempts: 0,
          last_seen: new Date(),
          blocked: false,
          blocked_reason: null,
          blocked_until: null,
        }],
      });

      const result = await service.recordEvent('192.168.1.1', { type: 'success' });

      expect(result.score).toBe(100); // Capped at 100
    });

    it('should not go below min score', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 5,
          request_count: 0,
          failed_attempts: 0,
          last_seen: new Date(),
          blocked: false,
          blocked_reason: null,
          blocked_until: null,
        }],
      });

      const result = await service.recordEvent('192.168.1.1', { type: 'auth_failure' });

      expect(result.score).toBe(0); // Capped at 0
    });

    it('should block IP when score drops below threshold', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 25,
          request_count: 0,
          failed_attempts: 10,
          last_seen: new Date(),
          blocked: false,
          blocked_reason: null,
          blocked_until: null,
        }],
      });

      const result = await service.recordEvent('192.168.1.1', { type: 'auth_failure' });

      expect(result.score).toBe(15);
      expect(result.blocked).toBe(true);
      expect(result.blockedReason).toContain('Score dropped to 15');
    });
  });

  describe('isBlocked', () => {
    it('should return not blocked for clean IP', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 75,
          request_count: 10,
          failed_attempts: 0,
          last_seen: new Date(),
          blocked: false,
          blocked_reason: null,
          blocked_until: null,
        }],
      });

      const result = await service.isBlocked('192.168.1.1');

      expect(result.blocked).toBe(false);
    });

    it('should return blocked for blocked IP', async () => {
      const blockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ip: '192.168.1.1',
          score: 0,
          request_count: 100,
          failed_attempts: 50,
          last_seen: new Date(),
          blocked: true,
          blocked_reason: 'Too many failed attempts',
          blocked_until: blockedUntil,
        }],
      });

      const result = await service.isBlocked('192.168.1.1');

      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('Too many failed attempts');
      expect(result.until).toEqual(blockedUntil);
    });

    it('should auto-unblock expired blocks', async () => {
      const expiredDate = new Date(Date.now() - 1000); // 1 second ago
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            ip: '192.168.1.1',
            score: 0,
            request_count: 100,
            failed_attempts: 50,
            last_seen: new Date(),
            blocked: true,
            blocked_reason: 'Expired block',
            blocked_until: expiredDate,
          }],
        })
        .mockResolvedValue({ rows: [] }); // For unblock and subsequent calls

      const result = await service.isBlocked('192.168.1.1');

      expect(result.blocked).toBe(false);
    });
  });

  describe('block', () => {
    it('should manually block an IP', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await service.block('192.168.1.1', 'Manual block for testing', 3600000);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ip_reputation'),
        expect.arrayContaining([
          '192.168.1.1',
          0, // score
          expect.any(Number),
          expect.any(Number),
          expect.any(Date),
          true, // blocked
          'Manual block for testing',
          expect.any(Date),
        ])
      );
    });
  });

  describe('unblock', () => {
    it('should unblock an IP and reset score', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          ip: '192.168.1.1',
          score: 0,
          request_count: 100,
          failed_attempts: 50,
          last_seen: new Date(),
          blocked: true,
          blocked_reason: 'Was blocked',
          blocked_until: new Date(Date.now() + 86400000),
        }],
      });

      await service.unblock('192.168.1.1');

      // Should have called with reset values
      expect(mockQuery).toHaveBeenLastCalledWith(
        expect.stringContaining('INSERT INTO ip_reputation'),
        expect.arrayContaining([
          '192.168.1.1',
          50, // Reset to initial score
          expect.any(Number),
          0, // Reset failed attempts
          expect.any(Date),
          false, // Not blocked
          null,
          null,
        ])
      );
    });
  });

  describe('getBlockedIPs', () => {
    it('should return list of blocked IPs', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            ip: '192.168.1.1',
            score: 0,
            request_count: 100,
            failed_attempts: 50,
            last_seen: new Date(),
            blocked: true,
            blocked_reason: 'Attack',
            blocked_until: new Date(),
          },
          {
            ip: '10.0.0.1',
            score: 5,
            request_count: 50,
            failed_attempts: 25,
            last_seen: new Date(),
            blocked: true,
            blocked_reason: 'Rate limiting',
            blocked_until: new Date(),
          },
        ],
      });

      const result = await service.getBlockedIPs();

      expect(result).toHaveLength(2);
      expect(result[0]!.ip).toBe('192.168.1.1');
      expect(result[1]!.ip).toBe('10.0.0.1');
    });
  });

  describe('getSuspiciousIPs', () => {
    it('should return IPs with low score but not blocked', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          {
            ip: '192.168.1.100',
            score: 30,
            request_count: 500,
            failed_attempts: 20,
            last_seen: new Date(),
            blocked: false,
            blocked_reason: null,
            blocked_until: null,
          },
        ],
      });

      const result = await service.getSuspiciousIPs();

      expect(result).toHaveLength(1);
      expect(result[0]!.score).toBeLessThan(50);
      expect(result[0]!.blocked).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should delete old unblocked entries', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ count: '150' }],
      });

      const result = await service.cleanup(30);

      expect(result).toBe(150);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM ip_reputation'),
        expect.any(Array)
      );
    });
  });
});
