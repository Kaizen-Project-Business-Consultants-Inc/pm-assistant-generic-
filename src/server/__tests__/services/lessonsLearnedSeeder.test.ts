import { describe, it, expect, vi } from 'vitest';

vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => [{ cnt: 0 }]) } }));
const projects = vi.hoisted(() => ({ findAll: vi.fn() }));
vi.mock('../../services/ProjectService', () => ({ projectService: projects }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: { findByProjectIds: vi.fn(async () => []), findTasksByScheduleIds: vi.fn(async () => []) },
}));

import { seedFromProjects } from '../../services/lessonsLearned/seeder';

describe('lessons-learned seeder', () => {
  it('states the expected % the same way whatever the time of day (dates are days, not moments)', async () => {
    // Pinned to 30 Sep 2026. Project 1 Sep → 1 Oct, nothing done: 29 of 30 days gone = 97% expected.
    const run = async (moment: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(moment));
      try {
        projects.findAll.mockResolvedValue([
          { id: 'p1', name: 'Alpha', projectType: 'it', status: 'active', startDate: '2026-09-01', endDate: '2026-10-01' },
        ]);
        const lessons: any[] = [];
        await seedFromProjects(async (l) => { lessons.push(l); });
        return lessons.find((l) => l.title === 'Significant schedule delay detected')?.description;
      } finally {
        vi.useRealTimers();
      }
    };
    const morning = await run('2026-09-30T08:00:00Z');
    const evening = await run('2026-09-30T22:00:00Z');
    expect(evening).toBe(morning);
    expect(morning).toContain('while 97% was expected');
  });
});
