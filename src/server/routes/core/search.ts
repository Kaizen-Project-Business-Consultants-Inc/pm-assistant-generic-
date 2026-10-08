import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { databaseService } from '../../database/connection';
import { authMiddleware } from '../../middleware/auth';
import { requireScope } from '../../middleware/requireScope';
import { getRequestContext } from '../../middleware/requestContext';
import logger from '../../utils/logger';
import { readableProjectIds } from '../../utils/readableProjects';

/**
 * Word search (2026-10-08). The searched columns have FULLTEXT indexes (tenant migration T085), so
 * normal searches use MATCH … AGAINST instead of LIKE '%…%', which read every row. Each word must
 * match, as a whole word or the start of one ("sched" finds "schedule").
 * Server settings (MariaDB 11.8, checked on staging): innodb_ft_min_token_size = 3, max 84, and the
 * built-in stopword list is on — those words are never indexed, so a required one would match nothing.
 */
const FT_MIN_WORD = 3;
const FT_MAX_WORD = 84;
const FT_STOPWORDS = new Set([
  'a', 'about', 'an', 'are', 'as', 'at', 'be', 'by', 'com', 'de', 'en', 'for', 'from', 'how', 'i', 'in', 'is', 'it',
  'la', 'of', 'on', 'or', 'that', 'the', 'this', 'to', 'was', 'what', 'when', 'where', 'who', 'will', 'with', 'und', 'www',
]);

/**
 * The search box text as a boolean-mode term — `+word*` per word — or null when no word can use the
 * index (all too short, stopwords, or nothing left); the caller then falls back to LIKE.
 * Words are split the way the index splits them (anything but letters, digits and _), which also
 * drops every boolean-mode operator (+ - < > ( ) ~ * " @). The result is still bound as a parameter.
 */
export function booleanSearchTerm(q: string): string | null {
  const words = q.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(w => {
    const n = [...w].length;
    return n >= FT_MIN_WORD && n <= FT_MAX_WORD && !FT_STOPWORDS.has(w);
  });
  return words.length ? [...new Set(words)].map(w => `+${w}*`).join(' ') : null;
}

interface SearchQuery {
  q: string;
  type?: string;
  project?: string;
  status?: string;
}

/** The word (FULLTEXT) indexes search relies on — T085 */
const WORD_INDEXES = 9;
const wordIndexState = new Map<string, { ok: boolean; at: number }>();
/** Tests only: forget what was found */
export function _resetWordIndexCheck(): void { wordIndexState.clear(); }

/** Whether this company's database has all of them: remembered when yes, re-checked every 10 minutes when no */
async function hasWordIndexes(): Promise<boolean> {
  const db = getRequestContext()?.tenantDbName ?? 'shared';
  const known = wordIndexState.get(db);
  if (known && (known.ok || Date.now() - known.at < 10 * 60_000)) return known.ok;
  try {
    const [row] = await databaseService.query<{ n: number }>(
      "SELECT COUNT(DISTINCT index_name) AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND index_type = 'FULLTEXT' AND index_name LIKE 'ft%search'",
    );
    const ok = Number(row?.n ?? 0) >= WORD_INDEXES;
    if (!ok) logger.error('[search] word indexes missing in this company database (T085 not applied) — using "contains" search', { db, found: row?.n });
    wordIndexState.set(db, { ok, at: Date.now() });
    return ok;
  } catch {
    return false;
  }
}

