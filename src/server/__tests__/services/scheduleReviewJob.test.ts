import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn(async (sql: string) => {
  if (/FROM schedules/i.test(sql)) return [{ id: 's1', project_id: 'p1' }];
  if (/project_members/i.test(sql)) return [{ user_id: 'u1' }, { user_id: 'u2' }];
  return [];
});
vi.mock('../../database/connection', () => ({ databaseService: { query } }));

const create = vi.fn().mockResolvedValue({});
vi.mock('../../services/NotificationService', () => ({ notificationService: { create } }));

const latest = vi.fn();
const run = vi.fn();
vi.mock('../../services/ScheduleReviewService', () => ({ scheduleReviewService: { latest, run } }));

const redis = { isConnected: vi.fn(() => false), get: vi.fn(), set: vi.fn(() => Promise.resolve()) };
vi.mock('../../services/RedisService', () => ({ redisService: redis }));

const counts = (over: Partial<Record<string, number>> = {}) => ({ critical: 0, high: 0, medium: 0, low: 0, info: 0, ...over });

async function runJob() {
  const { runScheduleReview } = await import('../../services/scheduling/scheduleReviewJob');
  return runScheduleReview();
}

describe('runScheduleReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redis.isConnected.mockReturnValue(false);
  });

  it('notifies owners/managers when the score drops', async () => {
    latest.mockResolvedValue({ score: 60, counts: counts() });
    run.mockResolvedValue({ score: 40, counts: counts() });
    const n = await runJob();
    expect(create).toHaveBeenCalledTimes(2); // u1 + u2
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'schedule_review', severity: 'medium', scheduleId: 's1' }));
    expect(n).toBe(2);
  });

  it('uses high severity when a new critical finding appears', async () => {
    latest.mockResolvedValue({ score: 80, counts: counts() });
    run.mockResolvedValue({ score: 80, counts: counts({ critical: 1 }) });
    await runJob();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ severity: 'high' }));
  });

  it('does not notify when the schedule improved and no new critical/high', async () => {
    latest.mockResolvedValue({ score: 40, counts: counts() });
    run.mockResolvedValue({ score: 60, counts: counts() });
    const n = await runJob();
    expect(create).not.toHaveBeenCalled();
    expect(n).toBe(0);
  });

  it('dedups via Redis so a standing drop is not re-notified', async () => {
    latest.mockResolvedValue({ score: 60, counts: counts() });
    run.mockResolvedValue({ score: 40, counts: counts() });
    redis.isConnected.mockReturnValue(true);
    redis.get.mockResolvedValue('1'); // already notified for this score
    const n = await runJob();
    expect(create).not.toHaveBeenCalled();
    expect(n).toBe(0);
  });
});
