import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * An import is one Schedule History line that Undo can take out again (2026-10-03): the tasks it
 * created (phase summaries included), the people it created for unknown names, its baseline.
 * Recorded LAST — after the review run — so the import's own follow-up writes don't make it
 * "changed since" and un-undoable.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireTier', () => ({ requireFeature: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/claudeService', () => ({ claudeService: {} }));
vi.mock('../../config', () => ({ config: { AI_ENABLED: false } }));

let next = 0;
const svc = vi.hoisted(() => ({
  findById: vi.fn(),
  findTasksByScheduleId: vi.fn(),
  createTask: vi.fn(),
  addDependency: vi.fn(),
  workingDayTest: vi.fn(),
  recomputeParentRollup: vi.fn(async () => {}),
}));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: svc }));
const resources = vi.hoisted(() => ({ findAllResources: vi.fn(), createResource: vi.fn() }));
vi.mock('../../services/ResourceService', () => ({ resourceService: resources }));
const baseline = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../services/BaselineService', () => ({ baselineService: baseline }));
const review = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock('../../services/ScheduleReviewService', () => ({ scheduleReviewService: review }));
const record = vi.hoisted(() => vi.fn());
vi.mock('../../services/ChangeHistoryService', () => ({ changeHistoryService: { record } }));

import { importRoutes } from '../../routes/scheduling/import';

describe('imports are recorded in Schedule History', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(importRoutes, { prefix: '/api/v1/schedules' }); }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    next = 0;
    svc.findById.mockResolvedValue({ id: 's1', projectId: 'p1' });
    svc.findTasksByScheduleId.mockResolvedValue([]);
    svc.createTask.mockImplementation(async (d: any) => ({ id: `t${++next}`, name: d.name }));
    svc.addDependency.mockResolvedValue(undefined);
    resources.findAllResources.mockResolvedValue([{ id: 'r-known', name: 'Ana', email: 'ana@x.com' }]);
    resources.createResource.mockImplementation(async (d: any) => ({ id: 'r-new', name: d.name }));
    baseline.create.mockResolvedValue({ id: 'bl-1' });
    review.run.mockResolvedValue({ score: 80, band: 'good', counts: {}, findings: [] });
    record.mockResolvedValue('chg-9');
  });

  it('CSV/Excel: every task it created (phases too), the people it created, its baseline — after the review run', async () => {
    const csv = [
      'Name,Phase,Owner,Start,Finish,Predecessors,Baseline Start',
      'Design,Plan,Ana,2026-10-05,2026-10-09,,2026-10-05',
      'Build,Plan,Kabir,2026-10-12,2026-10-16,1,2026-10-12',
    ].join('\n');
    const res = await app.inject({ method: 'POST', url: '/api/v1/schedules/s1/import', payload: { csv, fileName: 'plan.xlsx' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().changeId).toBe('chg-9');
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toMatchObject({
      projectId: 'p1', scheduleId: 's1', kind: 'import', summary: 'Imported 3 tasks from plan.xlsx', taskIds: ['t1', 't2', 't3'],
      undo: { createdIds: ['t1', 't2', 't3'], resourceIds: ['r-new'], baselineId: 'bl-1', links: 1, fileName: 'plan.xlsx' },
    });
    expect(review.run.mock.invocationCallOrder[0]).toBeLessThan(record.mock.invocationCallOrder[0]);
    // the phase is recalculated ONCE after its rows exist, not once per row; the calendar is read once (2026-10-08)
    expect(svc.recomputeParentRollup).toHaveBeenCalledTimes(1);
    expect(svc.recomputeParentRollup).toHaveBeenCalledWith('t1', 0, expect.anything()); // with the plan's calendar
    expect(svc.workingDayTest).toHaveBeenCalledTimes(1);
    const rows = svc.createTask.mock.calls.map(c => c[0]).filter((d: any) => d.parentTaskId);
    expect(rows.every((d: any) => d.deferParentRollup === true)).toBe(true);
    expect(svc.recomputeParentRollup.mock.invocationCallOrder[0]).toBeGreaterThan(Math.max(...svc.createTask.mock.invocationCallOrder));
    expect(svc.recomputeParentRollup.mock.invocationCallOrder[0]).toBeLessThan(svc.addDependency.mock.invocationCallOrder[0]);
  });

  it('MS Project / AI extraction: every task it created', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/schedules/s1/import-structured', payload: {
      fileName: 'plan.xml',
      tasks: [{ name: 'Phase', outlineLevel: 1 }, { name: 'Design', outlineLevel: 2, duration: 3, startDate: '2026-10-05', endDate: '2026-10-07' }],
    } });
    expect(res.statusCode).toBe(200);
    expect(res.json().changeId).toBe('chg-9');
    expect(record.mock.calls[0][0]).toMatchObject({ kind: 'import', summary: 'Imported 2 tasks from plan.xml', taskIds: ['t1', 't2'], undo: { createdIds: ['t1', 't2'], links: 0 } });

    // the outline parent is recalculated once, after its rows; the calendar read once (2026-10-08)
    expect(svc.recomputeParentRollup).toHaveBeenCalledTimes(1);
    expect(svc.recomputeParentRollup).toHaveBeenCalledWith('t1', 0, expect.anything()); // with the plan's calendar
    expect(svc.workingDayTest).toHaveBeenCalledTimes(1);
    expect(svc.createTask.mock.calls[1][0]).toMatchObject({ parentTaskId: 't1', deferParentRollup: true });
  });

  it('nothing imported: nothing recorded', async () => {
    svc.createTask.mockRejectedValue(new Error('boom'));
    const res = await app.inject({ method: 'POST', url: '/api/v1/schedules/s1/import-structured', payload: { tasks: [{ name: 'A' }] } });
    expect(res.json().changeId).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });
});
