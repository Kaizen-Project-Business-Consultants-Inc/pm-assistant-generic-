import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { databaseService } from '../../database/connection';

const globalRoles = ['admin', 'executive', 'pmo'];

function isGlobalScope(userRole: string, scope?: string): boolean {
  return globalRoles.includes(userRole) || scope === 'portfolio';
}

export async function dashboardDataRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  // GET /overdue-tasks
  fastify.get('/overdue-tasks', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { scope } = request.query as { scope?: string };
    const global = isGlobalScope(user.role, scope);

    const where = global
      ? `t.status NOT IN ('completed','done','cancelled') AND t.end_date < NOW()`
      : `t.status NOT IN ('completed','done','cancelled') AND t.end_date < NOW() AND p.created_by = ?`;
    const params = global ? [] : [user.userId];

    const rows = await databaseService.query<any>(
      `SELECT t.id, t.name, s.project_id AS projectId, p.name AS projectName,
              t.assigned_to AS assignedTo, t.end_date AS dueDate, t.priority,
              DATEDIFF(NOW(), t.end_date) AS overdueDays
       FROM tasks t
       JOIN schedules s ON t.schedule_id = s.id
       JOIN projects p ON s.project_id = p.id
       WHERE ${where}
       ORDER BY overdueDays DESC
       LIMIT 50`,
      params
    );

    return { tasks: rows };
  });

  // GET /issues-trend
  fastify.get('/issues-trend', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { scope, weeks: weeksParam } = request.query as { scope?: string; weeks?: string };
    const global = isGlobalScope(user.role, scope);
    const numWeeks = Math.min(Math.max(parseInt(weeksParam || '8', 10) || 8, 1), 52);

    const scopeFilter = global ? '' : 'AND p.created_by = ?';
    const params = global ? [] : [user.userId];

    // Use YEARWEEK as stable key for matching
    const createdRows = await databaseService.query<any>(
      `SELECT YEARWEEK(t.created_at, 1) AS yw, COUNT(*) AS cnt
       FROM tasks t
       JOIN schedules s ON t.schedule_id = s.id
       JOIN projects p ON s.project_id = p.id
       WHERE t.created_at >= DATE_SUB(CURDATE(), INTERVAL ? WEEK) ${scopeFilter}
       GROUP BY yw`,
      [numWeeks, ...params]
    );

    const resolvedRows = await databaseService.query<any>(
      `SELECT YEARWEEK(t.updated_at, 1) AS yw, COUNT(*) AS cnt
       FROM tasks t
       JOIN schedules s ON t.schedule_id = s.id
       JOIN projects p ON s.project_id = p.id
       WHERE t.status IN ('completed','done')
         AND t.updated_at >= DATE_SUB(CURDATE(), INTERVAL ? WEEK) ${scopeFilter}
       GROUP BY yw`,
      [numWeeks, ...params]
    );

    const createdMap = new Map(createdRows.map((r: any) => [Number(r.yw), Number(r.cnt)]));
    const resolvedMap = new Map(resolvedRows.map((r: any) => [Number(r.yw), Number(r.cnt)]));

    // Generate all week buckets so the chart has no gaps
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const weekList = [];
    for (let i = numWeeks - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i * 7);
      // Move to Monday of that week
      const day = d.getDay();
      const diff = day === 0 ? -6 : 1 - day;
      d.setDate(d.getDate() + diff);

      // Compute YEARWEEK the same way MySQL does (mode 1: Monday start)
      const jan1 = new Date(d.getFullYear(), 0, 1);
      const jan1Day = jan1.getDay() === 0 ? 7 : jan1.getDay();
      const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000) + 1;
      const weekNum = Math.floor((dayOfYear + jan1Day - 2) / 7) + 1;
      const yw = d.getFullYear() * 100 + weekNum;

      const label = `${months[d.getMonth()]} ${d.getDate()}`;
      weekList.push({
        week: label,
        created: createdMap.get(yw) || 0,
        resolved: resolvedMap.get(yw) || 0,
      });
    }

    return { weeks: weekList };
  });

  // GET /milestones
  fastify.get('/milestones', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { scope, limit: limitParam } = request.query as { scope?: string; limit?: string };
    const global = isGlobalScope(user.role, scope);
    const limit = Math.min(Math.max(parseInt(limitParam || '10', 10) || 10, 1), 50);

    const scopeFilter = global ? '' : 'AND p.created_by = ?';
    const params = global ? [limit] : [user.userId, limit];

    const rows = await databaseService.query<any>(
      `SELECT t.id, t.name, s.project_id AS projectId, p.name AS projectName,
              t.end_date AS endDate,
              DATEDIFF(t.end_date, CURDATE()) AS daysUntil
       FROM tasks t
       JOIN schedules s ON t.schedule_id = s.id
       JOIN projects p ON s.project_id = p.id
       WHERE t.is_milestone = 1
         AND t.status NOT IN ('completed','done','cancelled')
         AND t.end_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
         ${scopeFilter}
       ORDER BY t.end_date ASC
       LIMIT ?`,
      params
    );

    return { milestones: rows };
  });

  // GET /cr-summary — change request summary across user's projects
  fastify.get('/cr-summary', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    const user = request.user!;
    if (!user?.userId) return reply.status(401).send({ error: 'Unauthorized' });

    const { scope } = request.query as { scope?: string };
    const global = isGlobalScope(user.role, scope);

    const scopeFilter = global ? '' : 'AND p.created_by = ?';
    const params = global ? [] : [user.userId];

    const [byStatus, byCategory, recentPending] = await Promise.all([
      databaseService.query<any>(
        `SELECT cr.status, COUNT(*) AS cnt
         FROM change_requests cr
         JOIN projects p ON cr.project_id = p.id
         WHERE 1=1 ${scopeFilter}
         GROUP BY cr.status`,
        params,
      ),
      databaseService.query<any>(
        `SELECT cr.category, COUNT(*) AS cnt
         FROM change_requests cr
         JOIN projects p ON cr.project_id = p.id
         WHERE 1=1 ${scopeFilter}
         GROUP BY cr.category`,
        params,
      ),
      databaseService.query<any>(
        `SELECT cr.id, cr.title, cr.priority, cr.created_at AS createdAt,
                p.name AS projectName, p.id AS projectId
         FROM change_requests cr
         JOIN projects p ON cr.project_id = p.id
         WHERE cr.status IN ('pending','in_review') ${scopeFilter}
         ORDER BY cr.created_at ASC
         LIMIT 5`,
        params,
      ),
    ]);

    const statusMap: Record<string, number> = {};
    for (const r of byStatus) statusMap[r.status] = Number(r.cnt);

    const categoryMap: Record<string, number> = {};
    for (const r of byCategory) categoryMap[r.category] = Number(r.cnt);

    const pending = recentPending.map((r: any) => ({
      ...r,
      daysWaiting: Math.max(0, Math.floor((Date.now() - new Date(r.createdAt).getTime()) / 86400000)),
    }));

    return { byStatus: statusMap, byCategory: categoryMap, recentPending: pending };
  });
}
