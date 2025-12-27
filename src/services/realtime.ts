/**
 * Realtime Service
 * WebSocket-based real-time updates for audit events, decryption requests, etc.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { UserId, ProjectId, TeamId } from '../types.js';

// ============================================================================
// Types
// ============================================================================

export type RealtimeEventType =
  | 'audit.entry'
  | 'decrypt.request'
  | 'decrypt.share'
  | 'decrypt.complete'
  | 'project.update'
  | 'team.update'
  | 'blob.update';

export interface RealtimeEvent {
  type: RealtimeEventType;
  payload: unknown;
  timestamp: Date;
}

interface Subscription {
  userId: UserId;
  projectIds: Set<string>;
  teamIds: Set<string>;
}

interface AuthenticatedWebSocket extends WebSocket {
  userId?: UserId;
  subscriptions?: {
    projects: Set<string>;
    teams: Set<string>;
  };
  isAlive?: boolean;
}

// ============================================================================
// Service
// ============================================================================

export class RealtimeService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, AuthenticatedWebSocket> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  /**
   * Initialize WebSocket server
   */
  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: AuthenticatedWebSocket, req) => {
      // Parse auth from query string
      const url = new URL(req.url ?? '', `http://${req.headers.host}`);
      const token = url.searchParams.get('token');

      if (!token) {
        ws.close(4001, 'Authentication required');
        return;
      }

      // TODO: Verify token and get userId
      // For now, we'll use the token as userId for testing
      ws.userId = token as UserId;
      ws.subscriptions = {
        projects: new Set(),
        teams: new Set(),
      };
      ws.isAlive = true;

      this.clients.set(token, ws);

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (data) => {
        this.handleMessage(ws, data.toString());
      });

      ws.on('close', () => {
        if (ws.userId) {
          this.clients.delete(ws.userId);
        }
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'Connected to VeilCloud realtime',
        timestamp: new Date().toISOString(),
      }));
    });

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.wss?.clients.forEach((ws) => {
        const authWs = ws as AuthenticatedWebSocket;
        if (authWs.isAlive === false) {
          if (authWs.userId) {
            this.clients.delete(authWs.userId);
          }
          return authWs.terminate();
        }
        authWs.isAlive = false;
        authWs.ping();
      });
    }, 30000);

    console.log('[Realtime] WebSocket server initialized');
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(ws: AuthenticatedWebSocket, data: string): void {
    try {
      const message = JSON.parse(data);

      switch (message.action) {
        case 'subscribe':
          this.handleSubscribe(ws, message);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(ws, message);
          break;
        default:
          ws.send(JSON.stringify({ error: 'Unknown action' }));
      }
    } catch (error) {
      ws.send(JSON.stringify({ error: 'Invalid message format' }));
    }
  }

  /**
   * Handle subscribe message
   */
  private handleSubscribe(
    ws: AuthenticatedWebSocket,
    message: { projects?: string[]; teams?: string[] }
  ): void {
    if (message.projects) {
      message.projects.forEach((id) => ws.subscriptions?.projects.add(id));
    }
    if (message.teams) {
      message.teams.forEach((id) => ws.subscriptions?.teams.add(id));
    }

    ws.send(JSON.stringify({
      type: 'subscribed',
      projects: Array.from(ws.subscriptions?.projects ?? []),
      teams: Array.from(ws.subscriptions?.teams ?? []),
    }));
  }

  /**
   * Handle unsubscribe message
   */
  private handleUnsubscribe(
    ws: AuthenticatedWebSocket,
    message: { projects?: string[]; teams?: string[] }
  ): void {
    if (message.projects) {
      message.projects.forEach((id) => ws.subscriptions?.projects.delete(id));
    }
    if (message.teams) {
      message.teams.forEach((id) => ws.subscriptions?.teams.delete(id));
    }

    ws.send(JSON.stringify({
      type: 'unsubscribed',
      projects: Array.from(ws.subscriptions?.projects ?? []),
      teams: Array.from(ws.subscriptions?.teams ?? []),
    }));
  }

  /**
   * Broadcast event to subscribed clients
   */
  broadcast(
    event: RealtimeEvent,
    filter: { projectId?: ProjectId; teamId?: TeamId; userIds?: UserId[] }
  ): void {
    const message = JSON.stringify({
      ...event,
      timestamp: event.timestamp.toISOString(),
    });

    this.clients.forEach((ws, userId) => {
      // Check if user should receive this event
      let shouldSend = false;

      if (filter.userIds?.includes(userId as UserId)) {
        shouldSend = true;
      }

      if (filter.projectId && ws.subscriptions?.projects.has(filter.projectId)) {
        shouldSend = true;
      }

      if (filter.teamId && ws.subscriptions?.teams.has(filter.teamId)) {
        shouldSend = true;
      }

      if (shouldSend && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  }

  /**
   * Send event to specific user
   */
  sendToUser(userId: UserId, event: RealtimeEvent): void {
    const ws = this.clients.get(userId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        ...event,
        timestamp: event.timestamp.toISOString(),
      }));
    }
  }

  /**
   * Broadcast audit entry
   */
  broadcastAuditEntry(
    projectId: ProjectId,
    entry: {
      action: string;
      userId: UserId;
      context?: unknown;
    }
  ): void {
    this.broadcast(
      {
        type: 'audit.entry',
        payload: entry,
        timestamp: new Date(),
      },
      { projectId }
    );
  }

  /**
   * Broadcast decryption request
   */
  broadcastDecryptionRequest(
    teamId: TeamId,
    request: {
      requestId: string;
      requesterId: UserId;
      sharesNeeded: number;
      sharesCollected: number;
    }
  ): void {
    this.broadcast(
      {
        type: 'decrypt.request',
        payload: request,
        timestamp: new Date(),
      },
      { teamId }
    );
  }

  /**
   * Broadcast decryption share submitted
   */
  broadcastDecryptionShare(
    teamId: TeamId,
    share: {
      requestId: string;
      shareIndex: number;
      sharesCollected: number;
      sharesNeeded: number;
    }
  ): void {
    this.broadcast(
      {
        type: 'decrypt.share',
        payload: share,
        timestamp: new Date(),
      },
      { teamId }
    );
  }

  /**
   * Broadcast blob update
   */
  broadcastBlobUpdate(
    projectId: ProjectId,
    update: {
      envName: string;
      action: 'created' | 'updated' | 'deleted';
      userId: UserId;
    }
  ): void {
    this.broadcast(
      {
        type: 'blob.update',
        payload: update,
        timestamp: new Date(),
      },
      { projectId }
    );
  }

  /**
   * Cleanup
   */
  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.wss?.close();
    this.clients.clear();
  }

  /**
   * Get connection count
   */
  getConnectionCount(): number {
    return this.clients.size;
  }
}

// ============================================================================
// Singleton
// ============================================================================

let realtimeService: RealtimeService | null = null;

export function getRealtimeService(): RealtimeService {
  if (!realtimeService) {
    realtimeService = new RealtimeService();
  }
  return realtimeService;
}
