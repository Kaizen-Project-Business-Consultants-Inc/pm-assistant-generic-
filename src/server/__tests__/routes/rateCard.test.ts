import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { ratesOn, type RateCardEntry } from '../../services/RateCardService';

/**
 * Rate card (2026-09-30): hourly rates by role, each from a date. Time is costed at the
 * rate in force when it was worked; only admins / PMO / PMs / the company owner see or
 * change it; everyone starts on their own rate.
 */

const who = vi.hoisted(() => ({ user: { userId: 'u1', role: 'project_manager' } as any }));
vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskPii: (v: string) => v,
}));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = who.user; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireTier', () => ({ requireFeature: () => vi.fn(async () => {}) }));
const org = vi.hoisted(() => ({ findByUserId: vi.fn(async () => ({ ownerUserId: 'owner-1' })) }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: org }));
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));

import { rateCardRoutes } from '../../routes/resources/rateCard';

const card: RateCardEntry[] = [
  { id: 'a', role: 'Developer', hourlyRate: 95, overtimeRate: 142.5, effectiveFrom: '2026-01-01' },
  { id: 'b', role: 'Developer', hourlyRate: 100, overtimeRate: null, effectiveFrom: '2026-10-01' },
];
const dev = (over: Partial<Parameters<typeof ratesOn>[0]> = {}) =>
  ({ role: 'developer ', costRateHourly: 80, overtimeRateHourly: null, useRateCard: true, ...over });

describe('ratesOn — the rate for a day', () => {
  it('uses the rate in force on that day (a raise does not change earlier work)', () => {
    expect(ratesOn(dev(), '2026-09-28', card)).toEqual({ standard: 95, overtime: 142.5 });
    expect(ratesOn(dev(), '2026-10-01', card).standard).toBe(100);
  });
  it('overtime defaults to 1.5 × the card rate', () => {
    expect(ratesOn(dev(), '2026-11-02', card).overtime).toBe(150);
  });
  it('matches the role regardless of case and spaces', () => {
    expect(ratesOn(dev({ role: '  DEVELOPER' }), '2026-03-01', card).standard).toBe(95);
  });
  it('falls back to the own rate before the role has any card rate, or for an unknown role', () => {
    expect(ratesOn(dev(), '2025-12-31', card)).toEqual({ standard: 80, overtime: 120 });
    expect(ratesOn(dev({ role: 'Tester' }), '2026-11-02', card).standard).toBe(80);
  });
  it('ignores the card for a resource on its own rate (everyone starts this way)', () => {
    expect(ratesOn(dev({ useRateCard: false, overtimeRateHourly: 130 }), '2026-11-02', card)).toEqual({ standard: 80, overtime: 130 });
  });
  it('no rate at all → null, not zero or a crash', () => {
    expect(ratesOn(dev({ useRateCard: false, costRateHourly: null }), '2026-11-02', card)).toEqual({ standard: null, overtime: null });
  });
});

describe('rate card routes', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(rateCardRoutes, { prefix: '/api/v1/rate-card' });
  }, 60_000);
  beforeEach(() => {
    vi.clearAllMocks();
    who.user = { userId: 'u1', role: 'project_manager' };
    db.query.mockResolvedValue([]);
  });

  it('a team member can neither see nor change the card', async () => {
    who.user = { userId: 'u2', role: 'team_member' };
    expect((await app.inject({ method: 'GET', url: '/api/v1/rate-card' })).statusCode).toBe(403);
    const res = await app.inject({ method: 'POST', url: '/api/v1/rate-card', payload: { role: 'Dev', hourlyRate: 1, effectiveFrom: '2026-10-01' } });
    expect(res.statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('a finance officer sees the card but cannot change it (user 2026-10-10)', async () => {
    who.user = { userId: 'f1', role: 'finance_officer' };
    expect((await app.inject({ method: 'GET', url: '/api/v1/rate-card' })).statusCode).toBe(200);
    db.query.mockClear();
    const add = await app.inject({ method: 'POST', url: '/api/v1/rate-card', payload: { role: 'Dev', hourlyRate: 1, effectiveFrom: '2026-10-01' } });
    expect(add.statusCode).toBe(403);
    expect(add.json().message).toMatch(/can change the rate card/);
    expect((await app.inject({ method: 'PUT', url: '/api/v1/rate-card/r1', payload: { role: 'Dev', hourlyRate: 1, effectiveFrom: '2026-10-01' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/rate-card/r1' })).statusCode).toBe(403);
    expect(db.query).not.toHaveBeenCalled();
  });

  it('a guest is refused even with a PM role', async () => {
    who.user = { userId: 'g1', role: 'project_manager', isGuest: true };
    expect((await app.inject({ method: 'GET', url: '/api/v1/rate-card' })).statusCode).toBe(403);
  });

  it('the company owner may manage it whatever their role', async () => {
    who.user = { userId: 'owner-1', role: 'team_member' };
    expect((await app.inject({ method: 'GET', url: '/api/v1/rate-card' })).statusCode).toBe(200);
  });

  it('a PM adds a rate', async () => {
    db.query.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT * FROM rate_card WHERE id') ? [{ id: 'n', role: 'Developer', hourly_rate: '100.00', overtime_rate: null, effective_from: '2026-10-01' }] : []);
    const res = await app.inject({ method: 'POST', url: '/api/v1/rate-card', payload: { role: ' Developer ', hourlyRate: 100, effectiveFrom: '2026-10-01' } });
    expect(res.statusCode).toBe(201);
    expect(res.json().rate).toEqual({ id: 'n', role: 'Developer', hourlyRate: 100, overtimeRate: null, effectiveFrom: '2026-10-01' });
    const insert = db.query.mock.calls.find(c => String(c[0]).startsWith('INSERT'))!;
    expect(insert[1].slice(1, 5)).toEqual(['Developer', 100, null, '2026-10-01']);
  });

  it('a missing role or date says what is missing', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/api/v1/rate-card', payload: { role: '', hourlyRate: 5, effectiveFrom: '2026-10-01' } });
    expect(r1.statusCode).toBe(400);
    expect(r1.json().message).toBe('Enter the role this rate is for.');
    const r2 = await app.inject({ method: 'POST', url: '/api/v1/rate-card', payload: { role: 'Dev', hourlyRate: 5 } });
    expect(r2.statusCode).toBe(400);
    const r3 = await app.inject({ method: 'POST', url: '/api/v1/rate-card', payload: { role: 'Dev', hourlyRate: -1, effectiveFrom: '2026-10-01' } });
    expect(r3.json().message).toBe("The hourly rate can't be negative.");
  });

  it('a second rate for the same role and start date is refused with a clear message', async () => {
    db.query.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT * FROM rate_card ORDER') ? [{ id: 'a', role: 'Developer', hourly_rate: 95, overtime_rate: null, effective_from: '2026-10-01' }] : []);
    const res = await app.inject({ method: 'POST', url: '/api/v1/rate-card', payload: { role: 'developer', hourlyRate: 100, effectiveFrom: '2026-10-01' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().message).toMatch(/already has a rate starting 2026-10-01/);
  });

  it('changing or removing a rate that is gone → 404', async () => {
    expect((await app.inject({ method: 'PUT', url: '/api/v1/rate-card/x', payload: { role: 'Dev', hourlyRate: 5, effectiveFrom: '2026-10-01' } })).statusCode).toBe(404);
    db.query.mockResolvedValue({ affectedRows: 0 });
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/rate-card/x' })).statusCode).toBe(404);
  });
});
