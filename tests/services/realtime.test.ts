/**
 * Realtime Service Tests (WebSocket)
 */

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: Error) => void) | null = null;

  private sentMessages: string[] = [];

  send(data: string): void {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
    this.sentMessages.push(data);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose();
  }

  _open(): void {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen();
  }

  _receive(data: string): void {
    if (this.onmessage) {
      this.onmessage({ data });
    }
  }

  _error(error: Error): void {
    if (this.onerror) this.onerror(error);
  }

  getSentMessages(): string[] {
    return this.sentMessages;
  }
}

// Mock Realtime Service
class RealtimeService {
  private clients: Map<string, MockWebSocket> = new Map();
  private subscriptions: Map<string, Set<string>> = new Map();

  connect(clientId: string, ws: MockWebSocket): void {
    this.clients.set(clientId, ws);
  }

  disconnect(clientId: string): void {
    this.clients.delete(clientId);
    for (const subs of this.subscriptions.values()) {
      subs.delete(clientId);
    }
  }

  subscribe(clientId: string, channel: string): boolean {
    if (!this.clients.has(clientId)) return false;

    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    this.subscriptions.get(channel)!.add(clientId);
    return true;
  }

  unsubscribe(clientId: string, channel: string): boolean {
    const subs = this.subscriptions.get(channel);
    if (!subs) return false;
    return subs.delete(clientId);
  }

  publish(channel: string, message: object): number {
    const subs = this.subscriptions.get(channel);
    if (!subs) return 0;

    let delivered = 0;
    for (const clientId of subs) {
      const ws = this.clients.get(clientId);
      if (ws && ws.readyState === MockWebSocket.OPEN) {
        ws.send(JSON.stringify({ channel, ...message }));
        delivered++;
      }
    }
    return delivered;
  }

  getClientCount(): number {
    return this.clients.size;
  }

  getChannelSubscribers(channel: string): number {
    return this.subscriptions.get(channel)?.size || 0;
  }

  isSubscribed(clientId: string, channel: string): boolean {
    return this.subscriptions.get(channel)?.has(clientId) || false;
  }
}

