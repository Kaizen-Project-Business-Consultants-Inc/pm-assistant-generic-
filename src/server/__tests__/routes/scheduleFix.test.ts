import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Propose fixes — Apply (2026-10-17). The PM can edit a rename's new name before applying; a
 * blank or over-long name, or more than 200 fixes at once, is a 400 with a plain sentence.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/ChangeHistoryService', () => ({
  changeHistoryService: { assertLatestByRef: vi.fn(), markUndoneByRef: vi.fn() },
  NotLatestChangeError: class extends Error {},
}));
vi.mock('../../services/AIBudgetService', () => ({ aiRefusalReply: () => null }));
const svc = vi.hoisted(() => ({ apply: vi.fn(async () => ({ appliedCount: 1 })) }));
vi.mock('../../services/ScheduleFixProposerService', () => ({
  scheduleFixProposerService: svc,
  ScheduleFixNotFoundError: class extends Error {},
  ScheduleFixStateError: class extends Error {},
}));

import { scheduleFixRoutes } from '../../routes/scheduling/scheduleFix';

const URL = '/api/v1/schedules/s1/review/proposals/p1/apply';

describe('Apply schedule fixes — names', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(scheduleFixRoutes, { prefix: '/api/v1/schedules' });
  }, 60_000);
  beforeEach(() => svc.apply.mockClear());

  it('passes trimmed names on to the service', async () => {
    const res = await app.inject({ method: 'POST', url: URL, payload: { fixIds: ['r1'], names: { r1: '  Task 1 – Kick-off  ' } } });
    expect(res.statusCode).toBe(200);
    expect(svc.apply).toHaveBeenCalledWith('s1', 'p1', ['r1'], 'u1', { r1: 'Task 1 – Kick-off' });
  });

  it('a blank name is a 400 with a plain message', async () => {
    const res = await app.inject({ method: 'POST', url: URL, payload: { fixIds: ['r1'], names: { r1: '   ' } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('A new name cannot be empty. Type a name, or untick that rename.');
    expect(svc.apply).not.toHaveBeenCalled();
  });

  it('a name over 255 characters is a 400', async () => {
    const res = await app.inject({ method: 'POST', url: URL, payload: { fixIds: ['r1'], names: { r1: 'x'.repeat(256) } } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('A new name can be at most 255 characters.');
  });

  it('more than 200 fixes at once says so plainly', async () => {
    const res = await app.inject({ method: 'POST', url: URL, payload: { fixIds: Array.from({ length: 201 }, (_, i) => `f${i}`) } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Choose up to 200 fixes at a time.');
  });
});
