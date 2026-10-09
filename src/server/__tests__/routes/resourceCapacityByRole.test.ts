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
vi.mock('../../middleware/rateLimiter', () => ({ rateLimiter: () => vi.fn(async () => {}), heavyActionLimit: () => vi.fn(async () => {}) }));
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
import { hoursInWeek } from '../../services/weeklyLoad';

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
    // The booking ending this Monday covers one of this week's five working days: 10 h/week → 2 h
    // (2026-10-01: a week counts only the days a booking covers; it used to count all 10 h)
    expect(morning).toEqual({ headers: ['2026-09-28', '2026-10-05', '2026-10-12'], allocated: [2, 20, 0] });
  });

  it("many roles and bookings: each role adds up its own active people's bookings, as a scan per role did", async () => {
    const people: any[] = [];
    for (let i = 0; i < 300; i++) people.push({ id: 'r' + i, role: 'Role ' + (i % 10), isActive: i % 13 !== 0, capacityHoursPerWeek: 40 });
    const bookings: any[] = [];
    for (let k = 0; k < 12; k++) for (let i = 0; i < 320; i++) {
      // some for people not in the list; dates spread over the 12 weeks
      bookings.push({ resourceId: 'r' + i, startDate: '2026-' + (k % 2 ? '10' : '11') + '-0' + (1 + (k % 9)), endDate: '2026-12-' + (10 + k), hoursPerWeek: 1 + ((i + k) % 7) });
    }
    res.findAllResources.mockResolvedValue(people);
    res.findEffectiveAssignments.mockResolvedValue(bookings);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-30T08:00:00Z'));
    let body: any;
    try {
      body = (await app.inject({ method: 'GET', url: '/api/v1/resources/capacity-by-role' })).json();
    } finally {
      vi.useRealTimers();
    }
    expect(body.roles).toHaveLength(10);
    for (const role of body.roles) {
      // what it was before: every booking scanned for this role's active people
      const ids = new Set(people.filter(p => p.isActive && p.role === role.role).map(p => p.id));
      const mine = bookings.filter(a => ids.has(a.resourceId));
      expect(role.weeks.map((w: any) => w.allocated)).toEqual(body.weekHeaders.map((wk: string) => Math.round(mine.reduce((n, a) => n + hoursInWeek(a, wk), 0) * 10) / 10));
    }
    expect(body.roles.some((r: any) => r.weeks.some((w: any) => w.allocated > 0))).toBe(true);
  });
});
