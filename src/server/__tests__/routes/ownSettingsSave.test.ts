import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Your own settings are personal (2026-10-08): a team member, viewer or executive — who may only
 * read project data — still saves their OWN notifications, time zone, accessibility, dashboard and
 * screen settings. The real scope check runs here; the role comes from the x-test-role header.
 */
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => { req.user = { userId: req.headers['x-test-user'] ?? 'u-team', role: req.headers['x-test-role'] }; }),
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const users = vi.hoisted(() => ({ getViewPrefs: vi.fn(), mergeViewPrefs: vi.fn(), update: vi.fn(), updateAccessibilityPrefs: vi.fn(), updateDashboardPrefs: vi.fn() }));
vi.mock('../../services/UserService', () => ({ userService: users }));
vi.mock('../../services/OrganizationService', () => ({ organizationService: {} }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: {} }));

import { userRoutes } from '../../routes/core/users';

describe('PUT /users/me/view-preferences', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(userRoutes, { prefix: '/api/v1/users' }); }, 60_000);
  beforeEach(() => {
    users.getViewPrefs.mockReset().mockResolvedValue({ theme: 'light' });
    users.mergeViewPrefs.mockReset().mockImplementation(async (_u: string, c: any) => ({ theme: 'light', ...c }));
    users.update.mockReset().mockResolvedValue({});
    users.updateAccessibilityPrefs.mockReset().mockResolvedValue(undefined);
    users.updateDashboardPrefs.mockReset().mockResolvedValue(undefined);
  });

  const put = (role: string, body: unknown, user = 'u-team') =>
    app.inject({ method: 'PUT', url: '/api/v1/users/me/view-preferences', headers: { 'x-test-role': role, 'x-test-user': user }, payload: body });

  it.each(['team_member', 'viewer', 'executive', 'project_manager'])('%s saves their own preferences', async role => {
    const res = await put(role, { sidebarCollapsed: true });
    expect(res.statusCode).toBe(200);
    expect(res.json().preferences).toEqual({ theme: 'light', sidebarCollapsed: true });
  });

  it("only ever writes the signed-in user's row — the body cannot name another user", async () => {
    const res = await put('team_member', { sidebarCollapsed: true, userId: 'someone-else', id: 'someone-else' }, 'u-me');
    expect(res.statusCode).toBe(200);
    // only the change goes down; the database merges it (two tabs no longer lose a change)
    expect(users.mergeViewPrefs).toHaveBeenCalledWith('u-me', { sidebarCollapsed: true });
  });

  it('still validates what is saved', async () => {
    const res = await put('team_member', { theme: 'purple' });
    expect(res.statusCode).toBe(400);
    expect(users.mergeViewPrefs).not.toHaveBeenCalled();
  });

  it('there is no route that takes another user id', async () => {
    const res = await app.inject({ method: 'PUT', url: '/api/v1/users/u-other/view-preferences', headers: { 'x-test-role': 'team_member' }, payload: {} });
    expect(res.statusCode).toBe(404);
  });
});

describe('the other own-settings routes', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(userRoutes, { prefix: '/api/v1/users' }); }, 60_000);
  beforeEach(() => {
    users.update.mockReset().mockResolvedValue({});
    users.updateAccessibilityPrefs.mockReset().mockResolvedValue(undefined);
    users.updateDashboardPrefs.mockReset().mockResolvedValue(undefined);
  });

  // each route, a valid body (with a stray id that must be ignored), and the service call that saves it
  const ROUTES: Array<[string, Record<string, unknown>, () => any, unknown[]]> = [
    ['notification-preferences', { digestFrequency: 'weekly', userId: 'someone-else' }, () => users.update, ['u-me', { digestFrequency: 'weekly' }]],
    ['preferences', { timezone: 'America/Toronto', id: 'someone-else' }, () => users.update, ['u-me', { timezone: 'America/Toronto' }]],
    ['accessibility', { reducedMotion: true, userId: 'someone-else' }, () => users.updateAccessibilityPrefs, ['u-me', { reducedMotion: true }]],
    ['dashboard-preferences', { enabledWidgets: ['kpi'], widgetOrder: ['kpi'], scope: 'mine', userId: 'someone-else' }, () => users.updateDashboardPrefs, ['u-me', { enabledWidgets: ['kpi'], widgetOrder: ['kpi'], scope: 'mine' }]],
  ];

  describe.each(['team_member', 'viewer'])('as %s', role => {
    it.each(ROUTES)('PUT /me/%s saves their own row only', async (route, body, saver, args) => {
      const res = await app.inject({ method: 'PUT', url: `/api/v1/users/me/${route}`, headers: { 'x-test-role': role, 'x-test-user': 'u-me' }, payload: body });
      expect(res.statusCode).toBe(200);
      expect(saver()).toHaveBeenCalledTimes(1);
      expect(saver()).toHaveBeenCalledWith(...args);
    });
  });
});
