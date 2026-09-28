import { FastifyRequest, FastifyReply } from 'fastify';
import { organizationRepository } from '../database/OrganizationRepository';
import { config } from '../config';
import { organizationService } from '../services/OrganizationService';
import { getRequestContext } from './requestContext';
import { repairTenantDatabase } from '../database/tenantProvisioner';
import logger from '../utils/logger';

// Routes that operate on the control plane DB, not tenant DBs
const TENANT_EXEMPT_PREFIXES = [
  '/api/v1/auth',
  '/api/v1/stripe',
  '/api/v1/admin',
  '/api/v1/org',
  '/api/v1/waitlist',
  '/health',
  '/documentation',
  '/mcp',
];

export async function tenantResolverHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!config.MULTI_TENANT_ENABLED) return;

  // Skip non-API routes and exempt paths
  if (!request.url.startsWith('/api/') && !request.url.startsWith('/mcp')) return;
  for (const prefix of TENANT_EXEMPT_PREFIXES) {
    if (request.url.startsWith(prefix)) return;
  }

  // No user = no tenant context (authMiddleware will handle 401)
  if (!request.user?.userId) return;

  let org = await organizationService.findByUserId(request.user.userId);
  // The cached copy can predate the organisation's database: it's cached at sign-up, and the
  // database is only built once the email is confirmed. Believe the database, not the cache —
  // otherwise a brand-new customer saw "still being set up" on every screen for 5 minutes.
  if (org && !org.isProvisioned) {
    const fresh = await organizationRepository.findByUserId(request.user.userId);
    if (fresh?.isProvisioned) {
      organizationService.invalidateUserCache(request.user.userId);
      org = fresh;
    }
  }
  if (!org) {
    // User has no organization — fall through to main DB (supports legacy/unassigned users)
    return;
  }

  if (!org.isActive) {
    return reply.status(403).send({
      error: 'Organization inactive',
      message: 'Your organization has been deactivated.',
    });
  }

  if (!org.isProvisioned) {
    // Attempt auto-repair instead of just returning 503
    logger.warn(`[tenantResolver] Org ${org.slug} not provisioned — attempting auto-repair`);
    const repaired = await repairTenantDatabase(org.id);
    if (!repaired) {
      return reply.status(503).send({
        error: 'Organization provisioning',
        message: 'Your organization is still being set up. Please try again in a moment.',
      });
    }
    // Refresh org data after repair
    const refreshedOrg = await organizationService.findByUserId(request.user.userId);
    if (!refreshedOrg || !refreshedOrg.isProvisioned) {
      return reply.status(503).send({
        error: 'Organization provisioning',
        message: 'Your organization is still being set up. Please try again in a moment.',
      });
    }
  }

  // Set tenant context on request for route handlers
  request.tenantOrg = {
    id: org.id,
    slug: org.slug,
    dbName: org.dbName,
  };

  // Set tenant context in AsyncLocalStorage for databaseService
  const ctx = getRequestContext();
  if (ctx) {
    ctx.tenantDbName = org.dbName;
    ctx.organizationId = org.id;
  }
}