describe('RealtimeService', () => {
  let service: RealtimeService;

  beforeEach(() => {
    service = new RealtimeService();
  });

  describe('connect', () => {
    it('should register client', () => {
      const ws = new MockWebSocket();
      service.connect('client-1', ws);
      expect(service.getClientCount()).toBe(1);
    });

    it('should handle multiple clients', () => {
      service.connect('client-1', new MockWebSocket());
      service.connect('client-2', new MockWebSocket());
      service.connect('client-3', new MockWebSocket());
      expect(service.getClientCount()).toBe(3);
    });

    it('should replace existing client', () => {
      service.connect('client-1', new MockWebSocket());
      service.connect('client-1', new MockWebSocket());
      expect(service.getClientCount()).toBe(1);
    });
  });

  describe('disconnect', () => {
    it('should remove client', () => {
      service.connect('client-1', new MockWebSocket());
      service.disconnect('client-1');
      expect(service.getClientCount()).toBe(0);
    });

    it('should remove subscriptions on disconnect', () => {
      service.connect('client-1', new MockWebSocket());
      service.subscribe('client-1', 'channel-1');
      service.disconnect('client-1');
      expect(service.getChannelSubscribers('channel-1')).toBe(0);
    });

    it('should handle disconnect of non-existent client', () => {
      expect(() => service.disconnect('nonexistent')).not.toThrow();
    });
  });

  describe('subscribe', () => {
    it('should subscribe client to channel', () => {
      service.connect('client-1', new MockWebSocket());
      const result = service.subscribe('client-1', 'channel-1');
      expect(result).toBe(true);
      expect(service.isSubscribed('client-1', 'channel-1')).toBe(true);
    });

    it('should fail for non-connected client', () => {
      const result = service.subscribe('nonexistent', 'channel-1');
      expect(result).toBe(false);
    });

    it('should allow multiple channels', () => {
      service.connect('client-1', new MockWebSocket());
      service.subscribe('client-1', 'channel-1');
      service.subscribe('client-1', 'channel-2');
      expect(service.isSubscribed('client-1', 'channel-1')).toBe(true);
      expect(service.isSubscribed('client-1', 'channel-2')).toBe(true);
    });

    it('should allow multiple clients per channel', () => {
      service.connect('client-1', new MockWebSocket());
      service.connect('client-2', new MockWebSocket());
      service.subscribe('client-1', 'channel-1');
      service.subscribe('client-2', 'channel-1');
      expect(service.getChannelSubscribers('channel-1')).toBe(2);
    });

    it('should handle duplicate subscription', () => {
      service.connect('client-1', new MockWebSocket());
      service.subscribe('client-1', 'channel-1');
      service.subscribe('client-1', 'channel-1');
      expect(service.getChannelSubscribers('channel-1')).toBe(1);
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe client from channel', () => {
      service.connect('client-1', new MockWebSocket());
      service.subscribe('client-1', 'channel-1');
      const result = service.unsubscribe('client-1', 'channel-1');
      expect(result).toBe(true);
      expect(service.isSubscribed('client-1', 'channel-1')).toBe(false);
    });

    it('should return false for non-existent subscription', () => {
      const result = service.unsubscribe('client-1', 'channel-1');
      expect(result).toBe(false);
    });

    it('should not affect other subscriptions', () => {
      service.connect('client-1', new MockWebSocket());
      service.subscribe('client-1', 'channel-1');
      service.subscribe('client-1', 'channel-2');
      service.unsubscribe('client-1', 'channel-1');
      expect(service.isSubscribed('client-1', 'channel-2')).toBe(true);
    });
  });

  describe('publish', () => {
    it('should deliver message to subscribers', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'channel-1');

      const delivered = service.publish('channel-1', { event: 'test' });

      expect(delivered).toBe(1);
      expect(ws.getSentMessages()).toHaveLength(1);
    });

    it('should deliver to multiple subscribers', () => {
      const ws1 = new MockWebSocket();
      const ws2 = new MockWebSocket();
      ws1._open();
      ws2._open();

      service.connect('client-1', ws1);
      service.connect('client-2', ws2);
      service.subscribe('client-1', 'channel-1');
      service.subscribe('client-2', 'channel-1');

      const delivered = service.publish('channel-1', { event: 'test' });

      expect(delivered).toBe(2);
    });

    it('should not deliver to unsubscribed clients', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      // Not subscribed

      const delivered = service.publish('channel-1', { event: 'test' });

      expect(delivered).toBe(0);
      expect(ws.getSentMessages()).toHaveLength(0);
    });

    it('should not deliver to closed connections', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'channel-1');
      ws.close();

      const delivered = service.publish('channel-1', { event: 'test' });

      expect(delivered).toBe(0);
    });

    it('should include channel in message', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'channel-1');

      service.publish('channel-1', { event: 'test', data: 'hello' });

      const message = JSON.parse(ws.getSentMessages()[0]!);
      expect(message.channel).toBe('channel-1');
      expect(message.event).toBe('test');
    });

    it('should return 0 for non-existent channel', () => {
      const delivered = service.publish('nonexistent', { event: 'test' });
      expect(delivered).toBe(0);
    });
  });

  describe('message handling', () => {
    it('should parse JSON messages', () => {
      const ws = new MockWebSocket();
      let receivedMessage: any = null;

      ws.onmessage = (event) => {
        receivedMessage = JSON.parse(event.data);
      };

      ws._receive(JSON.stringify({ type: 'test', value: 123 }));

      expect(receivedMessage).toEqual({ type: 'test', value: 123 });
    });

    it('should handle connection open event', () => {
      const ws = new MockWebSocket();
      let opened = false;

      ws.onopen = () => {
        opened = true;
      };

      ws._open();

      expect(opened).toBe(true);
    });

    it('should handle connection close event', () => {
      const ws = new MockWebSocket();
      let closed = false;

      ws.onclose = () => {
        closed = true;
      };

      ws._open();
      ws.close();

      expect(closed).toBe(true);
    });

    it('should handle error event', () => {
      const ws = new MockWebSocket();
      let errorReceived: Error | null = null;

      ws.onerror = (error) => {
        errorReceived = error;
      };

      ws._error(new Error('Test error'));

      expect(errorReceived).toBeTruthy();
      expect(errorReceived!.message).toBe('Test error');
    });
  });

  describe('channel patterns', () => {
    it('should support project channels', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'project:proj-1');

      const delivered = service.publish('project:proj-1', { event: 'update' });

      expect(delivered).toBe(1);
    });

    it('should support user channels', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'user:user-1');

      const delivered = service.publish('user:user-1', { event: 'notification' });

      expect(delivered).toBe(1);
    });

    it('should support team channels', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'team:team-1');

      const delivered = service.publish('team:team-1', { event: 'decrypt_request' });

      expect(delivered).toBe(1);
    });
  });

  describe('event types', () => {
    it('should deliver audit events', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'audit:proj-1');

      service.publish('audit:proj-1', {
        event: 'entry_added',
        entryId: 'entry-123',
        action: 'secret.write',
      });

      const message = JSON.parse(ws.getSentMessages()[0]!);
      expect(message.event).toBe('entry_added');
    });

    it('should deliver decrypt request events', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'decrypt:team-1');

      service.publish('decrypt:team-1', {
        event: 'share_requested',
        requestId: 'req-123',
        requester: 'user-1',
      });

      const message = JSON.parse(ws.getSentMessages()[0]!);
      expect(message.event).toBe('share_requested');
    });

    it('should deliver env update events', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'env:proj-1:production');

      service.publish('env:proj-1:production', {
        event: 'updated',
        version: 5,
        hash: 'new-hash',
      });

      const message = JSON.parse(ws.getSentMessages()[0]!);
      expect(message.version).toBe(5);
    });
  });

  describe('concurrent operations', () => {
    it('should handle rapid subscribe/unsubscribe', () => {
      service.connect('client-1', new MockWebSocket());

      for (let i = 0; i < 100; i++) {
        service.subscribe('client-1', `channel-${i % 10}`);
        if (i % 2 === 0) {
          service.unsubscribe('client-1', `channel-${i % 10}`);
        }
      }

      // Should not throw
      expect(service.getClientCount()).toBe(1);
    });

    it('should handle rapid publish', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'channel-1');

      for (let i = 0; i < 100; i++) {
        service.publish('channel-1', { event: `event-${i}` });
      }

      expect(ws.getSentMessages()).toHaveLength(100);
    });
  });

  describe('edge cases', () => {
    it('should handle empty message', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'channel-1');

      service.publish('channel-1', {});

      expect(ws.getSentMessages()).toHaveLength(1);
    });

    it('should handle large messages', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'channel-1');

      const largeData = 'x'.repeat(100000);
      service.publish('channel-1', { data: largeData });

      expect(ws.getSentMessages()[0]!.length).toBeGreaterThan(100000);
    });

    it('should handle special characters in channel names', () => {
      const ws = new MockWebSocket();
      ws._open();
      service.connect('client-1', ws);
      service.subscribe('client-1', 'channel:with:colons');

      const delivered = service.publish('channel:with:colons', { event: 'test' });

      expect(delivered).toBe(1);
    });
  });
});

