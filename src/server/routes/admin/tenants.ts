import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { databaseService } from '../../database/connection';
import { organizationRepository } from '../../database/OrganizationRepository';
import { organizationService } from '../../services/OrganizationService';
import { provisionTenantDatabase } from '../../database/tenantProvisioner';
import { runTenantMigrations } from '../../database/tenantMigrationRunner';

function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = request.user!;
  if (!user || user.role !== 'admin') {
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
});

export async function tenantAdminRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/admin/tenants
  fastify.get('/', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return;
    try {
      const rows = await databaseService.queryControlPlane(
        `SELECT o.*,
          u.full_name AS owner_name, u.email AS owner_email,
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
    if (!requireAdmin(request, reply)) return;
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
    if (!requireAdmin(request, reply)) return;
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

      await organizationRepository.update(id, result.data);

      // Invalidate cached user→org lookups for all users in this org
      const users = await databaseService.queryControlPlane(
        'SELECT id FROM users WHERE organization_id = ?',
        [id],
      );
      for (const u of users) {
        organizationService.invalidateUserCache(u.id);
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
    if (!requireAdmin(request, reply)) return;
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
    if (!requireAdmin(request, reply)) return;
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
