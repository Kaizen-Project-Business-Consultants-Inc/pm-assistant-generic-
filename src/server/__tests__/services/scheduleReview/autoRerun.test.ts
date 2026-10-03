import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const run = vi.fn().mockResolvedValue({});
const findById = vi.fn().mockResolvedValue({ id: 's1', projectId: 'p1' });
const broadcast = vi.fn();
vi.mock('../../../services/ScheduleReviewService', () => ({ scheduleReviewService: { run } }));
vi.mock('../../../services/ScheduleService', () => ({ scheduleService: { findById } }));
vi.mock('../../../services/WebSocketService', () => ({ WebSocketService: { broadcast } }));
const recalcSchedule = vi.fn().mockResolvedValue(0);
vi.mock('../../../services/TaskBudgetService', () => ({ taskBudgetService: { recalcSchedule } }));
vi.mock('../../../middleware/requestContext', () => ({ getRequestContext: () => ({ userId: 'u-1' }), getRequestId: () => 'r-1' }));
vi.mock('../../../utils/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { AsyncLocalStorage } from 'async_hooks';
import { queueReviewRerun, QUIET_MS, MAX_RUNNING, whenThereIsRoom, _resetAutoRerunForTests } from '../../../services/scheduleReview/autoRerun';

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r)); };

describe('queueReviewRerun', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); vi.clearAllMocks(); _resetAutoRerunForTests(); });
  afterEach(() => { _resetAutoRerunForTests(); vi.useRealTimers(); });

  it('runs one rule-based review after a burst of edits goes quiet', async () => {
    for (let i = 0; i < 10; i++) { queueReviewRerun('s1'); vi.advanceTimersByTime(1000); }
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(QUIET_MS);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith('s1', 'auto', 'u-1');
    expect(recalcSchedule).toHaveBeenCalledWith('s1'); // task budgets follow the plan (planned hours × rate)
    expect(broadcast).toHaveBeenCalledWith(
      { type: 'schedule_updated', payload: { scheduleId: 's1', reviewUpdated: true } }, 'p1');
  });

  it('keeps schedules separate', async () => {
    queueReviewRerun('s1');
    queueReviewRerun('s2');
    vi.advanceTimersByTime(QUIET_MS);
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('skips a schedule deleted before the review ran, and ignores empty ids', async () => {
    findById.mockResolvedValueOnce(null);
    queueReviewRerun('gone');
    queueReviewRerun(null);
    queueReviewRerun(undefined);
    vi.advanceTimersByTime(QUIET_MS);
    await flush();
    expect(run).not.toHaveBeenCalled();
  });

  it('never throws into the edit when the review fails', async () => {
    run.mockRejectedValueOnce(new Error('boom'));
    queueReviewRerun('s1');
    vi.advanceTimersByTime(QUIET_MS);
    await flush();
    expect(run).toHaveBeenCalledTimes(1);
  });
});

/**
 * 2026-10-03: a rate card change queued every plan in the company; all came due together and
 * used up the database connections ("Queue limit reached" on staging). Now at most MAX_RUNNING
 * run at once, and the ones that wait still run as their own company.
 */
describe('a burst of plans coming due together', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); vi.clearAllMocks(); _resetAutoRerunForTests(); });
  afterEach(() => { _resetAutoRerunForTests(); vi.useRealTimers(); });

  it(`never runs more than ${MAX_RUNNING} reviews at once, and every plan still gets its review`, async () => {
    let now = 0, most = 0;
    const releases: Array<() => void> = [];
    run.mockImplementation(() => { now++; most = Math.max(most, now); return new Promise<void>(r => releases.push(() => { now--; r(); })); });
    for (let i = 1; i <= 10; i++) queueReviewRerun(`s${i}`);
    vi.advanceTimersByTime(QUIET_MS);
    for (let round = 0; round < 20; round++) { await flush(); releases.splice(0).forEach(r => r()); }
    await flush();
    expect(most).toBe(MAX_RUNNING);
    expect(run).toHaveBeenCalledTimes(10);
    expect(new Set(run.mock.calls.map(c => c[0])).size).toBe(10);
    run.mockReset(); run.mockResolvedValue({});
  });

  it('a plan that waited its turn runs as its OWN company, not the one that finished before it', async () => {
    vi.useRealTimers(); // the fake clock runs timers outside any context; real ones keep it
    const tenant = new AsyncLocalStorage<{ db: string }>();
    const seen: Record<string, string | undefined> = {};
    const job = (sid: string) => async () => {
      await new Promise(r => setTimeout(r, 5)); // hold the slot so others must wait
      seen[sid] = tenant.getStore()?.db;
    };
    tenant.run({ db: 'company_A' }, () => { whenThereIsRoom(job('a1')); whenThereIsRoom(job('a2')); whenThereIsRoom(job('a3')); });
    tenant.run({ db: 'company_B' }, () => { whenThereIsRoom(job('b1')); whenThereIsRoom(job('b2')); });
    await new Promise(r => setTimeout(r, 100));
    expect(seen).toEqual({ a1: 'company_A', a2: 'company_A', a3: 'company_A', b1: 'company_B', b2: 'company_B' });
  });

  it('a review that fails still lets the next one start', async () => {
    run.mockRejectedValueOnce(new Error('boom')).mockRejectedValueOnce(new Error('boom'));
    for (let i = 1; i <= 4; i++) queueReviewRerun(`f${i}`);
    vi.advanceTimersByTime(QUIET_MS);
    await flush(); await flush();
    expect(run).toHaveBeenCalledTimes(4);
  });
});