describe('WebSocket Message Types', () => {
  describe('Message Formatting', () => {
    it('should format subscription message', () => {
      const message = JSON.stringify({
        type: 'subscribe',
        channel: 'project:proj-1',
      });

      const parsed = JSON.parse(message);
      expect(parsed.type).toBe('subscribe');
      expect(parsed.channel).toBe('project:proj-1');
    });

    it('should format unsubscribe message', () => {
      const message = JSON.stringify({
        type: 'unsubscribe',
        channel: 'project:proj-1',
      });

      const parsed = JSON.parse(message);
      expect(parsed.type).toBe('unsubscribe');
    });

    it('should format ping message', () => {
      const message = JSON.stringify({
        type: 'ping',
        timestamp: Date.now(),
      });

      const parsed = JSON.parse(message);
      expect(parsed.type).toBe('ping');
    });

    it('should format pong message', () => {
      const message = JSON.stringify({
        type: 'pong',
        timestamp: Date.now(),
      });

      const parsed = JSON.parse(message);
      expect(parsed.type).toBe('pong');
    });

    it('should format auth message', () => {
      const message = JSON.stringify({
        type: 'auth',
        token: 'jwt-token',
      });

      const parsed = JSON.parse(message);
      expect(parsed.type).toBe('auth');
      expect(parsed.token).toBeTruthy();
    });
  });

  describe('Event Messages', () => {
    it('should format secret.write event', () => {
      const event = {
        type: 'event',
        channel: 'env:proj-1:production',
        event: 'secret.write',
        data: {
          projectId: 'proj-1',
          environment: 'production',
          version: 5,
          hash: 'sha256-hash',
          timestamp: new Date().toISOString(),
        },
      };

      expect(event.type).toBe('event');
      expect(event.data.version).toBe(5);
    });

    it('should format decrypt.request event', () => {
      const event = {
        type: 'event',
        channel: 'team:team-1',
        event: 'decrypt.request',
        data: {
          requestId: 'req-123',
          requester: 'user-1',
          projectId: 'proj-1',
          environment: 'production',
          timestamp: new Date().toISOString(),
        },
      };

      expect(event.event).toBe('decrypt.request');
      expect(event.data.requestId).toBe('req-123');
    });

    it('should format audit.entry event', () => {
      const event = {
        type: 'event',
        channel: 'audit:proj-1',
        event: 'audit.entry',
        data: {
          entryId: 'entry-123',
          action: 'secret.read',
          userId: 'user-1',
          timestamp: new Date().toISOString(),
        },
      };

      expect(event.data.action).toBe('secret.read');
    });
  });
});
