import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { auditLedgerService } from '../../services/AuditLedgerService';
import { authMiddleware } from '../../middleware/auth';
import { requireScope, keyChangesNeed } from '../../middleware/requireScope';
import { requireProjectAccess, checkProjectRoleFor } from '../../middleware/requireProjectAccess';
import { rateLimiter } from '../../middleware/rateLimiter';
import logger from '../../utils/logger';
import { clampPagination } from '../../schemas/paginationSchema';

/** Who may verify the whole company's audit chain (the company owner works as PMO) */
const VERIFY_ALL_ROLES = ['pmo'];

export async function auditTrailRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);
  // A key that only reads can't change admin screens (2026-10-09 audit M2)
  fastify.addHook('preHandler', keyChangesNeed('admin'));

  // GET /api/v1/audit/verify — chain integrity check
  fastify.get('/verify', {
    preHandler: [requireScope('read')],
    schema: { description: 'Verify audit ledger chain integrity', tags: ['audit'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId, since } = request.query as { projectId?: string; since?: string };
      // Who may ask (2026-10-08): one project's count — anyone who can open that project; the
      // whole company's chain (reads every entry) — PMO / owner only, and rate-limited
      if (projectId) {
        const access = await checkProjectRoleFor(request.user!, projectId, 'viewer');
        if (!access.ok) return reply.status(access.status).send(access.body);
      } else if (!VERIFY_ALL_ROLES.includes(request.user!.role)) {
        return reply.status(403).send({ error: 'Forbidden', message: "Only the company's PMO or owner can check the whole audit history." });
      } else {
        // one project's check is a single indexed count; only the whole-chain walk is limited
        const rl = rateLimiter.check(`audit:verify:${request.user!.userId}`, 10, 10 * 60_000);
        if (!rl.allowed) {
          return reply.status(429).send({ error: 'Too many requests', message: 'The audit check was run many times just now — try again in a few minutes.' });
        }
      }
      const result = await auditLedgerService.verifyChain(projectId, since);
      return result;
    } catch (error) {
      logger.error('Verify audit chain error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/audit/:projectId — paginated, filterable audit log
  fastify.get('/:projectId', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Get audit trail for a project', tags: ['audit'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const {
        limit = '50',
        offset = '0',
        action,
        entityType,
        actorId,
        since,
        until,
      } = request.query as {
        limit?: string;
        offset?: string;
        action?: string;
        entityType?: string;
        actorId?: string;
        since?: string;
        until?: string;
      };

      // text or negative values fall back to the defaults instead of reaching SQL (2026-10-07)
      const page = clampPagination({ limit, offset }, { defaultLimit: 50, maxLimit: 500 });
      const result = await auditLedgerService.getEntries({
        projectId,
        action,
        entityType,
        actorId,
        since,
        until,
        limit: page.limit,
        offset: page.offset,
      });

      return {
        entries: result.entries,
        total: result.total,
        limit: page.limit,
        offset: page.offset,
      };
    } catch (error) {
      logger.error('Get audit trail error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });

  // GET /api/v1/audit/:projectId/compliance-export — downloadable audit report
  fastify.get('/:projectId/compliance-export', {
    preHandler: [requireScope('read'), requireProjectAccess('viewer')],
    schema: { description: 'Export compliance audit report', tags: ['audit'] },
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { projectId } = request.params as { projectId: string };
      const {
        format = 'csv',
        from,
        to,
        actions,
      } = request.query as {
        format?: 'csv' | 'pdf';
        from?: string;
        to?: string;
        actions?: string;
      };

      const rl = rateLimiter.check(`audit:export:${request.user!.userId}`, 10, 10 * 60_000);
      if (!rl.allowed) {
        return reply.status(429).send({ error: 'Too many requests', message: 'Several exports were made just now — try again in a few minutes.' });
      }

      // Get chain verification status
      const chainStatus = await auditLedgerService.verifyChain(projectId);

      // Get all matching entries (no pagination for export)
      const result = await auditLedgerService.getEntries({
        projectId,
        action: actions,
        since: from,
        until: to,
        limit: 10000,
        offset: 0,
      });

      if (format === 'csv') {
        const lines: string[] = [];
        lines.push('"Compliance Audit Report"');
        lines.push(`"Project ID","${projectId}"`);
        lines.push(`"Generated","${new Date().toISOString()}"`);
        lines.push(`"Chain Integrity","${chainStatus.valid ? 'VERIFIED' : 'BROKEN'}"`);
        lines.push(`"Entries Checked","${chainStatus.checkedCount}"`);
        lines.push('');
        lines.push('"Timestamp","Action","Actor ID","Actor Type","Entity Type","Entity ID","Source"');

        for (const entry of result.entries) {
          lines.push([
            `"${entry.createdAt}"`,
            `"${entry.action}"`,
            `"${entry.actorId}"`,
            `"${entry.actorType}"`,
            `"${entry.entityType}"`,
            `"${entry.entityId}"`,
            `"${entry.source}"`,
          ].join(','));
        }

        return reply
          .header('Content-Type', 'text/csv')
          .header('Content-Disposition', `attachment; filename="audit-${projectId}-${new Date().toISOString().slice(0, 10)}.csv"`)
          .send(lines.join('\n'));
      }

      // JSON/PDF format — return structured data for client-side rendering
      return {
        projectId,
        generatedAt: new Date().toISOString(),
        chainIntegrity: chainStatus,
        totalEntries: result.total,
        entries: result.entries,
        filters: { from, to, actions },
      };
    } catch (error) {
      logger.error('Compliance export error', { error });
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
