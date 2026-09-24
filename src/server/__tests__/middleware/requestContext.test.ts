import { describe, it, expect, vi } from 'vitest';
import { getRequestId, getRequestContext, requestContextHook, getActorSource } from '../../middleware/requestContext';

describe('requestContext', () => {
  it('returns undefined when no context set', () => {
    expect(getRequestId()).toBeUndefined();
    expect(getRequestContext()).toBeUndefined();
  });

  it('sets and retrieves request context via hook', async () => {
    const mockRequest = {
      headers: { 'x-request-id': 'req-test-123' },
      user: { userId: 'u1', username: 'test', role: 'team_member' as const },
    } as any;
    const mockReply = {} as any;

    await requestContextHook(mockRequest, mockReply);

    const ctx = getRequestContext();
    expect(ctx).toBeDefined();
    expect(ctx!.requestId).toBe('req-test-123');
    expect(ctx!.userId).toBe('u1');
    expect(ctx!.startTime).toBeGreaterThan(0);

    expect(getRequestId()).toBe('req-test-123');
  });

  it('generates requestId when header not present', async () => {
    const mockRequest = {
      headers: {},
      user: undefined,
    } as any;
    const mockReply = {} as any;

    await requestContextHook(mockRequest, mockReply);

    const ctx = getRequestContext();
    expect(ctx).toBeDefined();
    expect(ctx!.requestId).toMatch(/^req-/);
    expect(ctx!.userId).toBeUndefined();
  });

  describe('getActorSource', () => {
    // Regression coverage for: every audit log entry hardcoded source: 'web',
    // so there was no way to tell an MCP/API-key action from one made in the
    // web app. actorSource is derived from request.apiKeyId, which the global
    // API-key resolution onRequest hook in plugins.ts sets before this
    // preHandler hook runs (onRequest always precedes preHandler).
    it('reports "mcp" when the request carried an apiKeyId', async () => {
      const mockRequest = { headers: {}, user: { userId: 'u1' }, apiKeyId: 'key-1' } as any;
      await requestContextHook(mockRequest, {} as any);
      expect(getActorSource()).toBe('mcp');
    });

    it('reports "web" when there was no apiKeyId', async () => {
      const mockRequest = { headers: {}, user: { userId: 'u1' } } as any;
      await requestContextHook(mockRequest, {} as any);
      expect(getActorSource()).toBe('web');
    });
  });
});
