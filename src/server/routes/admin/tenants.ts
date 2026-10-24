import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { keyChangesNeed } from '../../middleware/requireScope';
import { databaseService } from '../../database/connection';
import { organizationRepository } from '../../database/OrganizationRepository';
import { organizationService } from '../../services/OrganizationService';
import { auditLedgerService } from '../../services/AuditLedgerService';
import logger from '../../utils/logger';
import { provisionTenantDatabase } from '../../database/tenantProvisioner';
import { runTenantMigrations } from '../../database/tenantMigrationRunner';

import { isPlatformAdmin } from '../../utils/platformAdmin';
import { neverConfirmedSql } from '../../constants/neverConfirmed';
function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user!;
  if (!isPlatformAdmin(user)) {
    reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    return false;
  }
  return true;
}

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
  maxUsers: z.number().int().min(1).max(10000).optional(),
  subscriptionTier: z.enum(['trial', 'consultant_basic', 'consultant_pro', 'sme', 'enterprise']).optional(),
  subscriptionStatus: z.enum(['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'none']).optional(),
  trialEndsAt: z.string().nullable().optional(),
  // The company's own monthly AI tokens (C1); null puts it back to the plan default. Per-seat companies only.
  aiAllowanceOverride: z.number().int().min(0).max(10_000_000_000).nullable().optional(),
});

export async function tenantAdminRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // A key that only reads can't change admin screens (2026-10-09 audit M2)
  fastify.addHook('preHandler', keyChangesNeed('admin'));

  // GET /api/v1/admin/tenants
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    try {
      const rows = await databaseService.queryControlPlane(
        `SELECT o.*,
          u.full_name AS owner_name, u.email AS owner_email,
          (SELECT full_name FROM users WHERE id = o.ai_allowance_override_by) AS ai_allowance_override_by_name,
          ${neverConfirmedSql('u')} AS never_confirmed,
          (SELECT COUNT(*) FROM users WHERE organization_id = o.id) AS user_count
        FROM organizations o
        LEFT JOIN users u ON u.id = o.owner_user_id
        ORDER BY o.created_at DESC`
      );
      return { tenants: rows };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/admin/tenants/:id
  fastify.get('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { id } = request.params as { id: string };
    try {
      const org = await organizationRepository.findById(id);
      if (!org) {
        return reply.status(404).send({ error: 'Not found', message: 'Organization not found' });
      }

      const [ownerRows] = await Promise.all([
        databaseService.queryControlPlane(
          'SELECT full_name, email FROM users WHERE id = ?',
          [org.ownerUserId],
        ),
      ]);
      const userCount = await organizationRepository.countUsers(id);

      let tableCount: number | null = null;
      if (org.isProvisioned) {
        try {
          const tables = await databaseService.queryControlPlane(
            `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = ?`,
            [org.dbName],
          );
          tableCount = Number(tables[0].cnt);
        } catch {
          // DB may not exist yet
        }
      }

      return {
        tenant: {
          ...org,
          owner: ownerRows[0] ?? null,
          userCount,
          tableCount,
        },
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // PATCH /api/v1/admin/tenants/:id
  fastify.patch('/:id', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { id } = request.params as { id: string };

    const result = updateSchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({ error: 'Bad request', message: result.error.issues });
    }

    try {
      const org = await organizationRepository.findById(id);
      if (!org) {
        return reply.status(404).send({ error: 'Not found', message: 'Organization not found' });
      }

      // Only a per-seat company shares one pool; anyone else's allowance is each person's own (Admin → Users)
      const changesAllowance = 'aiAllowanceOverride' in result.data;
      if (changesAllowance && result.data.aiAllowanceOverride != null && org.billingModel !== 'per_seat') {
        return reply.status(400).send({ error: 'Bad request', message: 'Only a per-seat company shares one AI allowance. For this company, set each person\'s allowance on the Users screen.' });
      }

      await organizationRepository.update(id, {
        ...result.data,
        // who changed the allowance and when, kept on the company (also when it is put back to the plan default)
        ...(changesAllowance ? { aiAllowanceOverrideBy: request.user!.userId, aiAllowanceOverrideAt: new Date().toISOString().slice(0, 19).replace('T', ' ') } : {}),
      });

      // Invalidate cached user→org lookups for all users in this org
      const users = await databaseService.queryControlPlane(
        'SELECT id FROM users WHERE organization_id = ?',
        [id],
      );
      for (const u of users) {
        organizationService.invalidateUserCache(u.id);
      }

      // What a paying customer may use changed: the old and new number go in the ledger (the company only keeps the last change)
      if (changesAllowance) {
        auditLedgerService.append({
          actorId: request.user!.userId,
          actorType: 'user',
          action: 'org.ai_allowance.set',
          entityType: 'organization',
          entityId: id,
          payload: { from: org.aiAllowanceOverride, to: result.data.aiAllowanceOverride ?? null },
          source: 'web',
        }).catch(err => logger.error('Failed to record the AI allowance change in the audit ledger', { orgId: id, error: err instanceof Error ? err.message : String(err) }));
      }

      const updated = await organizationRepository.findById(id);
      return { tenant: updated };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // POST /api/v1/admin/tenants/:id/provision
  fastify.post('/:id/provision', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { id } = request.params as { id: string };

    try {
      const org = await organizationRepository.findById(id);
      if (!org) {
        return reply.status(404).send({ error: 'Not found', message: 'Organization not found' });
      }
      if (org.isProvisioned) {
        return reply.status(400).send({ error: 'Bad request', message: 'Organization is already provisioned' });
      }

      await provisionTenantDatabase(id);
      return { message: 'Tenant database provisioned successfully' };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Provisioning failed', message: String(error) });
    }
  });

  // POST /api/v1/admin/tenants/:id/run-migrations
  fastify.post('/:id/run-migrations', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;
    const { id } = request.params as { id: string };

    try {
      const org = await organizationRepository.findById(id);
      if (!org) {
        return reply.status(404).send({ error: 'Not found', message: 'Organization not found' });
      }
      if (!org.isProvisioned) {
        return reply.status(400).send({ error: 'Bad request', message: 'Organization database is not provisioned yet' });
      }

      const count = await runTenantMigrations(org.dbName);
      return { message: `${count} migration(s) applied`, migrationsApplied: count };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Migration failed', message: String(error) });
    }
  });
}
