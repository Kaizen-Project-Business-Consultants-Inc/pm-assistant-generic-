import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Three permission paths whose reads were batched on 2026-10-09 (loop clean-up batch 6) still
 * decide the same: a person's booked tasks hide other projects, the sprint readiness check refuses
 * a list with any unknown task, and report schedules answer each project's access once.
 */
const state = vi.hoisted(() => ({
  readable: new Set<string>() as Set<string> | 'all',
  sql: [] as Array<{ sql: string; params: any[] }>,
  answer: (_s: string, _p: any[]): any => [],
  resolved: [] as any[],
  role: 'team_member',
}));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn(async (sql: string, params: any[] = []) => { state.sql.push({ sql, params }); return state.answer(sql, params); }),
    queryControlPlane: vi.fn(async () => []),
  },
}));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: state.role }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}), rateLimiter: { check: vi.fn(() => ({ allowed: true })) } }));
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: vi.fn(async () => state.readable) }));
const checkProjectRole = vi.hoisted(() => vi.fn(async (_r: any, projectId: string) => ({ ok: projectId === 'p-ok' })));
vi.mock('../../middleware/requireProjectAccess', () => ({
  // the gate as wired: its own resolver decides; nothing found → refused
  requireProjectAccess: (_role: string, opts?: { resolve?: (req: any) => Promise<any> }) => async (req: any, reply: any) => {
    const found = opts?.resolve ? await opts.resolve(req) : ['p1'];
    state.resolved.push(found);
    if (!found) return reply.status(404).send({ error: 'Not found' });
  },
  projectsOfSchedules: vi.fn(async (ids: string[]) => ids.map(id => `project-of-${id}`)),
  checkProjectRole,
}));
vi.mock('../../services/ResourceService', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  resourceService: {
    findResourceById: vi.fn(async () => ({ id: 'r1', name: 'Ann', capacityHoursPerWeek: 40 })),
    findEffectiveAssignments: vi.fn(async () => [
      { id: 'b1', taskId: 't-mine', scheduleId: 's-mine', hoursPerWeek: 10, startDate: '2026-10-05', endDate: '2026-10-09', source: 'manual' },
      { id: 'b2', taskId: 't-secret', scheduleId: 's-other', hoursPerWeek: 20, startDate: '2026-10-05', endDate: '2026-10-09', source: 'manual' },
    ]),
  },
}));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { workingDayTest: vi.fn(async () => () => true), findTaskById: vi.fn() } }));
vi.mock('../../services/ReportScheduleService', () => ({
  reportScheduleService: {
    getByTemplateId: vi.fn(async () => [
      { id: 'rs1', createdBy: 'someone', templateId: 'tpl::p-ok' },
      { id: 'rs2', createdBy: 'someone', templateId: 'tpl::p-ok' },
      { id: 'rs3', createdBy: 'someone', templateId: 'tpl::p-no' },
      { id: 'rs4', createdBy: 'u1', templateId: 'tpl::p-no' },
    ]),
  },
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { resourceRoutes } from '../../routes/resources/resources';
import { sprintRoutes } from '../../routes/collaboration/sprints';
import { reportScheduleRoutes } from '../../routes/reporting/reportSchedules';

beforeEach(() => { state.sql = []; state.answer = () => []; state.resolved = []; state.role = 'team_member'; checkProjectRole.mockClear(); });

describe("a person's booked tasks", () => {
  it('a task in a project the viewer can\'t read shows as "Work on another project", and its name is never read', async () => {
    state.readable = new Set(['p-mine']);
    state.answer = (sql) => {
      if (sql.includes('FROM schedules')) return [{ id: 's-mine', project_id: 'p-mine' }, { id: 's-other', project_id: 'p-other' }];
      if (sql.includes('SELECT id, name FROM tasks')) return [{ id: 't-mine', name: 'My task' }];
      return [];
    };
    const app = Fastify(); await app.register(resourceRoutes, { prefix: '/r' });
    const res = await app.inject({ method: 'GET', url: '/r/r1/profile' });
    expect(res.statusCode).toBe(200);
    const details = res.json().assignments;
    expect(details.map((d: any) => [d.taskName, d.taskId, d.scheduleId, d.assignmentId])).toEqual([
      ['My task', 't-mine', 's-mine', 'b1'],
      ['Work on another project', '', '', ''],
    ]);
    const nameRead = state.sql.find(s => s.sql.includes('SELECT id, name FROM tasks'))!;
    expect(nameRead.params).toEqual(['t-mine']); // the other project's task was not looked up
    expect(state.sql.filter(s => s.sql.includes('FROM schedules'))).toHaveLength(1);
  });

  it('someone who reads every project sees every task, with no plan look-up', async () => {
    state.readable = 'all';
    state.answer = (sql) => (sql.includes('SELECT id, name FROM tasks') ? [{ id: 't-mine', name: 'My task' }, { id: 't-secret', name: 'Other task' }] : []);
    const app = Fastify(); await app.register(resourceRoutes, { prefix: '/r' });
    const details = (await app.inject({ method: 'GET', url: '/r/r1/profile' })).json().assignments;
    expect(details.map((d: any) => d.taskName)).toEqual(['My task', 'Other task']);
    expect(state.sql.some(s => s.sql.includes('FROM schedules'))).toBe(false);
  });
});

describe('sprint readiness for a list of tasks', () => {
  it('one read for all the tasks; every task\'s project is checked', async () => {
    state.answer = (sql) => (sql.includes('SELECT id, schedule_id FROM tasks') ? [{ id: 'a', schedule_id: 's1' }, { id: 'b', schedule_id: 's2' }, { id: 'c', schedule_id: 's1' }] : []);
    const app = Fastify(); await app.register(sprintRoutes, { prefix: '/s' });
    await app.inject({ method: 'GET', url: '/s/checklists/bulk/dor?taskIds=a,b,c' });
    expect(state.sql.filter(s => s.sql.includes('FROM tasks'))).toHaveLength(1);
    expect(state.resolved.at(-1)).toEqual(['project-of-s1', 'project-of-s2']);
  });

  it('a list with any unknown task is refused as a whole', async () => {
    state.answer = (sql) => (sql.includes('SELECT id, schedule_id FROM tasks') ? [{ id: 'a', schedule_id: 's1' }] : []);
    const app = Fastify(); await app.register(sprintRoutes, { prefix: '/s' });
    const res = await app.inject({ method: 'GET', url: '/s/checklists/bulk/dor?taskIds=a,nope' });
    expect(res.statusCode).toBe(404);
    expect(state.resolved.at(-1)).toBeNull();
  });
});

describe('report schedules of a template', () => {
  it('each project\'s access is checked once; your own schedules always show', async () => {
    const app = Fastify(); await app.register(reportScheduleRoutes, { prefix: '/rs' });
    const res = await app.inject({ method: 'GET', url: '/rs/template/tpl' });
    expect(res.json().schedules.map((s: any) => s.id)).toEqual(['rs1', 'rs2', 'rs4']);
    expect(checkProjectRole).toHaveBeenCalledTimes(2); // p-ok once, p-no once
  });

  it('admin and PMO see them all without a project check', async () => {
    state.role = 'pmo';
    const app = Fastify(); await app.register(reportScheduleRoutes, { prefix: '/rs' });
    const res = await app.inject({ method: 'GET', url: '/rs/template/tpl' });
    expect(res.json().schedules).toHaveLength(4);
    expect(checkProjectRole).not.toHaveBeenCalled();
  });
});
