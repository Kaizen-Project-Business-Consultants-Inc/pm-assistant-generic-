import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';

// ── Mocks ──────────────────────────────────────────────────────────────────

const { mockHasAccess } = vi.hoisted(() => ({
  mockHasAccess: vi.fn(),
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../services/ProjectMemberService', () => ({
  projectMemberService: {
    hasAccess: mockHasAccess,
  },
}));

// We need to mock ws module to provide the OPEN constant
vi.mock('ws', () => ({
  WebSocket: {
    OPEN: 1,
    CLOSED: 3,
  },
}));

// ── Import after mocks ─────────────────────────────────────────────────────

import { WebSocketService, WSMessage } from '../../services/WebSocketService';
import { WebSocket } from 'ws';
import logger from '../../utils/logger';

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Create a fake WebSocket that is an EventEmitter with send/close/ping/terminate/readyState */
function createMockWs(readyState = WebSocket.OPEN): any {
  const emitter = new EventEmitter();
  const ws = Object.assign(emitter, {
    readyState,
    send: vi.fn(),
    close: vi.fn(),
    ping: vi.fn(),
    terminate: vi.fn(),
  });
  // Alias EventEmitter 'on' is already present
  return ws;
}

/** Helper to reset the static state between tests */
function resetService() {
  // Access private statics to clear them
  (WebSocketService as any).clients = new Set();
  (WebSocketService as any).clientInfo = new Map();
  if ((WebSocketService as any).pingTimer) {
    clearInterval((WebSocketService as any).pingTimer);
    (WebSocketService as any).pingTimer = null;
  }
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('WebSocketService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetService();
  });

  // ────────────────────────────────────────────────────────────────────────
  // addClient
  // ────────────────────────────────────────────────────────────────────────

  describe('addClient', () => {
    it('adds a client to the set', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws);
      expect(WebSocketService.getClientCount()).toBe(1);
    });

    it('stores client info when userInfo is provided', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'editor' });
      expect(WebSocketService.getClientCount()).toBe(1);
      const info = (WebSocketService as any).clientInfo.get(ws);
      expect(info).toMatchObject({
        userId: 'u1',
        username: 'alice',
        role: 'editor',
        projectId: null,
        editingField: null,
      });
    });

    it('rejects client when max connections reached', () => {
      // Fill to MAX (2000) — we'll set the Set size directly
      const bigSet = (WebSocketService as any).clients as Set<any>;
      for (let i = 0; i < 2000; i++) {
        bigSet.add({ id: i });
      }
      const ws = createMockWs();
      WebSocketService.addClient(ws);
      expect(ws.close).toHaveBeenCalledWith(1013, 'Max connections reached');
      expect(logger.warn).toHaveBeenCalledWith('WebSocket max connections reached — rejecting new client');
    });

    it('closes oldest connection when per-user limit exceeded', () => {
      const oldest = createMockWs();
      WebSocketService.addClient(oldest, { userId: 'u1', username: 'alice', role: 'editor' });
      // Add 4 more for same user
      for (let i = 0; i < 4; i++) {
        const ws = createMockWs();
        WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'editor' });
      }
      // Now at 5 connections, next should close oldest
      const newest = createMockWs();
      WebSocketService.addClient(newest, { userId: 'u1', username: 'alice', role: 'editor' });
      expect(oldest.close).toHaveBeenCalledWith(1013, 'Too many connections');
    });

    it('does not enforce per-user limit for different users', () => {
      for (let i = 0; i < 5; i++) {
        const ws = createMockWs();
        WebSocketService.addClient(ws, { userId: `u${i}`, username: `user${i}`, role: 'editor' });
      }
      // Each user has 1 connection — no closures
      expect(WebSocketService.getClientCount()).toBe(5);
    });

    it('removes client on close event and broadcasts presence if in a project', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });

      // Manually set projectId
      const info = (WebSocketService as any).clientInfo.get(ws);
      info.projectId = 'p1';

      // Add another client in same project to receive broadcast
      const ws2 = createMockWs();
      WebSocketService.addClient(ws2, { userId: 'u2', username: 'bob', role: 'admin' });
      const info2 = (WebSocketService as any).clientInfo.get(ws2);
      info2.projectId = 'p1';

      ws.emit('close');

      expect(WebSocketService.getClientCount()).toBe(1);
      expect((WebSocketService as any).clientInfo.has(ws)).toBe(false);
      // ws2 should have received a presence_update broadcast
      expect(ws2.send).toHaveBeenCalled();
      const sent = JSON.parse(ws2.send.mock.calls[0][0]);
      expect(sent.type).toBe('presence_update');
      expect(sent.payload.projectId).toBe('p1');
    });

    it('removes client on error event', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'editor' });
      ws.emit('error', new Error('connection reset'));
      expect(WebSocketService.getClientCount()).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith('WebSocket client error', { error: 'connection reset' });
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Message handling (presence)
  // ────────────────────────────────────────────────────────────────────────

  describe('message handling', () => {
    it('handles presence:join for global roles without membership check', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });

      ws.emit('message', JSON.stringify({ type: 'presence:join', projectId: 'p1' }));

      const info = (WebSocketService as any).clientInfo.get(ws);
      expect(info.projectId).toBe('p1');
      expect(mockHasAccess).not.toHaveBeenCalled();
    });

    it('handles presence:join for executive role without membership check', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'executive' });

      ws.emit('message', JSON.stringify({ type: 'presence:join', projectId: 'p1' }));

      const info = (WebSocketService as any).clientInfo.get(ws);
      expect(info.projectId).toBe('p1');
      expect(mockHasAccess).not.toHaveBeenCalled();
    });

    it('handles presence:join for pmo role without membership check', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'pmo' });

      ws.emit('message', JSON.stringify({ type: 'presence:join', projectId: 'p1' }));

      const info = (WebSocketService as any).clientInfo.get(ws);
      expect(info.projectId).toBe('p1');
      expect(mockHasAccess).not.toHaveBeenCalled();
    });

    it('checks membership for non-global roles on presence:join and allows if authorized', async () => {
      mockHasAccess.mockResolvedValue(true);
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'editor' });

      ws.emit('message', JSON.stringify({ type: 'presence:join', projectId: 'p1' }));
      // Wait for the async hasAccess to resolve
      await vi.waitFor(() => {
        const info = (WebSocketService as any).clientInfo.get(ws);
        expect(info.projectId).toBe('p1');
      });
      expect(mockHasAccess).toHaveBeenCalledWith('p1', 'u1');
    });

    it('sends error and does not join when non-global role is not authorized', async () => {
      mockHasAccess.mockResolvedValue(false);
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'editor' });

      ws.emit('message', JSON.stringify({ type: 'presence:join', projectId: 'p1' }));
      await vi.waitFor(() => {
        expect(ws.send).toHaveBeenCalled();
      });
      const sent = JSON.parse(ws.send.mock.calls[0][0]);
      expect(sent.type).toBe('presence:error');
      expect(sent.message).toBe('Not authorized for this project');
      const info = (WebSocketService as any).clientInfo.get(ws);
      expect(info.projectId).toBeNull();
    });

    it('silently handles hasAccess rejection', async () => {
      mockHasAccess.mockRejectedValue(new Error('db down'));
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'editor' });

      ws.emit('message', JSON.stringify({ type: 'presence:join', projectId: 'p1' }));
      // Give promise time to reject
      await new Promise(r => setTimeout(r, 50));
      const info = (WebSocketService as any).clientInfo.get(ws);
      expect(info.projectId).toBeNull();
    });

    it('handles presence:leave — clears projectId and editingField', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });
      const info = (WebSocketService as any).clientInfo.get(ws);
      info.projectId = 'p1';
      info.editingField = 'title';

      ws.emit('message', JSON.stringify({ type: 'presence:leave' }));

      expect(info.projectId).toBeNull();
      expect(info.editingField).toBeNull();
    });

    it('does nothing on presence:leave when not in a project', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });

      // Should not throw
      ws.emit('message', JSON.stringify({ type: 'presence:leave' }));
      const info = (WebSocketService as any).clientInfo.get(ws);
      expect(info.projectId).toBeNull();
    });

    it('handles presence:editing — sets editingField and broadcasts', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });
      const info = (WebSocketService as any).clientInfo.get(ws);
      info.projectId = 'p1';

      ws.emit('message', JSON.stringify({ type: 'presence:editing', field: 'description' }));

      expect(info.editingField).toBe('description');
      // Should broadcast presence to self (only client in project)
      expect(ws.send).toHaveBeenCalled();
    });

    it('does not set editing if not in a project', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });

      ws.emit('message', JSON.stringify({ type: 'presence:editing', field: 'title' }));

      const info = (WebSocketService as any).clientInfo.get(ws);
      expect(info.editingField).toBeNull();
    });

    it('handles presence:stop_editing — clears editingField', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });
      const info = (WebSocketService as any).clientInfo.get(ws);
      info.projectId = 'p1';
      info.editingField = 'title';

      ws.emit('message', JSON.stringify({ type: 'presence:stop_editing' }));

      expect(info.editingField).toBeNull();
    });

    it('does nothing on stop_editing when not editing', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });
      const info = (WebSocketService as any).clientInfo.get(ws);
      info.projectId = 'p1';
      // editingField is null

      ws.emit('message', JSON.stringify({ type: 'presence:stop_editing' }));
      // Should not broadcast (no editingField change)
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('ignores non-JSON messages gracefully', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });

      // Should not throw
      ws.emit('message', 'not json at all {{{');
      expect(WebSocketService.getClientCount()).toBe(1);
    });

    it('ignores unknown message types', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });

      ws.emit('message', JSON.stringify({ type: 'unknown_type', data: 123 }));
      // No errors, no state changes
      const info = (WebSocketService as any).clientInfo.get(ws);
      expect(info.projectId).toBeNull();
    });

    it('handles Buffer messages', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });

      const buf = Buffer.from(JSON.stringify({ type: 'presence:join', projectId: 'p1' }));
      ws.emit('message', buf);

      const info = (WebSocketService as any).clientInfo.get(ws);
      expect(info.projectId).toBe('p1');
    });

    it('does not apply join when ws has no client info', () => {
      const ws = createMockWs();
      WebSocketService.addClient(ws); // no userInfo

      ws.emit('message', JSON.stringify({ type: 'presence:join', projectId: 'p1' }));
      // No clientInfo for this ws, so nothing should happen
      expect((WebSocketService as any).clientInfo.has(ws)).toBe(false);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // applyJoin (tested indirectly)
  // ────────────────────────────────────────────────────────────────────────

  describe('applyJoin', () => {
    it('broadcasts to old project when switching projects', () => {
      const ws1 = createMockWs();
      WebSocketService.addClient(ws1, { userId: 'u1', username: 'alice', role: 'admin' });
      const info1 = (WebSocketService as any).clientInfo.get(ws1);
      info1.projectId = 'p1';

      // ws2 in p1 to observe old project broadcast
      const ws2 = createMockWs();
      WebSocketService.addClient(ws2, { userId: 'u2', username: 'bob', role: 'admin' });
      const info2 = (WebSocketService as any).clientInfo.get(ws2);
      info2.projectId = 'p1';

      // ws1 joins p2
      ws1.emit('message', JSON.stringify({ type: 'presence:join', projectId: 'p2' }));

      // ws2 should get broadcast about p1 (user left)
      expect(ws2.send).toHaveBeenCalled();
      const sent = JSON.parse(ws2.send.mock.calls[0][0]);
      expect(sent.type).toBe('presence_update');
      expect(sent.payload.projectId).toBe('p1');
      // ws1 is no longer in p1's viewers
      expect(sent.payload.viewers).not.toContainEqual(expect.objectContaining({ userId: 'u1' }));
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // broadcastPresence
  // ────────────────────────────────────────────────────────────────────────

  describe('broadcastPresence', () => {
    it('sends presence with viewers and editors', () => {
      const ws1 = createMockWs();
      WebSocketService.addClient(ws1, { userId: 'u1', username: 'alice', role: 'admin' });
      const info1 = (WebSocketService as any).clientInfo.get(ws1);
      info1.projectId = 'p1';
      info1.editingField = 'title';

      const ws2 = createMockWs();
      WebSocketService.addClient(ws2, { userId: 'u2', username: 'bob', role: 'admin' });
      const info2 = (WebSocketService as any).clientInfo.get(ws2);
      info2.projectId = 'p1';

      WebSocketService.broadcastPresence('p1');

      expect(ws1.send).toHaveBeenCalled();
      const sent = JSON.parse(ws1.send.mock.calls[0][0]);
      expect(sent.type).toBe('presence_update');
      expect(sent.payload.viewers).toHaveLength(2);
      expect(sent.payload.editors).toHaveLength(1);
      expect(sent.payload.editors[0]).toMatchObject({ userId: 'u1', field: 'title' });
    });

    it('does not send to clients in a different project', () => {
      const ws1 = createMockWs();
      WebSocketService.addClient(ws1, { userId: 'u1', username: 'alice', role: 'admin' });
      (WebSocketService as any).clientInfo.get(ws1).projectId = 'p1';

      const ws2 = createMockWs();
      WebSocketService.addClient(ws2, { userId: 'u2', username: 'bob', role: 'admin' });
      (WebSocketService as any).clientInfo.get(ws2).projectId = 'p2';

      WebSocketService.broadcastPresence('p1');

      expect(ws1.send).toHaveBeenCalled();
      expect(ws2.send).not.toHaveBeenCalled();
    });

    it('deduplicates viewers by userId', () => {
      // Same user, two connections, same project
      const ws1 = createMockWs();
      WebSocketService.addClient(ws1, { userId: 'u1', username: 'alice', role: 'admin' });
      (WebSocketService as any).clientInfo.get(ws1).projectId = 'p1';

      const ws2 = createMockWs();
      WebSocketService.addClient(ws2, { userId: 'u1', username: 'alice', role: 'admin' });
      (WebSocketService as any).clientInfo.get(ws2).projectId = 'p1';

      WebSocketService.broadcastPresence('p1');

      const sent = JSON.parse(ws1.send.mock.calls[0][0]);
      expect(sent.payload.viewers).toHaveLength(1);
    });

    it('does not send to clients with non-OPEN readyState', () => {
      const ws = createMockWs(3); // CLOSED
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });
      (WebSocketService as any).clientInfo.get(ws).projectId = 'p1';

      WebSocketService.broadcastPresence('p1');
      expect(ws.send).not.toHaveBeenCalled();
    });

    it('catches send errors gracefully', () => {
      const ws = createMockWs();
      ws.send.mockImplementation(() => { throw new Error('write failed'); });
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });
      (WebSocketService as any).clientInfo.get(ws).projectId = 'p1';

      WebSocketService.broadcastPresence('p1');
      expect(logger.warn).toHaveBeenCalledWith('WebSocket send failed', { error: 'write failed' });
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // broadcast
  // ────────────────────────────────────────────────────────────────────────

  describe('broadcast', () => {
    const testMessage: WSMessage = { type: 'task_updated', payload: { id: 't1' } };

    it('sends to all OPEN clients when no projectId given', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      WebSocketService.addClient(ws1);
      WebSocketService.addClient(ws2);

      WebSocketService.broadcast(testMessage);

      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(testMessage));
      expect(ws2.send).toHaveBeenCalledWith(JSON.stringify(testMessage));
    });

    it('skips non-OPEN clients in global broadcast', () => {
      const wsOpen = createMockWs(WebSocket.OPEN);
      const wsClosed = createMockWs(3);
      WebSocketService.addClient(wsOpen);
      WebSocketService.addClient(wsClosed);

      WebSocketService.broadcast(testMessage);

      expect(wsOpen.send).toHaveBeenCalled();
      expect(wsClosed.send).not.toHaveBeenCalled();
    });

    it('sends only to clients in specific project when projectId given', () => {
      const ws1 = createMockWs();
      WebSocketService.addClient(ws1, { userId: 'u1', username: 'alice', role: 'admin' });
      (WebSocketService as any).clientInfo.get(ws1).projectId = 'p1';

      const ws2 = createMockWs();
      WebSocketService.addClient(ws2, { userId: 'u2', username: 'bob', role: 'admin' });
      (WebSocketService as any).clientInfo.get(ws2).projectId = 'p2';

      WebSocketService.broadcast(testMessage, 'p1');

      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(testMessage));
      expect(ws2.send).not.toHaveBeenCalled();
    });

    it('catches send errors in scoped broadcast', () => {
      const ws = createMockWs();
      ws.send.mockImplementation(() => { throw new Error('broken pipe'); });
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });
      (WebSocketService as any).clientInfo.get(ws).projectId = 'p1';

      WebSocketService.broadcast(testMessage, 'p1');
      expect(logger.warn).toHaveBeenCalledWith('WebSocket broadcast send failed', { error: 'broken pipe' });
    });

    it('catches send errors in global broadcast', () => {
      const ws = createMockWs();
      ws.send.mockImplementation(() => { throw new Error('broken pipe'); });
      WebSocketService.addClient(ws);

      WebSocketService.broadcast(testMessage);
      expect(logger.warn).toHaveBeenCalledWith('WebSocket broadcast send failed', { error: 'broken pipe' });
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // sendToUser
  // ────────────────────────────────────────────────────────────────────────

  describe('sendToUser', () => {
    const msg: WSMessage = { type: 'notification', payload: { text: 'hello' } };

    it('sends to all connections of a given user', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      WebSocketService.addClient(ws1, { userId: 'u1', username: 'alice', role: 'admin' });
      WebSocketService.addClient(ws2, { userId: 'u1', username: 'alice', role: 'admin' });

      WebSocketService.sendToUser('u1', msg);

      expect(ws1.send).toHaveBeenCalledWith(JSON.stringify(msg));
      expect(ws2.send).toHaveBeenCalledWith(JSON.stringify(msg));
    });

    it('does not send to other users', () => {
      const ws1 = createMockWs();
      const ws2 = createMockWs();
      WebSocketService.addClient(ws1, { userId: 'u1', username: 'alice', role: 'admin' });
      WebSocketService.addClient(ws2, { userId: 'u2', username: 'bob', role: 'admin' });

      WebSocketService.sendToUser('u1', msg);

      expect(ws1.send).toHaveBeenCalled();
      expect(ws2.send).not.toHaveBeenCalled();
    });

    it('skips non-OPEN connections', () => {
      const ws = createMockWs(3);
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });

      WebSocketService.sendToUser('u1', msg);

      expect(ws.send).not.toHaveBeenCalled();
    });

    it('catches send errors gracefully', () => {
      const ws = createMockWs();
      ws.send.mockImplementation(() => { throw new Error('send failed'); });
      WebSocketService.addClient(ws, { userId: 'u1', username: 'alice', role: 'admin' });

      WebSocketService.sendToUser('u1', msg);
      expect(logger.warn).toHaveBeenCalledWith('WebSocket sendToUser failed', { error: 'send failed' });
    });

    it('does nothing when user has no connections', () => {
      WebSocketService.sendToUser('nonexistent', msg);
      // No error, no sends
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // getClientCount
  // ────────────────────────────────────────────────────────────────────────

  describe('getClientCount', () => {
    it('returns 0 when no clients', () => {
      expect(WebSocketService.getClientCount()).toBe(0);
    });

    it('returns correct count', () => {
      WebSocketService.addClient(createMockWs());
      WebSocketService.addClient(createMockWs());
      WebSocketService.addClient(createMockWs());
      expect(WebSocketService.getClientCount()).toBe(3);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // startPingInterval
  // ────────────────────────────────────────────────────────────────────────

  describe('startPingInterval', () => {
    it('does not start a second timer if already running', () => {
      vi.useFakeTimers();
      WebSocketService.startPingInterval();
      const timer1 = (WebSocketService as any).pingTimer;
      WebSocketService.startPingInterval();
      const timer2 = (WebSocketService as any).pingTimer;
      expect(timer1).toBe(timer2);
      vi.useRealTimers();
      resetService();
    });

    it('pings open clients on interval', () => {
      vi.useFakeTimers();
      const ws = createMockWs();
      WebSocketService.addClient(ws);
      WebSocketService.startPingInterval();

      vi.advanceTimersByTime(30_000);
      expect(ws.ping).toHaveBeenCalled();

      vi.useRealTimers();
      resetService();
    });

    it('terminates client that does not respond with pong', () => {
      vi.useFakeTimers();
      const ws = createMockWs();
      WebSocketService.addClient(ws);
      WebSocketService.startPingInterval();

      vi.advanceTimersByTime(30_000); // triggers ping
      // __pongReceived is set to false, simulate no pong response
      vi.advanceTimersByTime(10_000); // pong timeout
      expect(ws.terminate).toHaveBeenCalled();

      vi.useRealTimers();
      resetService();
    });

    it('does not terminate client that responds with pong', () => {
      vi.useFakeTimers();
      const ws = createMockWs();
      WebSocketService.addClient(ws);
      WebSocketService.startPingInterval();

      vi.advanceTimersByTime(30_000); // triggers ping
      // Simulate pong received
      ws.emit('pong');
      vi.advanceTimersByTime(10_000); // pong timeout
      expect(ws.terminate).not.toHaveBeenCalled();

      vi.useRealTimers();
      resetService();
    });

    it('skips non-OPEN clients during ping', () => {
      vi.useFakeTimers();
      const ws = createMockWs(3); // CLOSED
      WebSocketService.addClient(ws);
      WebSocketService.startPingInterval();

      vi.advanceTimersByTime(30_000);
      expect(ws.ping).not.toHaveBeenCalled();

      vi.useRealTimers();
      resetService();
    });
  });
});
