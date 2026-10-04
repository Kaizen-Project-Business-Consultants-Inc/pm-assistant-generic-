import { FastifyRequest, FastifyReply } from 'fastify';
import { isPlatformAdmin } from '../utils/platformAdmin';
import { organizationRepository } from '../database/OrganizationRepository';
import { config } from '../config';
import { organizationService } from '../services/OrganizationService';
import { getRequestContext } from './requestContext';
import { repairTenantDatabase } from '../database/tenantProvisioner';
import logger from '../utils/logger';
import { supportSessionService, SUPPORT_COOKIE } from '../services/SupportSessionService';

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

/**
 * Things that belong to a PERSON, not a company, stored in the shared database: profile and
 * preferences, notifications, feedback, plan prices, the live-update socket. An account with
 * no company (the platform admin) may use these; everything else is company data.
 */
export const PERSONAL_PREFIXES = [
  '/api/v1/users',
  '/api/v1/notifications',
  '/api/v1/feedback',
  '/api/v1/pricing',
  '/api/v1/ws',
  '/api/v1/ai/budget',
];

export const NO_COMPANY_MESSAGE = {
  admin: 'This is the platform admin account, which has no company of its own. Use the admin pages, or sign in to a company account for project work.',
  other: "Your account isn't part of a company yet, so there's nothing to show here. Ask your company's admin to invite you, or contact support.",
};

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

  // Support view: the platform admin's read-only, recorded visit into one company.
  // This hook runs before the route's authMiddleware, so whether the user has a company isn't
  // known yet — look it up (cached) for anyone with the admin role.
  if (request.user.role === 'admin' && request.user.hasCompany === undefined) {
    request.user.hasCompany = !!(await organizationService.findByUserId(request.user.userId));
  }
  if (isPlatformAdmin(request.user)) {
    const visitId = (request.cookies as Record<string, string | undefined> | undefined)?.[SUPPORT_COOKIE];
    const visit = visitId ? await supportSessionService.findActive(visitId, request.user.userId) : null;
    if (visit) {
      request.supportSession = { id: visit.id, organizationId: visit.organizationId, organizationName: visit.organizationName, expiresAt: visit.expiresAt };
      // The admin's own profile, notifications etc. stay the admin's own
      if (PERSONAL_PREFIXES.some(p => request.url.startsWith(p))) return;
      // The admin never changes customer data
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
        return reply.status(403).send({ error: 'support_read_only', message: 'Support view is read-only — nothing can be changed.' });
      }
      request.tenantOrg = { id: visit.organizationId, slug: visit.organizationSlug, dbName: visit.dbName };
      const vctx = getRequestContext();
      if (vctx) {
        vctx.tenantDbName = visit.dbName;
        vctx.organizationId = visit.organizationId;
      }
      return;
    }
  }

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
    // No company. Company data must never be read from or written to the shared database
    // (it used to fall through to it: the platform admin's chats and audit entries landed
    // there, invisible to everyone — found 2026-09-30). Personal features still work.
    if (PERSONAL_PREFIXES.some(p => request.url.startsWith(p))) return;
    return reply.status(403).send({
      error: 'no_company',
      message: request.user.role === 'admin' ? NO_COMPANY_MESSAGE.admin : NO_COMPANY_MESSAGE.other,
    });
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
