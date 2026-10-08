import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Audit "verify" (2026-10-08 efficiency check): any signed-in user could ask for the whole
 * company's chain, which loaded every audit entry into memory (108 MB on staging). Now: one
 * project's count needs access to that project; the whole chain needs PMO/owner or admin; both are
 * rate-limited; the whole chain is read a batch at a time.
 */
const user = vi.hoisted(() => ({ current: { userId: 'u1', role: 'project_manager' } as any }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = user.current; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
const checkProjectRoleFor = vi.hoisted(() => vi.fn());
vi.mock('../../middleware/requireProjectAccess', () => ({ requireProjectAccess: () => vi.fn(async () => {}), checkProjectRoleFor }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const query = vi.hoisted(() => vi.fn());
vi.mock('../../database/connection', () => ({ databaseService: { query } }));

import { auditTrailRoutes } from '../../routes/admin/auditTrail';
import { rateLimiter } from '../../middleware/rateLimiter';

describe('GET /audit/verify — who may ask, and how much it reads', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(auditTrailRoutes, { prefix: '/api/v1/audit' }); }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    (rateLimiter as any).windows?.clear?.();
    query.mockImplementation(async (sql: string) => (sql.includes('COUNT(*)') ? [{ cnt: 42 }] : []));
  });

  it("a project member gets the project's count — counted in the database, not loaded", async () => {
    checkProjectRoleFor.mockResolvedValue({ ok: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify?projectId=p1' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ valid: true, checkedCount: 42 });
    expect(query.mock.calls.every(([sql]) => !/SELECT \*/.test(sql))).toBe(true);
  });

  it("someone who can't open the project is refused", async () => {
    checkProjectRoleFor.mockResolvedValue({ ok: false, status: 404, body: { error: 'Not found' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify?projectId=other' });
    expect(res.statusCode).toBe(404);
    expect(query).not.toHaveBeenCalled();
  });

  it('a PM or team member cannot check the whole company', async () => {
    user.current = { userId: 'u2', role: 'project_manager' };
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify' });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/PMO or owner/);
    expect(query).not.toHaveBeenCalled();
  });

  it('PMO checks the whole chain a batch at a time (never one unbounded read)', async () => {
    user.current = { userId: 'u3', role: 'pmo' };
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit/verify' });
    expect(res.statusCode).toBe(200);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE id > \? ORDER BY id ASC LIMIT \?/);
    expect(params).toEqual([0, 1000]);
  });

  it('asking over and over is slowed down', async () => {
    user.current = { userId: 'u4', role: 'pmo' };
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) codes.push((await app.inject({ method: 'GET', url: '/api/v1/audit/verify' })).statusCode);
    expect(codes.slice(0, 10).every(c => c === 200)).toBe(true);
    expect(codes[10]).toBe(429);
  });
});
