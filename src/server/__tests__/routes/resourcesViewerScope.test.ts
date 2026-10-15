import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * U8 (2026-10-14): an org viewer (a client's staff member who signs in) or a guest sees only the
 * people on the projects they can read, and themselves — never the whole company, never another
 * client's pool. Everyone else in the company keeps the full list.
 */

const who = vi.hoisted(() => ({ user: { userId: 'u-viewer', role: 'viewer' } as any }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = who.user; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireTier', () => ({ requireFeature: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), projectsOfSchedules: vi.fn() }));
vi.mock('../../middleware/rateLimiter', () => ({ rateLimiter: () => vi.fn(async () => {}), heavyActionLimit: () => vi.fn(async () => {}) }));
const readable = vi.hoisted(() => ({ fn: vi.fn(async (): Promise<Set<string> | 'all'> => new Set(['p1'])) }));
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: readable.fn }));
vi.mock('../../utils/payRates', () => ({
  maySeePayRates: vi.fn(async () => false), maySetPayRates: vi.fn(async () => false),
  peopleFor: vi.fn(async (_r: any, rows: any[]) => rows), withoutPay: (r: any) => r, withoutPayInput: (r: any) => r,
}));
vi.mock('../../services/ProjectService', () => ({ projectService: { findAll: vi.fn(async () => [{ id: 'p1' }, { id: 'p2' }]) } }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {} }));
vi.mock('../../services/EmailService', () => ({ emailService: {} }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []) } }));
vi.mock('../../services/InviteService', () => ({ inviteService: {} }));
const ta = vi.hoisted(() => ({ getProjectAllocationsForAllResources: vi.fn() }));
vi.mock('../../services/TaskAssignmentService', () => ({ taskAssignmentService: ta }));
const person = (id: string) => ({ id, name: id, role: 'Developer', isActive: true, capacityHoursPerWeek: 40 });
const res = vi.hoisted(() => ({
  visiblePeopleIds: vi.fn(), findResourcesByIds: vi.fn(), findAllResourcesPaginated: vi.fn(),
  findAllDistinctSkillNames: vi.fn(), findBySkill: vi.fn(), findResourceById: vi.fn(),
  findEffectiveAssignments: vi.fn(async () => []), findAllResources: vi.fn(),
  computeGlobalWorkload: vi.fn(), computeUtilizationHistory: vi.fn(async () => ({ weeks: [] })),
}));
vi.mock('../../services/ResourceService', () => ({ resourceService: res, normalizeSkills: (s: any) => s, ResourceValidationError: class extends Error {} }));

import { resourceRoutes } from '../../routes/resources/resources';

describe('people routes for a viewer or guest (U8)', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(resourceRoutes, { prefix: '/api/v1/resources' });
  }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    who.user = { userId: 'u-viewer', role: 'viewer' };
    readable.fn.mockResolvedValue(new Set(['p1']));
    res.visiblePeopleIds.mockResolvedValue(new Set(['r-me', 'r-team']));
    res.findResourcesByIds.mockImplementation(async (ids: string[]) => ids.map(person));
    res.findAllResourcesPaginated.mockResolvedValue({ resources: [person('r-me'), person('r-team'), person('r-other-client')], total: 3 });
    res.findAllDistinctSkillNames.mockResolvedValue(['React']);
    res.findBySkill.mockResolvedValue([person('r-team'), person('r-other-client')]);
    res.findResourceById.mockImplementation(async (id: string) => person(id));
    res.computeGlobalWorkload.mockResolvedValue(['r-me', 'r-team', 'r-other-client'].map(id => ({ resourceId: id, resourceName: id, totalCost: 0 })));
    ta.getProjectAllocationsForAllResources.mockResolvedValue({ 'r-team': [{ projectId: 'p1', totalHoursPlanned: 8, taskCount: 1 }], 'r-other-client': [{ projectId: 'p2', totalHoursPlanned: 8, taskCount: 1 }] });
  });

  it('workload and project allocations leave out people they cannot see', async () => {
    const w = (await app.inject({ method: 'GET', url: '/api/v1/resources/workload' })).json();
    expect(w.workload.map((x: any) => x.resourceId)).toEqual(['r-me', 'r-team']);
    const a = (await app.inject({ method: 'GET', url: '/api/v1/resources/project-allocations' })).json();
    expect(Object.keys(a.allocations)).toEqual(['r-team']);
  });

  it("another person's history and delete preview are not found", async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/resources/r-other-client/utilization-history' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/resources/r-team/utilization-history' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/resources/r-team/delete-impact' })).statusCode).toBe(404);
  });

  it('the list is only the people they can see', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/v1/resources' })).json();
    expect(body.resources.map((r: any) => r.id)).toEqual(['r-me', 'r-team']);
    expect(res.visiblePeopleIds).toHaveBeenCalledWith('u-viewer', new Set(['p1']));
    expect(res.findAllResourcesPaginated).not.toHaveBeenCalled();
  });

  it('a guest is limited the same way', async () => {
    who.user = { userId: 'u-guest', role: 'team_member', isGuest: true };
    const body = (await app.inject({ method: 'GET', url: '/api/v1/resources' })).json();
    expect(body.resources.map((r: any) => r.id)).toEqual(['r-me', 'r-team']);
  });

  it('search by skill drops people they cannot see', async () => {
    const body = (await app.inject({ method: 'GET', url: '/api/v1/resources/by-skill?skill=React' })).json();
    expect(body.resources.map((r: any) => r.id)).toEqual(['r-team']);
  });

  it("another person's profile is not found; a teammate's is", async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/resources/r-other-client/profile' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/v1/resources/r-team/profile' })).statusCode).toBe(200);
  });

  it('company capacity is refused and the skill list is empty', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/resources/capacity-by-role' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/resources/skills' })).json()).toEqual({ skills: [] });
  });

  it('a project manager still sees the whole company', async () => {
    who.user = { userId: 'u-pm', role: 'project_manager' };
    const body = (await app.inject({ method: 'GET', url: '/api/v1/resources' })).json();
    expect(body.resources).toHaveLength(3);
    expect(res.visiblePeopleIds).not.toHaveBeenCalled();
  });
});
