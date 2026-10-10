import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';

/**
 * Screens show change buttons from GET /projects/:id/members/me → canEdit. A team member or
 * viewer made the project's Manager got canEdit true, but the change routes also need the
 * 'write' right, so every save was refused (audit 2 review, 2026-10-10). canEdit now needs both;
 * isManager (the project role alone) keeps the Manager's read-only views.
 */
const who = vi.hoisted(() => ({ user: { userId: 'u1', role: 'team_member' } as any, keyScopes: undefined as string[] | undefined, manager: true }));
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => { req.user = who.user; req.apiKeyScopes = who.keyScopes; }),
}));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: () => vi.fn(async () => {}),
  checkProjectRole: vi.fn(async () => (who.manager ? { ok: true, membership: { role: 'manager' } } : { ok: false, status: 403, body: {} })),
}));
vi.mock('../../services/ProjectMemberService', () => ({ projectMemberService: {}, LastOwnerError: class extends Error {} }));
vi.mock('../../services/ProjectService', () => ({ projectService: {} }));
vi.mock('../../services/EmailService', () => ({ emailService: {} }));
vi.mock('../../services/NotificationService', () => ({ notificationService: {} }));
vi.mock('../../services/UserService', () => ({ userService: {} }));

import { projectMemberRoutes } from '../../routes/core/projectMembers';

describe('GET /projects/:id/members/me — canEdit', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(projectMemberRoutes, { prefix: '/api/v1/projects' }); }, 60_000);
  const me = async () => (await app.inject({ method: 'GET', url: '/api/v1/projects/p1/members/me' })).json();

  it.each(['team_member', 'viewer', 'executive'])("a %s who is the project's Manager: Manager, but can't edit", async (role) => {
    who.user = { userId: 'u1', role }; who.keyScopes = undefined; who.manager = true;
    const r = await me();
    expect(r.role).toBe('manager');
    expect(r.isManager).toBe(true); // still sees the Manager's read views (RAID Review, weekly review) and flags time
    expect(r.canEdit).toBe(false);
    expect(r.canManageOwners).toBe(false);
  });

  it("a project manager who is the project's Manager can edit; through a read-only key, can't", async () => {
    who.user = { userId: 'u1', role: 'project_manager' }; who.manager = true;
    who.keyScopes = undefined;
    expect(await me()).toMatchObject({ isManager: true, canEdit: true });
    who.keyScopes = ['read'];
    expect((await me()).canEdit).toBe(false);
  });

  it('a project manager who is only a viewer on this project: no edit', async () => {
    who.user = { userId: 'u1', role: 'project_manager' }; who.keyScopes = undefined; who.manager = false;
    expect(await me()).toMatchObject({ isManager: false, canEdit: false });
  });
});
