import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Anyone who can view a project can generate its RAID report, but emailing it (sendEmail) is the
 * project Manager's, needs a key that may write, takes at most 20 people and is limited per hour
 * (2026-10-10 sweep: it was open to any viewer, to any number of people). The project-role check
 * is stood in by a rank check so the test shows which level each request is asked for.
 */
const state = vi.hoisted(() => ({ projectRole: 'viewer', scopes: ['read', 'write'] as string[] }));
const RANK: Record<string, number> = { viewer: 1, member: 2, manager: 3, owner: 4 };
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'team_member' }; }) }));
vi.mock('../../middleware/requireScope', () => ({
  requireScope: (scope: string) => async (_req: any, reply: any) => {
    if (!state.scopes.includes(scope)) return reply.status(403).send({ error: 'Forbidden', message: `needs ${scope}` });
  },
}));
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: (min: string) => async (_req: any, reply: any) => {
    if (RANK[state.projectRole] < RANK[min]) return reply.status(403).send({ error: 'Forbidden', message: `needs project ${min}` });
  },
  checkProjectRole: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../utils/trialSample', () => ({ showTrialExample: vi.fn(async () => false), projectHasRaidItems: vi.fn() }));
vi.mock('../../utils/trialEmail', () => ({ trialEmailAllowance: () => async () => {} }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const raid = vi.hoisted(() => ({ generate: vi.fn(async () => ({ html: '<p>r</p>' })) }));
vi.mock('../../services/RAIDReportService', () => ({ raidReportService: raid }));
vi.mock('../../services/ReportScheduleService', () => ({ reportScheduleService: {} }));

import { raidReportRoutes } from '../../routes/reporting/raidReports';

let app: ReturnType<typeof Fastify>;
beforeAll(async () => {
  app = Fastify();
  await app.register(raidReportRoutes, { prefix: '/raid' });
  await app.ready();
});
beforeEach(() => {
  state.projectRole = 'viewer';
  state.scopes = ['read', 'write'];
  raid.generate.mockClear();
});

const generate = (payload: object) => app.inject({ method: 'POST', url: '/raid/generate', payload: { projectId: 'p1', ...payload } });

describe('RAID report: generate vs email', () => {
  it('a viewer can generate the report', async () => {
    expect((await generate({})).statusCode).toBe(200);
    expect(raid.generate).toHaveBeenCalled();
  });

  it('a viewer cannot email it', async () => {
    const res = await generate({ sendEmail: true, recipients: ['a@x.com'] });
    expect(res.statusCode).toBe(403);
    expect(raid.generate).not.toHaveBeenCalled();
  });

  it('the project Manager can email it, but not with a read-only key', async () => {
    state.projectRole = 'manager';
    expect((await generate({ sendEmail: true, recipients: ['a@x.com'] })).statusCode).toBe(200);
    state.scopes = ['read'];
    expect((await generate({ sendEmail: true, recipients: ['a@x.com'] })).statusCode).toBe(403);
    expect((await generate({})).statusCode).toBe(200);
  });

  it('at most 20 people', async () => {
    state.projectRole = 'manager';
    const many = Array.from({ length: 21 }, (_, i) => `p${i}@x.com`);
    expect((await generate({ sendEmail: true, recipients: many })).statusCode).toBe(400);
  });
});
