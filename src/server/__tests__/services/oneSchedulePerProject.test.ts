import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A project has ONE schedule (user 2026-10-14, U26). ScheduleService.create refuses a second plan
 * for the same project — the app, the API, Claude and AI actions all create through it. What-If
 * scenario copies don't count (countPlans leaves them out).
 */
const repo = vi.hoisted(() => ({ countPlans: vi.fn(), create: vi.fn(async (d: any) => ({ id: 's-new', ...d })) }));
vi.mock('../../database/ScheduleRepository', () => ({ scheduleRepository: repo }));

import { scheduleService, ProjectHasScheduleError } from '../../services/ScheduleService';

const DATA = { projectId: 'p1', name: 'Plan', startDate: new Date('2026-11-02'), endDate: new Date('2027-03-05'), createdBy: 'u1' } as any;

describe('one schedule per project', () => {
  beforeEach(() => { repo.countPlans.mockReset(); repo.create.mockClear(); });

  it("a project's first schedule is created", async () => {
    repo.countPlans.mockResolvedValue(0);
    await expect(scheduleService.create(DATA)).resolves.toMatchObject({ id: 's-new' });
    expect(repo.countPlans).toHaveBeenCalledWith('p1');
  });

  it('a second one is refused with a plain message, and nothing is written', async () => {
    repo.countPlans.mockResolvedValue(1);
    await expect(scheduleService.create(DATA)).rejects.toBeInstanceOf(ProjectHasScheduleError);
    await expect(scheduleService.create(DATA)).rejects.toThrow(/one schedule/);
    expect(repo.create).not.toHaveBeenCalled();
  });
});
