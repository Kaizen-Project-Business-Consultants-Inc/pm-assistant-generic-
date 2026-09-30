import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';

/**
 * Capacity by role: 12 weeks from this Monday. The weeks used to start at this Monday *at the
 * current time of day*, so an assignment starting next Monday also counted in this week (and
 * one ending this Monday did not count at all) — except at exactly midnight.
 */

vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'admin' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireTier', () => ({ requireFeature: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), projectsOfSchedules: vi.fn() }));
vi.mock('../../middleware/rateLimiter', () => ({ rateLimiter: () => vi.fn(async () => {}) }));
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: vi.fn(async () => 'all') }));
vi.mock('../../services/ProjectService', () => ({ projectService: {} }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {} }));
vi.mock('../../services/EmailService', () => ({ emailService: {} }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn() } }));
vi.mock('../../services/InviteService', () => ({ inviteService: {} }));
vi.mock('../../services/TaskAssignmentService', () => ({ taskAssignmentService: {} }));
const res = vi.hoisted(() => ({ findAllResources: vi.fn(), findEffectiveAssignments: vi.fn() }));
vi.mock('../../services/ResourceService', () => ({ resourceService: res, normalizeSkills: (s: any) => s }));

import { resourceRoutes } from '../../routes/resources/resources';

describe('GET /resources/capacity-by-role', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(resourceRoutes, { prefix: '/api/v1/resources' });
  }, 60_000);

  it('gives the same weeks whatever the time of day (dates are days, not moments)', async () => {
    // Pinned to Wed 30 Sep 2026 → weeks start Mon 28 Sep, Mon 5 Oct, …
    res.findAllResources.mockResolvedValue([{ id: 'r1', role: 'Developer', isActive: true, capacityHoursPerWeek: 40 }]);
    res.findEffectiveAssignments.mockResolvedValue([
      { resourceId: 'r1', startDate: '2026-10-05', endDate: '2026-10-09', hoursPerWeek: 20 }, // next week only
      { resourceId: 'r1', startDate: '2026-09-21', endDate: '2026-09-28', hoursPerWeek: 10 }, // ends this Monday
    ]);
    const run = async (moment: string) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(moment));
      try {
        const body = (await app.inject({ method: 'GET', url: '/api/v1/resources/capacity-by-role' })).json();
        return { headers: body.weekHeaders.slice(0, 3), allocated: body.roles[0].weeks.slice(0, 3).map((w: any) => w.allocated) };
      } finally {
        vi.useRealTimers();
      }
    };
    const morning = await run('2026-09-30T08:00:00Z');
    const evening = await run('2026-09-30T22:00:00Z');
    expect(evening).toEqual(morning);
    expect(morning).toEqual({ headers: ['2026-09-28', '2026-10-05', '2026-10-12'], allocated: [10, 20, 0] });
  });
});