export async function searchRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', authMiddleware);

  fastify.get('/', { preHandler: [requireScope('read')] }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const user = request.user!;
      const { q, type, project, status } = request.query as SearchQuery;
      if (!q || q.length < 2) return { results: [], total: 0, queryMs: 0 };
      const term = `%${q}%`;
      // word search only where this company's database has the word indexes (T085); a company
      // whose migrations stopped earlier keeps the old "contains" search instead of failing
      const ft = (await hasWordIndexes()) ? booleanSearchTerm(String(q)) : null;
      // cols are fixed column names below, never user input; the search text is always a bound parameter
      const textMatch = (...cols: string[]) => ft
        ? { where: `MATCH(${cols.join(', ')}) AGAINST(? IN BOOLEAN MODE)`, params: [ft],
            order: `ORDER BY MATCH(${cols.join(', ')}) AGAINST(? IN BOOLEAN MODE) DESC`, orderParams: [ft] }
        : { where: `(${cols.map(c => `${c} LIKE ?`).join(' OR ')})`, params: cols.map(() => term), order: '', orderParams: [] as string[] };
      const mProject = textMatch('name', 'description');
      const mTask = textMatch('t.name', 't.description');
      const mGoal = textMatch('name', 'description');
      const mLesson = textMatch('title', 'description');
      const mResource = textMatch('name', 'role', 'email');
      const mCr = textMatch('cr.title', 'cr.description');
      const mRisk = textMatch('r.title', 'r.description');
      const mSprint = textMatch('sp.name', 'sp.goal');
      const mComment = textMatch('tc.text');
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
           WHERE ${mProject.where} AND ${inReadable('id')}
           ${statusFilter ? 'AND status = ?' : ''}
           ${projectFilter ? 'AND id = ?' : ''}
           ${mProject.order}
           LIMIT 10`,
          [...mProject.params, ...readParams, ...(statusFilter ? [statusFilter] : []), ...(projectFilter ? [projectFilter] : []), ...mProject.orderParams]
        ) : Promise.resolve([]),

        shouldSearch('task') ? databaseService.query<any>(
          `SELECT t.id, t.name, t.description, t.status, t.priority, t.assigned_to,
                  t.progress_percentage, t.start_date, t.end_date,
                  s.project_id, p.name as project_name
           FROM tasks t
           JOIN schedules s ON t.schedule_id = s.id
           JOIN projects p ON s.project_id = p.id
           WHERE ${mTask.where} AND ${inReadable('p.id')}
           ${statusFilter ? 'AND t.status = ?' : ''}
           ${projectFilter ? 'AND s.project_id = ?' : ''}
           ${mTask.order}
           LIMIT 10`,
          [...mTask.params, ...readParams, ...(statusFilter ? [statusFilter] : []), ...(projectFilter ? [projectFilter] : []), ...mTask.orderParams]
        ) : Promise.resolve([]),

        shouldSearch('goal') ? databaseService.query<any>(
          `SELECT id, name, description, status, progress, goal_type, owner_id
           FROM goals WHERE ${mGoal.where} AND created_by = ?
           ${statusFilter ? 'AND status = ?' : ''}
           ${mGoal.order}
           LIMIT 5`,
          [...mGoal.params, user.userId, ...(statusFilter ? [statusFilter] : []), ...mGoal.orderParams]
        ).catch((error) => { logger.warn('Search goals query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('lesson') ? databaseService.query<any>(
          `SELECT id, title as name, description, category as status FROM lessons_learned WHERE ${mLesson.where} ${mLesson.order} LIMIT 5`,
          [...mLesson.params, ...mLesson.orderParams]
        ).catch((error) => { logger.warn('Search lessons query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('resource') ? databaseService.query<any>(
          `SELECT id, name, role, email, skills, is_active
           FROM resources WHERE ${mResource.where} AND created_by = ?
           ${mResource.order}
           LIMIT 5`,
          [...mResource.params, user.userId, ...mResource.orderParams]
        ).catch((error) => { logger.warn('Search resources query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('change_request') ? databaseService.query<any>(
          `SELECT cr.id, cr.title as name, cr.description, cr.status, cr.project_id, p.name as project_name
           FROM change_requests cr
           JOIN projects p ON cr.project_id = p.id
           WHERE ${mCr.where} AND ${inReadable('p.id')}
           ${statusFilter ? 'AND cr.status = ?' : ''}
           ${projectFilter ? 'AND cr.project_id = ?' : ''}
           ${mCr.order}
           LIMIT 5`,
          [...mCr.params, ...readParams, ...(statusFilter ? [statusFilter] : []), ...(projectFilter ? [projectFilter] : []), ...mCr.orderParams]
        ).catch((error) => { logger.warn('Search change requests query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('risk') ? databaseService.query<any>(
          `SELECT r.id, r.title, r.description, r.type, r.severity, r.status, r.category, r.record_id,
                  r.project_id, p.name as project_name
           FROM project_risks r
           JOIN projects p ON r.project_id = p.id
           WHERE ${mRisk.where} AND ${inReadable('p.id')}
           ${statusFilter ? 'AND r.status = ?' : ''}
           ${projectFilter ? 'AND r.project_id = ?' : ''}
           ${mRisk.order}
           LIMIT 10`,
          [...mRisk.params, ...readParams, ...(statusFilter ? [statusFilter] : []), ...(projectFilter ? [projectFilter] : []), ...mRisk.orderParams]
        ).catch((error) => { logger.warn('Search RAID items query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('sprint') ? databaseService.query<any>(
          `SELECT sp.id, sp.name, sp.goal, sp.status, sp.start_date, sp.end_date,
                  s.project_id, p.name as project_name
           FROM sprints sp
           JOIN schedules s ON sp.schedule_id = s.id
           JOIN projects p ON s.project_id = p.id
           WHERE ${mSprint.where} AND ${inReadable('p.id')}
           ${statusFilter ? 'AND sp.status = ?' : ''}
           ${projectFilter ? 'AND s.project_id = ?' : ''}
           ${mSprint.order}
           LIMIT 5`,
          [...mSprint.params, ...readParams, ...(statusFilter ? [statusFilter] : []), ...(projectFilter ? [projectFilter] : []), ...mSprint.orderParams]
        ).catch((error) => { logger.warn('Search sprints query failed', { error }); return []; }) : Promise.resolve([]),

        shouldSearch('comment') ? databaseService.query<any>(
          `SELECT tc.id, tc.text, tc.task_id, t.name as task_name,
                  s.project_id, p.name as project_name
           FROM task_comments tc
           JOIN tasks t ON tc.task_id = t.id
           JOIN schedules s ON t.schedule_id = s.id
           JOIN projects p ON s.project_id = p.id
           WHERE ${mComment.where} AND ${inReadable('p.id')}
           ${projectFilter ? 'AND s.project_id = ?' : ''}
           ${mComment.order}
           LIMIT 5`,
          [...mComment.params, ...readParams, ...(projectFilter ? [projectFilter] : []), ...mComment.orderParams]
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
