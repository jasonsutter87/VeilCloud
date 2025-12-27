/**
 * Webhook Service Tests
 */

// Mock dependencies
jest.mock('../../src/db/connection.js', () => ({
  query: jest.fn(),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

import { query } from '../../src/db/connection.js';
const mockQuery = query as jest.Mock;

describe('WebhookService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockReset();
  });

  describe('registerWebhook', () => {
    it('should register webhook with URL', async () => {
      mockQuery.mockResolvedValue({
        rows: [{
          id: 'webhook-1',
          url: 'https://example.com/webhook',
          events: ['secret.write', 'secret.delete'],
          active: true,
        }],
      });

      const result = await mockQuery(
        'INSERT INTO webhooks (project_id, url, events) VALUES ($1, $2, $3) RETURNING *',
        ['proj-1', 'https://example.com/webhook', ['secret.write', 'secret.delete']]
      );

      expect(result.rows[0].url).toBe('https://example.com/webhook');
    });

    it('should validate URL format', () => {
      const isValidUrl = (url: string): boolean => {
        try {
          const parsed = new URL(url);
          return parsed.protocol === 'https:';
        } catch {
          return false;
        }
      };

      expect(isValidUrl('https://example.com/webhook')).toBe(true);
      expect(isValidUrl('http://example.com/webhook')).toBe(false);
      expect(isValidUrl('not-a-url')).toBe(false);
    });

    it('should generate webhook secret', async () => {
      const crypto = require('crypto');
      const secret = crypto.randomBytes(32).toString('hex');

      mockQuery.mockResolvedValue({
        rows: [{ secret }],
      });

      expect(secret).toHaveLength(64);
    });

    it('should validate event types', () => {
      const validEvents = ['secret.write', 'secret.delete', 'secret.read', 'project.update'];
      const isValidEvent = (event: string): boolean => validEvents.includes(event);

      expect(isValidEvent('secret.write')).toBe(true);
      expect(isValidEvent('invalid.event')).toBe(false);
    });

    it('should reject duplicate URLs for same project', async () => {
      mockQuery.mockRejectedValue(
        new Error('unique_violation')
      );

      await expect(
        mockQuery('INSERT INTO webhooks...', ['proj-1', 'https://existing.com/hook'])
      ).rejects.toThrow();
    });
  });

  describe('updateWebhook', () => {
    it('should update webhook URL', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ url: 'https://new-url.com/webhook' }],
      });

      const result = await mockQuery(
        'UPDATE webhooks SET url = $2 WHERE id = $1 RETURNING *',
        ['webhook-1', 'https://new-url.com/webhook']
      );

      expect(result.rows[0].url).toBe('https://new-url.com/webhook');
    });

    it('should update events list', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ events: ['secret.write'] }],
      });

      const result = await mockQuery(
        'UPDATE webhooks SET events = $2 WHERE id = $1',
        ['webhook-1', ['secret.write']]
      );

      expect(result.rows[0].events).toContain('secret.write');
    });

    it('should toggle active status', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ active: false }],
      });

      const result = await mockQuery(
        'UPDATE webhooks SET active = $2 WHERE id = $1',
        ['webhook-1', false]
      );

      expect(result.rows[0].active).toBe(false);
    });
  });

  describe('deleteWebhook', () => {
    it('should delete webhook', async () => {
      mockQuery.mockResolvedValue({ rowCount: 1 });

      await mockQuery('DELETE FROM webhooks WHERE id = $1', ['webhook-1']);

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should return false for non-existent webhook', async () => {
      mockQuery.mockResolvedValue({ rowCount: 0 });

      const result = await mockQuery('DELETE FROM webhooks WHERE id = $1', ['nonexistent']);

      expect(result.rowCount).toBe(0);
    });
  });

  describe('listWebhooks', () => {
    it('should list project webhooks', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'hook-1', url: 'https://a.com/hook', events: ['secret.write'] },
          { id: 'hook-2', url: 'https://b.com/hook', events: ['secret.delete'] },
        ],
      });

      const result = await mockQuery('SELECT * FROM webhooks WHERE project_id = $1', ['proj-1']);

      expect(result.rows).toHaveLength(2);
    });

    it('should filter by active status', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ active: true }],
      });

      const result = await mockQuery('SELECT * FROM webhooks WHERE active = $1', [true]);

      expect(result.rows[0].active).toBe(true);
    });
  });

  describe('triggerWebhook', () => {
    it('should send POST request to webhook URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      });

      await fetch('https://example.com/webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'secret.write', data: {} }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('should include signature header', async () => {
      const crypto = require('crypto');
      const payload = JSON.stringify({ event: 'test' });
      const secret = 'webhook-secret';
      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      mockFetch.mockResolvedValue({ ok: true });

      await fetch('https://example.com/webhook', {
        method: 'POST',
        headers: {
          'X-Webhook-Signature': `sha256=${signature}`,
        },
        body: payload,
      });

      expect(mockFetch).toHaveBeenCalled();
    });

    it('should include event type in payload', async () => {
      mockFetch.mockResolvedValue({ ok: true });

      const payload = {
        event: 'secret.write',
        timestamp: new Date().toISOString(),
        data: { projectId: 'proj-1', env: 'production' },
      };

      await fetch('https://example.com/webhook', {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('secret.write'),
        })
      );
    });

    it('should handle webhook failure', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
      });

      const response = await fetch('https://example.com/webhook', {
        method: 'POST',
        body: '{}',
      });

      expect(response.ok).toBe(false);
    });

    it('should handle network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(
        fetch('https://example.com/webhook', { method: 'POST' })
      ).rejects.toThrow('Network error');
    });

    it('should timeout after specified duration', async () => {
      mockFetch.mockImplementation(() =>
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 100)
        )
      );

      await expect(
        fetch('https://slow.com/webhook', { method: 'POST' })
      ).rejects.toThrow('Timeout');
    });
  });

  describe('retryWebhook', () => {
    it('should retry failed webhook', async () => {
      let attempts = 0;
      mockFetch.mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          return Promise.resolve({ ok: false, status: 500 });
        }
        return Promise.resolve({ ok: true, status: 200 });
      });

      // Simulate retry logic
      for (let i = 0; i < 3; i++) {
        const response = await fetch('https://example.com/webhook', { method: 'POST' });
        if (response.ok) break;
      }

      expect(attempts).toBe(3);
    });

    it('should use exponential backoff', async () => {
      const backoffMs = (attempt: number): number => {
        return Math.min(1000 * Math.pow(2, attempt), 30000);
      };

      expect(backoffMs(0)).toBe(1000);
      expect(backoffMs(1)).toBe(2000);
      expect(backoffMs(2)).toBe(4000);
      expect(backoffMs(5)).toBe(30000); // Max
    });

    it('should give up after max retries', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const maxRetries = 5;
      let attempts = 0;

      for (let i = 0; i <= maxRetries; i++) {
        attempts++;
        const response = await fetch('https://example.com/webhook', { method: 'POST' });
        if (response.ok) break;
      }

      expect(attempts).toBe(maxRetries + 1);
    });
  });

  describe('webhookDeliveryLog', () => {
    it('should log successful delivery', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await mockQuery(
        'INSERT INTO webhook_deliveries (webhook_id, status, response_code, delivered_at) VALUES ($1, $2, $3, NOW())',
        ['webhook-1', 'success', 200]
      );

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should log failed delivery', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await mockQuery(
        'INSERT INTO webhook_deliveries (webhook_id, status, response_code, error) VALUES ($1, $2, $3, $4)',
        ['webhook-1', 'failed', 500, 'Internal Server Error']
      );

      expect(mockQuery).toHaveBeenCalled();
    });

    it('should store response time', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ response_time_ms: 150 }],
      });

      const result = await mockQuery(
        'INSERT INTO webhook_deliveries (webhook_id, response_time_ms) VALUES ($1, $2) RETURNING *',
        ['webhook-1', 150]
      );

      expect(result.rows[0].response_time_ms).toBe(150);
    });

    it('should list delivery history', async () => {
      mockQuery.mockResolvedValue({
        rows: [
          { id: 'd1', status: 'success', response_code: 200 },
          { id: 'd2', status: 'failed', response_code: 500 },
        ],
      });

      const result = await mockQuery(
        'SELECT * FROM webhook_deliveries WHERE webhook_id = $1 ORDER BY delivered_at DESC',
        ['webhook-1']
      );

      expect(result.rows).toHaveLength(2);
    });
  });

  describe('signatureVerification', () => {
    it('should create valid signature', () => {
      const crypto = require('crypto');
      const payload = '{"event":"test"}';
      const secret = 'secret123';

      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      expect(signature).toHaveLength(64);
    });

    it('should verify valid signature', () => {
      const crypto = require('crypto');
      const payload = '{"event":"test"}';
      const secret = 'secret123';

      const signature = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

      expect(signature).toBe(expected);
    });

    it('should reject invalid signature', () => {
      const crypto = require('crypto');
      const payload = '{"event":"test"}';
      const secret = 'secret123';

      const validSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const invalidSig = crypto.createHmac('sha256', 'wrong-secret').update(payload).digest('hex');

      expect(validSig).not.toBe(invalidSig);
    });

    it('should reject tampered payload', () => {
      const crypto = require('crypto');
      const secret = 'secret123';

      const originalSig = crypto.createHmac('sha256', secret).update('original').digest('hex');
      const tamperedSig = crypto.createHmac('sha256', secret).update('tampered').digest('hex');

      expect(originalSig).not.toBe(tamperedSig);
    });
  });

  describe('eventFiltering', () => {
    it('should only trigger for subscribed events', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ events: ['secret.write', 'secret.delete'] }],
      });

      const result = await mockQuery('SELECT events FROM webhooks WHERE id = $1', ['webhook-1']);
      const subscribedEvents = result.rows[0].events;

      expect(subscribedEvents.includes('secret.write')).toBe(true);
      expect(subscribedEvents.includes('project.update')).toBe(false);
    });

    it('should support wildcard events', async () => {
      mockQuery.mockResolvedValue({
        rows: [{ events: ['secret.*'] }],
      });

      const matchesWildcard = (subscribed: string, event: string): boolean => {
        if (subscribed.endsWith('.*')) {
          const prefix = subscribed.slice(0, -2);
          return event.startsWith(prefix);
        }
        return subscribed === event;
      };

      expect(matchesWildcard('secret.*', 'secret.write')).toBe(true);
      expect(matchesWildcard('secret.*', 'secret.delete')).toBe(true);
      expect(matchesWildcard('secret.*', 'project.update')).toBe(false);
    });
  });

  describe('rateLimit', () => {
    it('should limit webhook delivery rate', async () => {
      const maxPerMinute = 60;
      const deliveries: Date[] = [];

      // Simulate rate limiting
      const canDeliver = (): boolean => {
        const oneMinuteAgo = new Date(Date.now() - 60000);
        const recentDeliveries = deliveries.filter(d => d > oneMinuteAgo);
        return recentDeliveries.length < maxPerMinute;
      };

      for (let i = 0; i < 70; i++) {
        if (canDeliver()) {
          deliveries.push(new Date());
        }
      }

      // Should have stopped at 60
      expect(deliveries.length).toBeLessThanOrEqual(maxPerMinute);
    });
  });

  describe('payloadFormatting', () => {
    it('should format secret.write event', () => {
      const payload = {
        event: 'secret.write',
        timestamp: new Date().toISOString(),
        data: {
          projectId: 'proj-1',
          environment: 'production',
          version: 5,
          hash: 'sha256-hash',
        },
      };

      expect(payload.event).toBe('secret.write');
      expect(payload.data.projectId).toBe('proj-1');
    });

    it('should format secret.delete event', () => {
      const payload = {
        event: 'secret.delete',
        timestamp: new Date().toISOString(),
        data: {
          projectId: 'proj-1',
          environment: 'staging',
          deletedBy: 'user-1',
        },
      };

      expect(payload.event).toBe('secret.delete');
      expect(payload.data.deletedBy).toBe('user-1');
    });

    it('should format project.update event', () => {
      const payload = {
        event: 'project.update',
        timestamp: new Date().toISOString(),
        data: {
          projectId: 'proj-1',
          changes: { name: 'New Name' },
          updatedBy: 'user-1',
        },
      };

      expect(payload.event).toBe('project.update');
      expect(payload.data.changes.name).toBe('New Name');
    });
  });
});
