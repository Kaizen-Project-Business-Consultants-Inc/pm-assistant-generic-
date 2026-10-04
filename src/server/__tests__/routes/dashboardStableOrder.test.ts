import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Dashboard "top N" lists must come back in the same order on every load (2026-10-04).
 * "Next milestones" sorted by date only, so with many milestones on one date the 10th
 * item changed between loads. Every LIMITed list here needs a tie-break ending in the id.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../utils/readableProjects', () => ({ readableProjectJoin: vi.fn(async () => ({ join: '', params: [] })) }));
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));

import { dashboardDataRoutes } from '../../routes/reporting/dashboardData';

const flat = (sql: string) => sql.replace(/--[^\n]*/g, ' ').replace(/\s+/g, ' ');
const orderBy = (sql: string) => (flat(sql).match(/ORDER BY (.*?) LIMIT/i)?.[1] ?? '').trim();

describe('dashboard lists have a stable order', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(dashboardDataRoutes, { prefix: '/api/v1/dashboard' });
  }, 60_000);
  beforeEach(() => { db.query.mockReset(); db.query.mockResolvedValue([]); });

  it('next milestones: end date, then project name, then task name, then id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/dashboard/milestones' });
    expect(res.statusCode).toBe(200);
    expect(orderBy(db.query.mock.calls[0][0])).toBe('t.end_date ASC, p.name ASC, t.name ASC, t.id ASC');
  });

  it('overdue tasks: most overdue first, then a tie-break ending in the id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/dashboard/overdue-tasks' });
    expect(res.statusCode).toBe(200);
    expect(orderBy(db.query.mock.calls[0][0])).toBe('overdueDays DESC, p.name ASC, t.name ASC, t.id ASC');
  });

  it('pending change requests: oldest first, then id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/dashboard/cr-summary' });
    expect(res.statusCode).toBe(200);
    const limited = db.query.mock.calls.map((c: any[]) => c[0] as string).filter(sql => /LIMIT/i.test(sql));
    expect(limited).toHaveLength(1);
    expect(orderBy(limited[0])).toBe('cr.created_at ASC, cr.id ASC');
  });

  it('guard: every LIMITed query in the file ends its ORDER BY with an id', async () => {
    const { readFileSync } = await import('fs');
    const { join } = await import('path');
    const src = readFileSync(join(__dirname, '../../routes/reporting/dashboardData.ts'), 'utf8');
    const queries = src.split('`').filter(chunk => /\bLIMIT\b/i.test(chunk) && /\bSELECT\b/i.test(chunk));
    expect(queries.length).toBeGreaterThanOrEqual(3);
    for (const q of queries) expect(orderBy(q)).toMatch(/\b\w+\.id ASC$/);
  });
});
