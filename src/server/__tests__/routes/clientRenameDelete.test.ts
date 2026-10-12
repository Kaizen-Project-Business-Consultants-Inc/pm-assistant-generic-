import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Audit 2, L-g (2026-10-11): any project manager could rename or delete any client — and a client
 * is shared by every PM's projects. Now: the company owner/PMO, or the PM who added that client.
 */
const who = vi.hoisted(() => ({ user: {} as Record<string, unknown> }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = who.user; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
const svc = vi.hoisted(() => ({
  getGroup: vi.fn(async (id: string) => (id === 'g-gone' ? null : { id, name: 'Acme', createdBy: 'pm-alice' })),
  getGroups: vi.fn(async () => [{ id: 'g1', name: 'Acme', createdBy: 'pm-alice' }, { id: 'g2', name: 'Globex', createdBy: 'pm-bob' }, { id: 'g3', name: 'Initech', createdBy: 'pm-alice' }]),
  reorderGroups: vi.fn(async () => {}),
  updateGroup: vi.fn(async (id: string, d: any) => ({ id, ...d })),
  deleteGroup: vi.fn(async () => {}),
}));
vi.mock('../../services/ProjectGroupService', async (orig) => ({ ...(await orig<any>()), projectGroupService: svc }));
vi.mock('../../services/ClientService', () => ({
  clientService: {},
  ClientNotFoundError: class ClientNotFoundError extends Error {},
}));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []) } }));

import { projectGroupRoutes } from '../../routes/core/projectGroups';

describe('rename / delete / reorder a client', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(projectGroupRoutes, { prefix: '/api/v1/project-groups' }); }, 60_000);
  beforeEach(() => vi.clearAllMocks());

  const rename = () => app.inject({ method: 'PUT', url: '/api/v1/project-groups/g1', payload: { name: 'Acme Ltd' } });
  const remove = () => app.inject({ method: 'DELETE', url: '/api/v1/project-groups/g1' });

  it('the PMO (and so the company owner) can rename and delete any client', async () => {
    who.user = { userId: 'boss', role: 'pmo' };
    expect((await rename()).statusCode).toBe(200);
    expect((await remove()).statusCode).toBe(200);
    expect(svc.deleteGroup).toHaveBeenCalledWith('g1');
  });

  it('the project manager who added the client can rename and delete it', async () => {
    who.user = { userId: 'pm-alice', role: 'project_manager' };
    expect((await rename()).statusCode).toBe(200);
    expect((await remove()).statusCode).toBe(200);
  });

  it("another project manager is refused with a plain message; nothing changes", async () => {
    who.user = { userId: 'pm-bob', role: 'project_manager' };
    const r = await rename();
    expect(r.statusCode).toBe(403);
    expect(r.json().message).toMatch(/project manager who added this client/);
    expect((await remove()).statusCode).toBe(403);
    expect(svc.updateGroup).not.toHaveBeenCalled();
    expect(svc.deleteGroup).not.toHaveBeenCalled();
  });

  it('a team member is refused before anything is read', async () => {
    who.user = { userId: 'tm', role: 'team_member' };
    expect((await remove()).statusCode).toBe(403);
    expect(svc.getGroup).not.toHaveBeenCalled();
  });

  it('a client that no longer exists: 404', async () => {
    who.user = { userId: 'boss', role: 'pmo' };
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/project-groups/g-gone' })).statusCode).toBe(404);
  });

  describe('reorder (user decision 2026-10-11: same rule as rename/delete)', () => {
    const reorder = (orderedIds: string[]) => app.inject({ method: 'PUT', url: '/api/v1/project-groups/reorder', payload: { orderedIds } });

    it('the PMO can reorder every client', async () => {
      who.user = { userId: 'boss', role: 'pmo' };
      expect((await reorder(['g3', 'g2', 'g1'])).statusCode).toBe(200);
      expect(svc.reorderGroups).toHaveBeenCalledWith(['g3', 'g2', 'g1']);
    });

    it('a project manager can move the clients they added', async () => {
      who.user = { userId: 'pm-alice', role: 'project_manager' };
      // full list Acme(alice) · Globex(bob) · Initech(alice): alice swaps her two; Globex stays 2nd
      expect((await reorder(['g3', 'g1'])).statusCode).toBe(200);
      expect(svc.reorderGroups).toHaveBeenCalledWith(['g3', 'g2', 'g1']);
    });

    it('a short list never collides with the others: everyone gets a distinct place', async () => {
      who.user = { userId: 'pm-alice', role: 'project_manager' };
      await reorder(['g3']);
      const sent = svc.reorderGroups.mock.calls[0][0] as string[];
      expect(sent).toEqual(['g1', 'g2', 'g3']); // nothing to swap with: unchanged, all three placed
      expect(new Set(sent).size).toBe(3);
    });

    it("a list naming another PM's client is refused in words; nothing moves", async () => {
      who.user = { userId: 'pm-alice', role: 'project_manager' };
      const r = await reorder(['g2', 'g1']);
      expect(r.statusCode).toBe(403);
      expect(r.json().message).toMatch(/move it in the list/);
      expect(svc.reorderGroups).not.toHaveBeenCalled();
    });
  });
});
