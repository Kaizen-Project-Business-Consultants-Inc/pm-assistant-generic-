import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * POST /schedules/:scheduleId/indent (2026-10-30): the Gantt / Table indent and outdent. Real
 * planner and real body checks; the plan and the save are mocked. Refusals are 400 with the
 * reason, a viewer is 403, ids from another schedule are refused, and a good move is saved once
 * with a History summary the server builds.
 */
const who = vi.hoisted(() => ({ role: 'manager' as 'manager' | 'viewer' }));
const guards = vi.hoisted(() => ({ access: vi.fn(), limit: vi.fn() }));
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; req.tenantOrg = { id: 'org-a' }; }),
}));
vi.mock('../../middleware/requireProjectAccess', () => ({
  applyCoverRole: vi.fn(async () => false),
  requireProjectAccess: (...a: unknown[]) => { guards.access(...a); return async (_req: any, reply: any) => {
    if (who.role === 'viewer') return reply.status(403).send({ error: 'Forbidden', message: 'Managers only' });
  }; },
}));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: (...a: unknown[]) => { guards.limit(...a); return async () => undefined; } }));

const TASKS = [
  { id: 'a', name: 'A', scheduleId: 's1' },
  { id: 'b', name: 'B', scheduleId: 's1', parentTaskId: 'a' },
  { id: 'm', name: 'Go-live', scheduleId: 's1', isMilestone: true },
  { id: 'k', name: 'K', scheduleId: 's1', dependencies: [{ dependencyId: 'h' }] },
  { id: 'h', name: 'Head', scheduleId: 's1' },
];
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTasksByScheduleId: vi.fn(async () => TASKS),
    findById: vi.fn(async () => ({ id: 's1', projectId: 'p1' })),
  },
}));
const reparent = vi.hoisted(() => vi.fn(async (..._a: any[]) => ({ changeId: 'chg-1' })));
vi.mock('../../services/ChangeHistoryService', () => ({
  changeHistoryService: { list: vi.fn(), undo: vi.fn(), reparentTasksWithHistory: reparent },
  NotLatestChangeError: class extends Error {},
  ChangeStateError: class extends Error {},
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { changeHistoryRoutes } from '../../routes/scheduling/changeHistory';

describe('POST /schedules/:scheduleId/indent', () => {
  let app: any;
  const post = (payload: unknown) => app.inject({ method: 'POST', url: '/api/v1/schedules/s1/indent', payload: payload as object });
  const guardCalls = { access: [] as unknown[][], limit: [] as unknown[][] };
  beforeAll(async () => {
    app = Fastify(); await app.register(changeHistoryRoutes, { prefix: '/api/v1/schedules' });
    guardCalls.access = [...guards.access.mock.calls]; guardCalls.limit = [...guards.limit.mock.calls];
  }, 60_000);

  it('is guarded: managers only, and rate limited as task-indent (120)', () => {
    expect(guardCalls.access).toContainEqual(['manager']);
    expect(guardCalls.limit).toContainEqual(['task-indent', 120]);
  });
  beforeEach(() => { vi.clearAllMocks(); who.role = 'manager'; });

  it('outdent saves once with a History line that names the rows', async () => {
    const r = await post({ taskIds: ['b'], direction: 'outdent' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ moved: [{ taskId: 'b', newParentId: null }], changeId: 'chg-1' });
    expect(reparent).toHaveBeenCalledTimes(1);
    expect(reparent.mock.calls[0][0]).toMatchObject({ scheduleId: 's1', projectId: 'p1', moves: [{ id: 'b', parentId: null }] });
    expect(reparent.mock.calls[0][0].summary).toBe('Outdented 1 task up one level: row 2');
  });

  it('indent under a chosen heading names that heading in the History line', async () => {
    const r = await post({ taskIds: ['h'], direction: 'indent', underTaskId: 'a' });
    expect(r.statusCode).toBe(200);
    expect(reparent.mock.calls[0][0].summary).toBe('Indented 1 task under row 1 "A": row 3');
  });

  it('nothing to move: 200 with an empty list and no save', async () => {
    const r = await post({ taskIds: ['a'], direction: 'outdent' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ moved: [], changeId: null });
    expect(reparent).not.toHaveBeenCalled();
  });

  it('a milestone can not be the heading: 400 with the reason, nothing saved', async () => {
    const r = await post({ taskIds: ['a'], direction: 'indent', underTaskId: 'm' });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/milestone/);
    expect(reparent).not.toHaveBeenCalled();
  });

  it('a task linked to its new heading: 400 with the reason', async () => {
    const r = await post({ taskIds: ['k'], direction: 'indent', underTaskId: 'h' });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toMatch(/linked to/);
    expect(reparent).not.toHaveBeenCalled();
  });

  it('a task or heading from another schedule: 400', async () => {
    expect((await post({ taskIds: ['zzz'], direction: 'outdent' })).statusCode).toBe(400);
    expect((await post({ taskIds: ['a'], direction: 'indent', underTaskId: 'zzz' })).statusCode).toBe(400);
    expect(reparent).not.toHaveBeenCalled();
  });

  it('a refused save (loop, depth) comes back as a 400 with a full sentence', async () => {
    reparent.mockRejectedValueOnce(Object.assign(new Error('That would nest tasks more than 10 levels deep'), { refused: true }));
    const r = await post({ taskIds: ['b'], direction: 'outdent' });
    expect(r.statusCode).toBe(400);
    expect(r.json().message).toBe('That would nest tasks more than 10 levels deep. Nothing was moved.');
  });

  it('bad, empty or oversize ids and a bad direction: 400', async () => {
    for (const body of [
      {}, { taskIds: [], direction: 'indent' }, { taskIds: ['a'], direction: 'sideways' }, { taskIds: [''], direction: 'indent' },
      { taskIds: ['x'.repeat(65)], direction: 'indent' }, { taskIds: Array.from({ length: 201 }, (_, i) => `t${i}`), direction: 'indent' },
      { taskIds: ['a'], direction: 'indent', underTaskId: 'y'.repeat(65) },
    ]) {
      expect((await post(body)).statusCode, JSON.stringify(body).slice(0, 60)).toBe(400);
    }
    expect(reparent).not.toHaveBeenCalled();
  });

  it('a viewer is refused: 403, nothing planned or saved', async () => {
    who.role = 'viewer';
    expect((await post({ taskIds: ['b'], direction: 'outdent' })).statusCode).toBe(403);
    expect(reparent).not.toHaveBeenCalled();
  });
});
