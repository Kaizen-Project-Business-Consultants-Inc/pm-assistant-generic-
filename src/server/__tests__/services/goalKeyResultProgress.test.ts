import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({ insert: vi.fn(async (d: any) => d), update: vi.fn(async (_id: string, d: any) => d), findById: vi.fn() }));
vi.mock('../../database/GoalRepository', () => ({ goalRepository: repo }));

import { GoalService, measuredProgress } from '../../services/GoalService';

/** Key results showed 0% whatever their figures said ("3 / 10 proposals" at 0%) — fixed 2026-09-30. */
describe('key result progress follows its figures', () => {
  const svc = new GoalService();
  beforeEach(() => vi.clearAllMocks());

  it('current / target, rounded, kept within 0–100', () => {
    expect(measuredProgress(10, 3)).toBe(30);
    expect(measuredProgress(3, 1)).toBe(33);
    expect(measuredProgress(4, 6)).toBe(100);
    expect(measuredProgress(10, -2)).toBe(0);
    expect(measuredProgress(0, 3)).toBeNull();
    expect(measuredProgress(10, undefined)).toBeNull();
  });

  it('a new key result gets its progress from its figures', async () => {
    await svc.create({ name: 'Send 10 proposals', goalType: 'key_result', targetValue: 10, currentValue: 3 } as any);
    expect(repo.insert.mock.calls[0][0].progress).toBe(30);
  });

  it('an explicit progress, or an objective, is left alone', async () => {
    await svc.create({ name: 'KR', goalType: 'key_result', targetValue: 10, currentValue: 3, progress: 55 } as any);
    await svc.create({ name: 'Obj', goalType: 'objective', targetValue: 10, currentValue: 3 } as any);
    expect(repo.insert.mock.calls[0][0].progress).toBe(55);
    expect(repo.insert.mock.calls[1][0].progress).toBeUndefined();
  });

  it('editing the current figure moves the progress (using the stored target)', async () => {
    repo.findById.mockResolvedValue({ id: 'k1', goalType: 'key_result', targetValue: 10, currentValue: 3 });
    await svc.update('k1', { currentValue: 7 });
    expect(repo.update.mock.calls[0][1]).toEqual({ currentValue: 7, progress: 70 });
  });

  it('editing something else leaves progress alone', async () => {
    repo.findById.mockResolvedValue({ id: 'k1', goalType: 'key_result', targetValue: 10, currentValue: 3 });
    await svc.update('k1', { name: 'Renamed' } as any);
    expect(repo.update.mock.calls[0][1]).toEqual({ name: 'Renamed' });
  });
});
