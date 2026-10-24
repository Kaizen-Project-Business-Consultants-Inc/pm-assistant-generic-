import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Propose fixes — Apply (2026-10-17). The PM can edit a rename's new name before applying; a
 * blank or over-long name, or more than 200 fixes at once, is a 400 with a plain sentence.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
const gates = vi.hoisted(() => ({ scopes: [] as string[], roles: [] as string[] }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: (s: string) => { gates.scopes.push(s); return vi.fn(async () => {}); } }));
// "x-deny" stands for a caller who is not the project's manager
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: (role: string) => {
    gates.roles.push(role);
    return async (req: any, reply: any) => { if (req.headers['x-deny']) return reply.status(403).send({ error: 'Forbidden' }); };
  },
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../services/ChangeHistoryService', () => ({
  changeHistoryService: { assertLatestByRef: vi.fn(), markUndoneByRef: vi.fn() },
  NotLatestChangeError: class extends Error {},
}));
vi.mock('../../services/AIBudgetService', () => ({ aiRefusalReply: () => null }));
const svc = vi.hoisted(() => ({
  apply: vi.fn(async () => ({ appliedCount: 1 })),
  preview: vi.fn(async () => ({ tasksMoved: 3, finishBefore: '2027-01-15', finishAfter: '2027-09-13' })),
  undo: vi.fn(async () => ({ score: 54 })),
  undoSelected: vi.fn(async () => ({ putBack: 1, stillApplied: ['d1'], alsoPutBack: [] })),
}));
vi.mock('../../services/ScheduleFixProposerService', () => ({
  scheduleFixProposerService: svc,
  ScheduleFixNotFoundError: class extends Error {},
  ScheduleFixStateError: class extends Error {},
}));

const ReviewNotFound = vi.hoisted(() => class extends Error {});
vi.mock('../../services/ScheduleReviewService', () => ({ ScheduleReviewNotFoundError: ReviewNotFound }));

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

describe('Preview schedule fixes', () => {
  const PREVIEW = '/api/v1/schedules/s1/review/proposals/p1/preview';
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(scheduleFixRoutes, { prefix: '/api/v1/schedules' });
  }, 60_000);
  beforeEach(() => { svc.preview.mockClear(); svc.apply.mockClear(); });

  it('returns the service\'s dry run, and does not apply', async () => {
    const res = await app.inject({ method: 'POST', url: PREVIEW, payload: { fixIds: ['d1', 'd2'] } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ tasksMoved: 3, finishAfter: '2027-09-13' });
    expect(svc.preview).toHaveBeenCalledWith('s1', 'p1', ['d1', 'd2'], undefined);
    expect(svc.apply).not.toHaveBeenCalled();
  });

  it('passes the typed names on, and a plan that no longer exists is a 404', async () => {
    await app.inject({ method: 'POST', url: PREVIEW, payload: { fixIds: ['r1'], names: { r1: ' Kick-off ' } } });
    expect(svc.preview).toHaveBeenCalledWith('s1', 'p1', ['r1'], { r1: 'Kick-off' });
    svc.preview.mockRejectedValueOnce(new ReviewNotFound('gone'));
    const res = await app.inject({ method: 'POST', url: PREVIEW, payload: { fixIds: ['r1'] } });
    expect(res.statusCode).toBe(404);
  });

  it('is gated like Apply: write scope and the project manager', async () => {
    expect(gates.scopes).toContain('write');
    expect(gates.roles).toContain('manager');
    const res = await app.inject({ method: 'POST', url: PREVIEW, headers: { 'x-deny': '1' }, payload: { fixIds: ['d1'] } });
    expect(res.statusCode).toBe(403);
    expect(svc.preview).not.toHaveBeenCalled();
  });

  it('more than 200 fixes is a 400 in plain words', async () => {
    const res = await app.inject({ method: 'POST', url: PREVIEW, payload: { fixIds: Array.from({ length: 201 }, (_, i) => `f${i}`) } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Choose up to 200 fixes at a time.');
  });

  it('is rate-limited', async () => {
    let last = 200;
    for (let i = 0; i < 125 && last !== 429; i++) {
      last = (await app.inject({ method: 'POST', url: PREVIEW, payload: { fixIds: [] } })).statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('Undo schedule fixes — all or only some (U80)', () => {
  let app: any;
  const UNDO = '/api/v1/schedules/s1/review/proposals/p1/undo';
  beforeAll(async () => {
    app = Fastify();
    await app.register(scheduleFixRoutes, { prefix: '/api/v1/schedules' });
  }, 60_000);
  beforeEach(() => { svc.undo.mockClear(); svc.undoSelected.mockClear(); });

  it('no body: the whole Apply goes back, as before', async () => {
    const res = await app.inject({ method: 'POST', url: UNDO });
    expect(res.statusCode).toBe(200);
    expect(svc.undo).toHaveBeenCalledWith('s1', 'p1', 'u1');
    expect(svc.undoSelected).not.toHaveBeenCalled();
  });

  it('with fixIds: only those go back (through undoSelected), after the same newest-change check', async () => {
    const { changeHistoryService } = await import('../../services/ChangeHistoryService');
    const res = await app.inject({ method: 'POST', url: UNDO, payload: { fixIds: ['d2', 'd3'] } });
    expect(res.statusCode).toBe(200);
    expect(changeHistoryService.assertLatestByRef).toHaveBeenCalledWith('s1', 'review_fix', 'p1');
    expect(svc.undoSelected).toHaveBeenCalledWith('s1', 'p1', ['d2', 'd3'], 'u1');
    expect(svc.undo).not.toHaveBeenCalled();
  });

  it('an empty list, text instead of a list, or more than 200 is a 400 with a plain message, and nothing is undone', async () => {
    for (const fixIds of [[], 'd1', Array.from({ length: 201 }, (_, i) => 'd' + i)]) {
      const res = await app.inject({ method: 'POST', url: UNDO, payload: { fixIds } });
      expect(res.statusCode).toBe(400);
    }
    expect(svc.undo).not.toHaveBeenCalled();
    expect(svc.undoSelected).not.toHaveBeenCalled();
  });

  it('a refusal with a code (the kept fixes could not be applied again) reaches the client as 409 with that code', async () => {
    const { ScheduleFixStateError } = await import('../../services/ScheduleFixProposerService');
    svc.undoSelected.mockRejectedValueOnce(Object.assign(new ScheduleFixStateError('All 3 fixes were put back.'), { code: 'reapply_failed' }));
    const res = await app.inject({ method: 'POST', url: UNDO, payload: { fixIds: ['d1'] } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'All 3 fixes were put back.', code: 'reapply_failed' });
  });

  it('a caller who is not the project manager is refused before anything runs', async () => {
    const res = await app.inject({ method: 'POST', url: UNDO, headers: { 'x-deny': '1' }, payload: { fixIds: ['d1'] } });
    expect(res.statusCode).toBe(403);
    expect(svc.undoSelected).not.toHaveBeenCalled();
  });
});
