import { WebSocket } from 'ws';
import logger from '../utils/logger';

export interface WSMessage {
  type: 'task_updated' | 'task_created' | 'task_deleted' | 'schedule_updated' | 'notification' | 'presence_update';
  payload: unknown;
}

interface ClientInfo {
  userId: string;
  username: string;
  projectId: string | null;
  editingField: string | null;
}

const MAX_CONNECTIONS = 500;
const PING_INTERVAL_MS = 30_000;
const PONG_TIMEOUT_MS = 10_000;

export class WebSocketService {
  private static clients: Set<WebSocket> = new Set();
  private static clientInfo: Map<WebSocket, ClientInfo> = new Map();
  private static pingTimer: ReturnType<typeof setInterval> | null = null;

  static startPingInterval() {
    if (WebSocketService.pingTimer) return;
    WebSocketService.pingTimer = setInterval(() => {
      for (const ws of WebSocketService.clients) {
        if (ws.readyState !== WebSocket.OPEN) continue;
        (ws as any).__pongReceived = false;
        ws.ping();
        setTimeout(() => {
          if (!(ws as any).__pongReceived && ws.readyState === WebSocket.OPEN) {
            logger.info('WebSocket client timed out (no pong) — terminating');
            ws.terminate();
          }
        }, PONG_TIMEOUT_MS);
      }
    }, PING_INTERVAL_MS);
    WebSocketService.pingTimer.unref();
  }

  static addClient(ws: WebSocket, userInfo?: { userId: string; username: string }) {
    if (WebSocketService.clients.size >= MAX_CONNECTIONS) {
      logger.warn('WebSocket max connections reached — rejecting new client');
      ws.close(1013, 'Max connections reached');
      return;
    }

    WebSocketService.clients.add(ws);

    // Track pong responses for keepalive
    (ws as any).__pongReceived = true;
    ws.on('pong', () => { (ws as any).__pongReceived = true; });

    if (userInfo) {
      WebSocketService.clientInfo.set(ws, {
        userId: userInfo.userId,
        username: userInfo.username,
        projectId: null,
        editingField: null,
      });
    }

    ws.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
        if (msg.type === 'presence:join' && typeof msg.projectId === 'string') {
          const info = WebSocketService.clientInfo.get(ws);
          if (info) {
            const oldProjectId = info.projectId;
            info.projectId = msg.projectId;
            // Broadcast to old project (someone left) and new project (someone joined)
            if (oldProjectId && oldProjectId !== msg.projectId) {
              WebSocketService.broadcastPresence(oldProjectId);
            }
            WebSocketService.broadcastPresence(msg.projectId);
          }
        } else if (msg.type === 'presence:leave') {
          const info = WebSocketService.clientInfo.get(ws);
          if (info && info.projectId) {
            const projectId = info.projectId;
            info.projectId = null;
            info.editingField = null;
            WebSocketService.broadcastPresence(projectId);
          }
        } else if (msg.type === 'presence:editing' && typeof msg.field === 'string') {
          const info = WebSocketService.clientInfo.get(ws);
          if (info && info.projectId) {
            info.editingField = msg.field;
            WebSocketService.broadcastPresence(info.projectId);
          }
        } else if (msg.type === 'presence:stop_editing') {
          const info = WebSocketService.clientInfo.get(ws);
          if (info && info.projectId && info.editingField) {
            info.editingField = null;
            WebSocketService.broadcastPresence(info.projectId);
          }
        }
      } catch { /* ignore non-JSON messages */ }
    });

    ws.on('close', () => {
      const info = WebSocketService.clientInfo.get(ws);
      const projectId = info?.projectId;
      WebSocketService.clients.delete(ws);
      WebSocketService.clientInfo.delete(ws);
      if (projectId) {
        WebSocketService.broadcastPresence(projectId);
      }
    });

    ws.on('error', (err) => {
      logger.warn('WebSocket client error', { error: err.message });
      const info = WebSocketService.clientInfo.get(ws);
      const projectId = info?.projectId;
      WebSocketService.clients.delete(ws);
      WebSocketService.clientInfo.delete(ws);
      if (projectId) {
        WebSocketService.broadcastPresence(projectId);
      }
    });
  }

  static broadcastPresence(projectId: string) {
    // Collect unique viewers for this project
    const viewers: { userId: string; username: string }[] = [];
    const editors: { userId: string; username: string; field: string }[] = [];
    const seen = new Set<string>();
    for (const [, info] of WebSocketService.clientInfo) {
      if (info.projectId === projectId && !seen.has(info.userId)) {
        seen.add(info.userId);
        viewers.push({ userId: info.userId, username: info.username });
        if (info.editingField) {
          editors.push({ userId: info.userId, username: info.username, field: info.editingField });
        }
      }
    }

    const message = JSON.stringify({
      type: 'presence_update',
      payload: { projectId, viewers, editors },
    });

    // Send only to clients viewing this project
    for (const [ws, info] of WebSocketService.clientInfo) {
      if (info.projectId === projectId && ws.readyState === WebSocket.OPEN) {
        try { ws.send(message); } catch (err) { logger.warn('WebSocket send failed', { error: (err as Error).message }); }
      }
    }
  }

  static broadcast(message: WSMessage) {
    const data = JSON.stringify(message);
    for (const client of WebSocketService.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try { client.send(data); } catch (err) { logger.warn('WebSocket broadcast send failed', { error: (err as Error).message }); }
      }
    }
  }

  static getClientCount(): number {
    return WebSocketService.clients.size;
  }
}
