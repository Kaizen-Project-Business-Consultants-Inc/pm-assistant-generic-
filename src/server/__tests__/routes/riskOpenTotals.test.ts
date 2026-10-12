import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * The dashboard's Risk tile asked once per project, all at once — on staging that filled the
 * database pool (2026-10-12). One request now covers every project, and only projects the person
 * may read count.
 */
const who = vi.hoisted(() => ({ readable: new Set(['p1', 'p2']) as Set<string> | 'all' }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), checkProjectRole: vi.fn() }));
vi.mock('../../middleware/viewerWriteBypass', () => ({ viewerWriteBypass: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/rateLimiter', () => ({ heavyActionLimit: () => vi.fn(async () => {}) }));
vi.mock('../../utils/readableProjects', () => ({ readableProjectIds: vi.fn(async () => who.readable) }));
const getOpenTotals = vi.hoisted(() => vi.fn(async (ids: string[]) => ({ openRisks: ids.length * 2, critical: ids.length })));
vi.mock('../../services/RiskService', () => ({ riskService: { getOpenTotals, findById: vi.fn() } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { riskRoutes } from '../../routes/collaboration/risks';

async function get(query: string) {
  const app = Fastify();
  await app.register(riskRoutes, { prefix: '/api/v1/projects' });
  return app.inject({ method: 'GET', url: `/api/v1/projects/risks/open-totals${query}` });
}

describe('dashboard risk totals in one request', () => {
  beforeEach(() => { getOpenTotals.mockClear(); who.readable = new Set(['p1', 'p2']); });

  it('adds up the projects asked for, in one call', async () => {
    const res = await get('?ids=p1,p2');
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ openRisks: 4, critical: 2 });
    expect(getOpenTotals).toHaveBeenCalledTimes(1);
    expect(getOpenTotals).toHaveBeenCalledWith(['p1', 'p2']);
  });

  it('projects the person may not read are left out', async () => {
    await get('?ids=p1,secret-project');
    expect(getOpenTotals).toHaveBeenCalledWith(['p1']);
  });

  it('a PMO (reads everything) gets every project asked for; repeats count once', async () => {
    who.readable = 'all';
    await get('?ids=p1,p9,p9');
    expect(getOpenTotals).toHaveBeenCalledWith(['p1', 'p9']);
  });

  it('no projects → zeros', async () => {
    const res = await get('');
    expect(res.statusCode).toBe(200);
    expect(getOpenTotals).toHaveBeenCalledWith([]);
  });

  it('too many projects, or odd ids, are refused with a plain message', async () => {
    const many = Array.from({ length: 201 }, (_, i) => `p${i}`).join(',');
    const res = await get(`?ids=${many}`);
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/at most 200/);
    expect((await get('?ids=p1,%27%3B%20DROP')).statusCode).toBe(400);
    expect(getOpenTotals).not.toHaveBeenCalled();
  });
});
