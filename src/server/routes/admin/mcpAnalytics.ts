import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { databaseService } from '../../database/connection';

import { isPlatformAdmin } from '../../utils/platformAdmin';
function requireAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user!;
  if (!isPlatformAdmin(user)) {
    reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' });
    return false;
  }
  return true;
}

interface AnalyticsQuery {
  since?: string;
  until?: string;
  groupBy?: 'tool' | 'user' | 'day';
}

export async function mcpAnalyticsRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /api/v1/admin/mcp-analytics
  fastify.get('/', async (request: FastifyRequest<{ Querystring: AnalyticsQuery }>, reply: FastifyReply) => {
    if (!requireAdmin(request, reply)) return reply;

    try {
      const { since, until, groupBy = 'tool' } = request.query;

      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (since) {
        conditions.push('created_at >= ?');
        params.push(since);
      }
      if (until) {
        conditions.push('created_at <= ?');
        params.push(until);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      // Totals
      const totalsRows = await databaseService.queryControlPlane<{
        total_invocations: number;
        success_count: number;
        avg_duration_ms: number;
      }>(
        `SELECT
          COUNT(*) AS total_invocations,
          SUM(is_success) AS success_count,
          ROUND(AVG(duration_ms), 1) AS avg_duration_ms
         FROM mcp_tool_invocations ${whereClause}`,
        params,
      );

      const totals = totalsRows[0] || { total_invocations: 0, success_count: 0, avg_duration_ms: 0 };
      const totalInvocations = Number(totals.total_invocations);
      const successRate = totalInvocations > 0 ? Number(totals.success_count) / totalInvocations : 0;
      const avgDurationMs = Number(totals.avg_duration_ms) || 0;

      // Breakdown by groupBy
      let groupColumn: string;
      let groupAlias: string;
      switch (groupBy) {
        case 'user':
          groupColumn = 'user_id';
          groupAlias = 'userId';
          break;
        case 'day':
          groupColumn = 'DATE(created_at)';
          groupAlias = 'date';
          break;
        default:
          groupColumn = 'tool_name';
          groupAlias = 'toolName';
      }

      const breakdownRows = await databaseService.queryControlPlane<{
        group_key: string;
        invocations: number;
        successes: number;
        avg_ms: number;
      }>(
        `SELECT
          ${groupColumn} AS group_key,
          COUNT(*) AS invocations,
          SUM(is_success) AS successes,
          ROUND(AVG(duration_ms), 1) AS avg_ms
         FROM mcp_tool_invocations ${whereClause}
         GROUP BY ${groupColumn}
         ORDER BY invocations DESC
         LIMIT 100`,
        params,
      );

      const breakdown = breakdownRows.map(row => ({
        [groupAlias]: row.group_key,
        invocations: Number(row.invocations),
        successRate: Number(row.invocations) > 0 ? Number(row.successes) / Number(row.invocations) : 0,
        avgDurationMs: Number(row.avg_ms) || 0,
      }));

      return {
        totalInvocations,
        successRate,
        avgDurationMs,
        groupBy,
        breakdown,
      };
    } catch (error) {
      fastify.log.error(error);
      return reply.status(500).send({ error: 'Internal server error' });
    }
  });
}
