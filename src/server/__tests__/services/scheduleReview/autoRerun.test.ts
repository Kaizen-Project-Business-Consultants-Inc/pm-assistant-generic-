import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const run = vi.fn().mockResolvedValue({});
const findById = vi.fn().mockResolvedValue({ id: 's1', projectId: 'p1' });
const broadcast = vi.fn();
vi.mock('../../../services/ScheduleReviewService', () => ({ scheduleReviewService: { run } }));
vi.mock('../../../services/ScheduleService', () => ({ scheduleService: { findById } }));
vi.mock('../../../services/WebSocketService', () => ({ WebSocketService: { broadcast } }));
vi.mock('../../../middleware/requestContext', () => ({ getRequestContext: () => ({ userId: 'u-1' }), getRequestId: () => 'r-1' }));
vi.mock('../../../utils/logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { queueReviewRerun, QUIET_MS, _resetAutoRerunForTests } from '../../../services/scheduleReview/autoRerun';

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
