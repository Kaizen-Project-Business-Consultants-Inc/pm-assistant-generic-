import { AsyncLocalStorage } from 'async_hooks';
import { FastifyRequest, FastifyReply } from 'fastify';

export interface RequestContext {
  requestId: string;
  userId?: string;
  startTime: number;
  tenantDbName?: string;
  organizationId?: string;
  /** 'mcp' for any Bearer/API-key-authenticated request, 'web' otherwise. */
  actorSource?: 'web' | 'mcp';
}

const asyncLocalStorage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return asyncLocalStorage.getStore();
}

export function getRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}

export function getTenantContext(): { dbName: string; orgId: string } | undefined {
  const ctx = asyncLocalStorage.getStore();
  if (ctx?.tenantDbName && ctx?.organizationId) {
    return { dbName: ctx.tenantDbName, orgId: ctx.organizationId };
  }
  return undefined;
}

/**
 * Whether the current request came through the MCP connector / an API key,
 * vs. the web app's own JWT-cookie session. Used to give audit log entries an
 * honest `source` instead of every action reading as "web" regardless of who
 * actually did it.
 */
export function getActorSource(): 'web' | 'mcp' {
  return asyncLocalStorage.getStore()?.actorSource ?? 'web';
}

export function runWithTenantContext<T>(
  dbName: string,
  orgId: string,
  callback: () => T | Promise<T>,
): Promise<T> {
  const context: RequestContext = {
    requestId: `tenant-${orgId}-${Date.now()}`,
    startTime: Date.now(),
    tenantDbName: dbName,
    organizationId: orgId,
  };
  return asyncLocalStorage.run(context, async () => callback());
}

export { asyncLocalStorage };

export async function requestContextHook(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const requestId = (request.headers['x-request-id'] as string) || `req-${crypto.randomUUID()}`;
  const userId = request.user?.userId;

  const context: RequestContext = {
    requestId,
    userId,
    startTime: Date.now(),
    // The global "API key resolution" onRequest hook in plugins.ts runs before
    // this preHandler hook regardless of registration order (onRequest always
    // precedes preHandler in Fastify's lifecycle), so apiKeyId is reliably set
    // here for any MCP/Bearer-authenticated request.
    actorSource: request.apiKeyId ? 'mcp' : 'web',
  };

  // Enter the async local storage context for the rest of the request lifecycle
  asyncLocalStorage.enterWith(context);
}
