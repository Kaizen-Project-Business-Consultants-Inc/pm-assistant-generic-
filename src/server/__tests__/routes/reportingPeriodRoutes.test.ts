import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * The reporting-period rule's routes (2026-10-31): "Cannot be split" and the accepted-exception list.
 * Both are the project manager's only.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', username: 'pm.person', role: 'project_manager' }; }) }));
const gates = vi.hoisted(() => ({ roles: [] as string[] }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
// "x-deny" stands for a caller who is not the project's manager
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: (role: string) => {
    gates.roles.push(role);
    return async (req: any, reply: any) => { if (req.headers['x-deny']) return reply.status(403).send({ error: 'Forbidden' }); };
  },
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}) }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {} }));
vi.mock('../../services/ProjectService', () => ({ projectService: {} }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: {} }));
vi.mock('../../utils/scheduleReviewDocxBuilder', () => ({ buildScheduleReviewDocx: vi.fn() }));
const svc = vi.hoisted(() => ({
  markCannotBeSplit: vi.fn(async () => true),
  run: vi.fn(async () => ({ id: 'rev2', score: 90, findings: [] })),
  removeSplitException: vi.fn(async () => true),
  splitExceptions: vi.fn(async () => [{ taskId: 't1', taskName: 'Build', reason: 'One vendor delivery', createdByName: 'pm.person', createdAt: '2026-10-31T10:00:00.000Z' }]),
}));
vi.mock('../../services/ScheduleReviewService', () => ({ scheduleReviewService: svc, ScheduleReviewNotFoundError: class extends Error {} }));

import { scheduleReviewRoutes } from '../../routes/scheduling/scheduleReview';

describe('Cannot be split', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(scheduleReviewRoutes, { prefix: '/api/v1/schedules' });
  }, 60_000);
  beforeEach(() => { svc.markCannotBeSplit.mockClear(); svc.run.mockClear(); });
  const URL = '/api/v1/schedules/s1/review/exceptions';

  it('saves the reason with who is asking, re-runs the review and returns both', async () => {
    const res = await app.inject({ method: 'POST', url: URL, payload: { taskId: 't1', reason: '  One vendor delivery  ' } });
    expect(res.statusCode).toBe(200);
    expect(svc.markCannotBeSplit).toHaveBeenCalledWith('s1', 't1', 'One vendor delivery', expect.objectContaining({ userId: 'u1', username: 'pm.person' }));
    expect(svc.run).toHaveBeenCalledWith('s1', 'manual', 'u1');
    expect(res.json().review.id).toBe('rev2');
    expect(res.json().exceptions).toHaveLength(1);
  });

  it('refuses a blank or too-short reason with a plain message, saving nothing', async () => {
    const res = await app.inject({ method: 'POST', url: URL, payload: { taskId: 't1', reason: '  ' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/short reason/);
    expect(svc.markCannotBeSplit).not.toHaveBeenCalled();
  });

  it('refuses a reason over 500 characters', async () => {
    const res = await app.inject({ method: 'POST', url: URL, payload: { taskId: 't1', reason: 'x'.repeat(501) } });
    expect(res.statusCode).toBe(400);
  });

  it('is a 404 for a task that is not on this schedule', async () => {
    svc.markCannotBeSplit.mockResolvedValueOnce(false);
    const res = await app.inject({ method: 'POST', url: URL, payload: { taskId: 'elsewhere', reason: 'No way to split' } });
    expect(res.statusCode).toBe(404);
    expect(svc.run).not.toHaveBeenCalled();
  });

  it('is the project manager only: anyone else is refused before anything is saved', async () => {
    const post = await app.inject({ method: 'POST', url: URL, headers: { 'x-deny': '1' }, payload: { taskId: 't1', reason: 'No way to split' } });
    const get = await app.inject({ method: 'GET', url: URL, headers: { 'x-deny': '1' } });
    expect(post.statusCode).toBe(403);
    expect(get.statusCode).toBe(403);
    expect(svc.markCannotBeSplit).not.toHaveBeenCalled();
    expect(gates.roles.filter(r => r === 'manager').length).toBeGreaterThanOrEqual(2);
  });

  it('lists the accepted exceptions for a manager', async () => {
    const res = await app.inject({ method: 'GET', url: URL });
    expect(res.statusCode).toBe(200);
    expect(res.json().exceptions[0]).toMatchObject({ taskId: 't1', reason: 'One vendor delivery' });
  });
  it('removes an exception, re-runs the review, and is a 404 when there was none', async () => {
    const ok = await app.inject({ method: 'DELETE', url: `${URL}/t1` });
    expect(ok.statusCode).toBe(200);
    expect(svc.removeSplitException).toHaveBeenCalledWith('s1', 't1');
    expect(svc.run).toHaveBeenCalledWith('s1', 'manual', 'u1');
    svc.removeSplitException.mockResolvedValueOnce(false);
    const none = await app.inject({ method: 'DELETE', url: `${URL}/elsewhere` });
    expect(none.statusCode).toBe(404);
    const denied = await app.inject({ method: 'DELETE', url: `${URL}/t1`, headers: { 'x-deny': '1' } });
    expect(denied.statusCode).toBe(403);
  });
});
