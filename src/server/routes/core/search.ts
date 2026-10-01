import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { databaseService } from '../../database/connection';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import logger from '../../utils/logger';
import { readableProjectIds } from '../../utils/readableProjects';

interface SearchQuery {
  q: string;
  type?: string;
  project?: string;
  status?: string;
}

export async function searchRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { q, type, project, status } = request.query as SearchQuery;
      if (!q || q.length < 2) return { results: [], total: 0, queryMs: 0 };
      const term = `%${q}%`;
      const startTime = Date.now();
      // Project data comes from the projects you can read — created, member of, or the sample
      // project (2026-10-01: "created by you" only, so a PM added to a project couldn't find its tasks)
      const readable = await readableProjectIds(user);
      const readIds = readable === 'all' ? null : [...readable];
      const inReadable = (col: string) => readIds === null ? '1 = 1' : readIds.length ? `${col} IN (${readIds.map(() => '?').join(',')})` : '1 = 0';
      const readParams = readIds ?? [];

      // Determine which entity types to search
      const requestedTypes = type ? type.split(',').map(t => t.trim().toLowerCase()) : null;
      const shouldSearch = (entityType: string) => !requestedTypes || requestedTypes.includes(entityType);

      // Build optional filters
      const projectFilter = project ? project : null;
      const statusFilter = status ? status : null;

      // Run all searches in parallel
      const [projects, tasks, goals, lessons, resources, changeRequests, raidItems, sprints, comments] = await Promise.all([
        shouldSearch('project') ? databaseService.query<any>(
          `SELECT id, name, description, status FROM projects
           WHERE (name LIKE ? OR description LIKE ?) AND ${inReadable('id')}
           ${statusFilter ? 'AND status = ?' : ''}
           ${projectFilter ? 'AND id = ?' : ''}
           LIMIT 10`,
          [term, term, ...readParams, ...(statusFilter ? [statusFilter] : []), ...(projectFilter ? [projectFilter] : [])]
        ) : Promise.resolve([]),

        shouldSearch('task') ? databaseService.query<any>(
          `SELECT t.id, t.name, t.description, t.status, t.priority, t.assigned_to,
                  t.progress_percentage, t.start_date, t.end_date,
                  s.project_id, p.name as project_name
           FROM tasks t
           JOIN schedules s ON t.schedule_id = s.id
           JOIN projects p ON s.project_id = p.id
           WHERE (t.name LIKE ? OR t.description LIKE ?) AND ${inReadable('p.id')}
           ${statusFilter ? 'AND t.status = ?' : ''}
           ${projectFilter ? 'AND s.project_id = ?' : ''}
           LIMIT 10`,
          [term, term, ...readParams, ...(statusFilter ? [statusFilter] : []), ...(projectFilter ? [projectFilter] : [])]
        ) : Promise.resolve([]),

        shouldSearch('goal') ? databaseService.query<any>(
          `SELECT id, name, description, status, progress, goal_type, owner_id
           FROM goals WHERE (name LIKE ? OR description LIKE ?) AND created_by = ?
           ${statusFilter ? 'AND status = ?' : ''}
           LIMIT 5`,
          [term, term, user.userId, ...(statusFilter ? [statusFilter] : [])]
        ).catch((error) => { logger.warn('Search goals query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('lesson') ? databaseService.query<any>(
          `SELECT id, title as name, description, category as status FROM lessons_learned WHERE (title LIKE ? OR description LIKE ?) LIMIT 5`,
          [term, term]
        ).catch((error) => { logger.warn('Search lessons query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('resource') ? databaseService.query<any>(
          `SELECT id, name, role, email, skills, is_active
           FROM resources WHERE (name LIKE ? OR role LIKE ? OR email LIKE ?) AND created_by = ?
           LIMIT 5`,
          [term, term, term, user.userId]
        ).catch((error) => { logger.warn('Search resources query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('change_request') ? databaseService.query<any>(
          `SELECT cr.id, cr.title as name, cr.description, cr.status, cr.project_id, p.name as project_name
           FROM change_requests cr
           JOIN projects p ON cr.project_id = p.id
           WHERE (cr.title LIKE ? OR cr.description LIKE ?) AND ${inReadable('p.id')}
           ${statusFilter ? 'AND cr.status = ?' : ''}
           ${projectFilter ? 'AND cr.project_id = ?' : ''}
           LIMIT 5`,
          [term, term, ...readParams, ...(statusFilter ? [statusFilter] : []), ...(projectFilter ? [projectFilter] : [])]
        ).catch((error) => { logger.warn('Search change requests query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('risk') ? databaseService.query<any>(
          `SELECT r.id, r.title, r.description, r.type, r.severity, r.status, r.category, r.record_id,
                  r.project_id, p.name as project_name
           FROM project_risks r
           JOIN projects p ON r.project_id = p.id
           WHERE (r.title LIKE ? OR r.description LIKE ?) AND ${inReadable('p.id')}
           ${statusFilter ? 'AND r.status = ?' : ''}
           ${projectFilter ? 'AND r.project_id = ?' : ''}
           LIMIT 10`,
          [term, term, ...readParams, ...(statusFilter ? [statusFilter] : []), ...(projectFilter ? [projectFilter] : [])]
        ).catch((error) => { logger.warn('Search RAID items query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('sprint') ? databaseService.query<any>(
          `SELECT sp.id, sp.name, sp.goal, sp.status, sp.start_date, sp.end_date,
                  s.project_id, p.name as project_name
           FROM sprints sp
           JOIN schedules s ON sp.schedule_id = s.id
           JOIN projects p ON s.project_id = p.id
           WHERE (sp.name LIKE ? OR sp.goal LIKE ?) AND ${inReadable('p.id')}
           ${statusFilter ? 'AND sp.status = ?' : ''}
           ${projectFilter ? 'AND s.project_id = ?' : ''}
           LIMIT 5`,
          [term, term, ...readParams, ...(statusFilter ? [statusFilter] : []), ...(projectFilter ? [projectFilter] : [])]
        ).catch((error) => { logger.warn('Search sprints query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('comment') ? databaseService.query<any>(
          `SELECT tc.id, tc.text, tc.task_id, t.name as task_name,
                  s.project_id, p.name as project_name
           FROM task_comments tc
           JOIN tasks t ON tc.task_id = t.id
           JOIN schedules s ON t.schedule_id = s.id
           JOIN projects p ON s.project_id = p.id
           WHERE tc.text LIKE ? AND ${inReadable('p.id')}
           ${projectFilter ? 'AND s.project_id = ?' : ''}
           LIMIT 5`,
          [term, ...readParams, ...(projectFilter ? [projectFilter] : [])]
        ).catch((error) => { logger.warn('Search comments query failed', { error }); return []; }) : Promise.resolve([]),
      ]);

      const results = [
        ...projects.map((p: any) => ({ type: 'project', id: p.id, name: p.name, description: p.description, status: p.status })),
        ...tasks.map((t: any) => ({ type: 'task', id: t.id, name: t.name, description: t.description, status: t.status, projectId: t.project_id, projectName: t.project_name, priority: t.priority, assignedTo: t.assigned_to, progress: t.progress_percentage, startDate: t.start_date, endDate: t.end_date })),
        ...goals.map((g: any) => ({ type: 'goal', id: g.id, name: g.name, description: g.description, status: g.status, progress: g.progress, goalType: g.goal_type, ownerId: g.owner_id })),
        ...lessons.map((l: any) => ({ type: 'lesson', id: l.id, name: l.name, description: l.description, status: l.status })),
        ...resources.map((r: any) => ({ type: 'resource', id: r.id, name: r.name, description: r.role, status: r.is_active ? 'active' : 'inactive', role: r.role, skills: r.skills, isActive: r.is_active })),
        ...changeRequests.map((cr: any) => ({ type: 'change_request', id: cr.id, name: cr.name, description: cr.description, status: cr.status, projectId: cr.project_id, projectName: cr.project_name })),
        ...raidItems.map((r: any) => ({ type: 'risk', id: r.id, name: r.title, description: r.description, status: r.status, projectId: r.project_id, projectName: r.project_name, severity: r.severity, recordId: r.record_id, category: r.category, raidType: r.type })),
        ...sprints.map((sp: any) => ({ type: 'sprint', id: sp.id, name: sp.name, description: sp.goal, status: sp.status, projectId: sp.project_id, projectName: sp.project_name, startDate: sp.start_date, endDate: sp.end_date })),
        ...comments.map((c: any) => ({ type: 'comment', id: c.id, name: c.task_name, description: c.text ? c.text.substring(0, 120) : '', projectId: c.project_id, projectName: c.project_name, taskId: c.task_id })),
      ];

      const queryMs = Date.now() - startTime;
      return { results, total: results.length, queryMs };
    } catch (error) {
      logger.error('Search error', { error });
      return reply.status(500).send({ error: 'Search failed' });
    }
  });
}
