import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Audit 2026-10-09 H3: the people-list rules looked only at email and line manager, so a PM could
 * send `userId`: unlink someone who signs in (then delete or re-email them), link a coworker's login
 * to an older record they manage (and become that coworker's timesheet approver), or link a login
 * from another company. Linking or unlinking a login is now the owner's or a PMO's call, and only
 * ever to a login of this company. Driven through the real routes and the real rules.
 */
const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
const PM = 'aaaaaaaa-0000-4000-8000-000000000002';
const PMO = 'aaaaaaaa-0000-4000-8000-000000000003';
const ANN = 'aaaaaaaa-0000-4000-8000-000000000004'; // a coworker who signs in
const OUTSIDER = 'aaaaaaaa-0000-4000-8000-000000000009'; // a login of another company
const COMPANY_LOGINS = new Set([OWNER, PM, PMO, ANN]);

const who = vi.hoisted(() => ({ user: { userId: '', role: 'project_manager' } }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = who.user; }) }));
vi.mock('../../middleware/requireTier', () => ({ requireFeature: () => async () => {} }));
vi.mock('../../middleware/requestContext', async (importOriginal) => ({ ...(await importOriginal<any>()), getRequestContext: () => ({ organizationId: 'o1' }) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn(async () => []),
    queryControlPlane: vi.fn(async (sql: string, params: any[]) => {
      if (/FROM organizations/.test(sql)) return [{ owner_user_id: OWNER }];
      if (/FROM users WHERE id = \? AND organization_id = \?/.test(sql)) return COMPANY_LOGINS.has(params[0]) && params[1] === 'o1' ? [{ id: params[0] }] : [];
      return [];
    }),
  },
}));
const store = vi.hoisted(() => ({ people: {} as Record<string, any> }));
vi.mock('../../services/ResourceService', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  resourceService: {
    findResourceById: vi.fn(async (id: string) => store.people[id] ?? null),
    updateResource: vi.fn(async (id: string, d: any) => ({ ...store.people[id], ...d })),
    createResource: vi.fn(async (d: any) => ({ id: 'new', ...d })),
    deleteResource: vi.fn(async () => true),
  },
}));

import { resourceRoutes } from '../../routes/resources/resources';
import { resourceService } from '../../services/ResourceService';

describe('linking a person to a login', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(resourceRoutes, { prefix: '/api/v1/resources' }); }, 60_000);
  beforeEach(() => {
    vi.mocked(resourceService.updateResource).mockClear();
    vi.mocked(resourceService.createResource).mockClear();
    vi.mocked(resourceService.deleteResource).mockClear();
    store.people = {
      'r-ann': { id: 'r-ann', name: 'Ann', email: 'ann@co.com', userId: ANN, lineManagerUserId: OWNER },
      'r-old': { id: 'r-old', name: 'Old record', email: 'old@co.com', userId: null, lineManagerUserId: PM },
      'r-owner': { id: 'r-owner', name: 'Owner', email: 'owner@co.com', userId: OWNER, lineManagerUserId: OWNER },
    };
  });
  const as = (userId: string, role: string) => { who.user = { userId, role }; };
  const put = (id: string, payload: unknown) => app.inject({ method: 'PUT', url: `/api/v1/resources/${id}`, payload });

  describe('a project manager', () => {
    beforeEach(() => as(PM, 'project_manager'));

    it("can't unlink someone who signs in — so can't then delete or re-email them", async () => {
      const res = await put('r-ann', { userId: null });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/link or unlink someone's login/);
      expect(resourceService.updateResource).not.toHaveBeenCalled();
      // the person still signs in, so the existing rules still refuse
      expect((await app.inject({ method: 'DELETE', url: '/api/v1/resources/r-ann' })).statusCode).toBe(403);
      expect((await put('r-ann', { email: 'mine@co.com' })).statusCode).toBe(403);
    });

    it("can't link a coworker's login to an older record they manage (timesheet approver hijack)", async () => {
      const res = await put('r-old', { userId: ANN });
      expect(res.statusCode).toBe(403);
      expect(resourceService.updateResource).not.toHaveBeenCalled();
    });

    it("can't add a person already linked to a login", async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/resources', payload: { name: 'Ann 2', email: 'ann2@co.com', userId: ANN } });
      expect(res.statusCode).toBe(403);
      expect(resourceService.createResource).not.toHaveBeenCalled();
    });

    it('still edits ordinary details, and saving the same link again is fine', async () => {
      expect((await put('r-old', { role: 'Analyst' })).statusCode).toBe(200);
      expect((await put('r-ann', { role: 'Lead', userId: ANN })).statusCode).toBe(200);
      expect(resourceService.updateResource).toHaveBeenCalledTimes(2);
    });
  });

  describe('the owner or a PMO', () => {
    it('can link a login of their own company', async () => {
      as(PMO, 'pmo');
      expect((await put('r-old', { userId: ANN })).statusCode).toBe(200);
      as(OWNER, 'pmo');
      expect((await app.inject({ method: 'POST', url: '/api/v1/resources', payload: { name: 'Ann 2', email: 'ann2@co.com', userId: ANN } })).statusCode).toBe(201);
    });

    it('can never link a login from another company', async () => {
      as(PMO, 'pmo');
      const res = await put('r-old', { userId: OUTSIDER });
      expect(res.statusCode).toBe(403);
      expect(res.json().message).toMatch(/isn't in your company/);
      as(OWNER, 'pmo');
      expect((await app.inject({ method: 'POST', url: '/api/v1/resources', payload: { name: 'X', email: 'x@else.com', userId: OUTSIDER } })).statusCode).toBe(403);
      expect(resourceService.updateResource).not.toHaveBeenCalled();
      expect(resourceService.createResource).not.toHaveBeenCalled();
    });

    it("a PMO can't unlink the owner's record or make a record the owner's", async () => {
      as(PMO, 'pmo');
      expect((await put('r-owner', { userId: null })).statusCode).toBe(403);
      expect((await put('r-old', { userId: OWNER })).statusCode).toBe(403);
      expect(resourceService.updateResource).not.toHaveBeenCalled();
    });
  });
});
