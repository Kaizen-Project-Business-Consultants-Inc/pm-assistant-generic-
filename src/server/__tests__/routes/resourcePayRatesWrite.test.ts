import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * 2026-10-10 review of audit M11: rates are blanked for people who may not see pay, so their Edit
 * form showed an empty rate box — and saving it stored "no rate" and re-priced the plans. A rate
 * field the caller can't see is now ignored on create, edit and import; a PM still changes it.
 */
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const SM = 'aaaaaaaa-0000-4000-8000-000000000005';
const PM = 'aaaaaaaa-0000-4000-8000-000000000002';

const who = vi.hoisted(() => ({ user: { userId: '', role: 'project_manager' } as Record<string, unknown> }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = who.user; }) }));
vi.mock('../../middleware/requireTier', () => ({ requireFeature: () => async () => {} }));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()), getRequestContext: () => ({ organizationId: 'o1' }) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: { findByUserId: vi.fn(async () => ({ id: 'o1', ownerUserId: OWNER })) } }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn(async () => []),
    queryControlPlane: vi.fn(async (sql: string) => (/FROM organizations/.test(sql) ? [{ owner_user_id: OWNER }] : [])),
  },
}));
const store = vi.hoisted(() => ({ people: {} as Record<string, any> }));
vi.mock('../../services/ResourceService', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  resourceService: {
    findResourceById: vi.fn(async (id: string) => store.people[id] ?? null),
    updateResource: vi.fn(async (id: string, d: any) => ({ ...store.people[id], ...d })),
    createResource: vi.fn(async (d: any) => ({ id: 'new', ...d })),
  },
}));

import { resourceRoutes } from '../../routes/resources/resources';
import { resourceService } from '../../services/ResourceService';

describe('pay rates can only be changed by those who see them', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(resourceRoutes, { prefix: '/api/v1/resources' }); }, 60_000);
  beforeEach(() => {
    vi.mocked(resourceService.updateResource).mockClear();
    vi.mocked(resourceService.createResource).mockClear();
    store.people = { 'r-bob': { id: 'r-bob', name: 'Bob', email: 'bob@co.com', userId: null, lineManagerUserId: PM, costRateHourly: 90 } };
  });
  const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/v1/resources/r-bob', payload });

  it('a scrum master saving the form (rate box blank) keeps the stored rate', async () => {
    who.user = { userId: SM, role: 'scrum_master' };
    const res = await put({ name: 'Bob B', costRateHourly: null, overtimeRateHourly: null, useRateCard: true });
    expect(res.statusCode).toBe(200);
    const data = vi.mocked(resourceService.updateResource).mock.calls[0][1] as Record<string, unknown>;
    expect(data.name).toBe('Bob B');
    expect('costRateHourly' in data || 'overtimeRateHourly' in data || 'useRateCard' in data).toBe(false);
  });

  it('a project manager still changes the rate', async () => {
    who.user = { userId: PM, role: 'project_manager' };
    expect((await put({ costRateHourly: 120 })).statusCode).toBe(200);
    expect(vi.mocked(resourceService.updateResource).mock.calls[0][1]).toMatchObject({ costRateHourly: 120 });
  });

  it('a scrum master adding someone cannot set their rate', async () => {
    who.user = { userId: SM, role: 'scrum_master' };
    await app.inject({ method: 'POST', url: '/api/v1/resources', payload: { name: 'Cy', role: 'Dev', email: 'cy@co.com', costRateHourly: 500, useRateCard: true } });
    const created = vi.mocked(resourceService.createResource).mock.calls[0]?.[0] as Record<string, unknown> | undefined;
    expect(created).toMatchObject({ costRateHourly: null, overtimeRateHourly: null, useRateCard: false });
  });
});
