import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requireProjectAccess } from '../../middleware/requireProjectAccess';

// Mock dependencies
vi.mock('../../services/ProjectMemberService', () => ({
  projectMemberService: {
    findMembership: vi.fn(),
  },
}));

vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findById: vi.fn(),
  },
}));

vi.mock('../../services/ProjectService', () => ({
  projectService: {
    findById: vi.fn(),
  },
}));

import { projectMemberService } from '../../services/ProjectMemberService';
import { scheduleService } from '../../services/ScheduleService';
import { projectService } from '../../services/ProjectService';

const mockFindMembership = projectMemberService.findMembership as ReturnType<typeof vi.fn>;
const mockScheduleFindById = (scheduleService as any).findById as ReturnType<typeof vi.fn>;
const mockProjectFindById = (projectService as any).findById as ReturnType<typeof vi.fn>;

function makeRequest(overrides: any = {}) {
  return {
    user: overrides.user ?? { userId: 'u1', username: 'test', role: 'team_member' },
    params: overrides.params ?? {},
    body: overrides.body ?? undefined,
    routeOptions: overrides.routeOptions ?? {},
    ...overrides,
  } as any;
}

function makeReply() {
  const reply: any = { statusCode: 200, body: null };
  reply.status = vi.fn((code: number) => { reply.statusCode = code; return reply; });
  reply.send = vi.fn((body: any) => { reply.body = body; return reply; });
  return reply;
}

function makeMembership(role: string, overrides: any = {}) {
  return {
    id: 'pm1',
    projectId: 'proj1',
    userId: 'u1',
    userName: 'Test User',
    email: 'test@test.com',
    role,
    addedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: project not found (non-creator) — ensures 404 for non-members
  mockProjectFindById.mockResolvedValue(null);
});

describe('requireProjectAccess', () => {
  // -----------------------------------------------------------------------
  // Project ID extraction
  // -----------------------------------------------------------------------
  describe('extractProjectId', () => {
    it('extracts projectId from params.projectId', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({ params: { projectId: 'proj1' } });
      const reply = makeReply();
      mockFindMembership.mockResolvedValue(makeMembership('viewer'));

      await handler(req, reply);

      expect(mockFindMembership).toHaveBeenCalledWith('proj1', 'u1');
    });

    it('resolves projectId from scheduleId via DB lookup', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({ params: { scheduleId: 'sched1' } });
      const reply = makeReply();
      mockScheduleFindById.mockResolvedValue({ id: 'sched1', projectId: 'proj-from-sched' });
      mockFindMembership.mockResolvedValue(makeMembership('viewer'));

      await handler(req, reply);

      expect(mockScheduleFindById).toHaveBeenCalledWith('sched1');
      expect(mockFindMembership).toHaveBeenCalledWith('proj-from-sched', 'u1');
    });

    it('returns 404 when scheduleId does not resolve to a project', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({ params: { scheduleId: 'bad-sched' } });
      const reply = makeReply();
      mockScheduleFindById.mockResolvedValue(null);
      mockFindMembership.mockResolvedValue(null);

      await handler(req, reply);

      // A named schedule that doesn't exist here (e.g. another company's) → "not found".
      // It used to fall through as "no project context", answering an empty result.
      expect(reply.status).toHaveBeenCalledWith(404);
    });

    it('extracts projectId from params.id on project routes', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({
        params: { id: 'proj-by-id' },
        routeOptions: { url: '/api/v1/projects/:id' },
      });
      const reply = makeReply();
      mockFindMembership.mockResolvedValue(makeMembership('viewer'));

      await handler(req, reply);

      expect(mockFindMembership).toHaveBeenCalledWith('proj-by-id', 'u1');
    });

    it('does NOT use params.id on non-project routes', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({
        params: { id: 'some-id' },
        routeOptions: { url: '/api/v1/resources/:id' },
      });
      const reply = makeReply();

      await handler(req, reply);

      // No project context found → skip
      expect(mockFindMembership).not.toHaveBeenCalled();
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('extracts projectId from request body', async () => {
      const handler = requireProjectAccess('editor');
      const req = makeRequest({ body: { projectId: 'proj-body' } });
      const reply = makeReply();
      mockFindMembership.mockResolvedValue(makeMembership('editor'));

      await handler(req, reply);

      expect(mockFindMembership).toHaveBeenCalledWith('proj-body', 'u1');
    });

    it('skips when no project context is found', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({ params: {} });
      const reply = makeReply();

      await handler(req, reply);

      expect(mockFindMembership).not.toHaveBeenCalled();
      expect(reply.status).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Global role bypasses
  // -----------------------------------------------------------------------
  describe('global role bypasses', () => {
    // the project exists in their company (a global role still needs that — see below)
    beforeEach(() => { mockProjectFindById.mockResolvedValue({ id: 'proj1', isDemo: false }); });

    it('a project that is not in their company is "not found" for PMO and executives (2026-10-06)', async () => {
      mockProjectFindById.mockResolvedValue(null);
      for (const role of ['pmo', 'executive']) {
        const handler = requireProjectAccess('viewer');
        const req = makeRequest({ user: { userId: 'u1', username: role, role }, params: { projectId: 'elsewhere' } });
        const reply = makeReply();
        await handler(req, reply);
        expect(reply.status).toHaveBeenCalledWith(404);
      }
    });

    it('admin bypasses all access checks', async () => {
      for (const minRole of ['viewer', 'editor', 'manager', 'owner'] as const) {
        const handler = requireProjectAccess(minRole);
        const req = makeRequest({
          user: { userId: 'u1', username: 'admin', role: 'admin' },
          params: { projectId: 'proj1' },
        });
        const reply = makeReply();

        await handler(req, reply);

        expect(mockFindMembership).not.toHaveBeenCalled();
        expect(reply.status).not.toHaveBeenCalled();
      }
    });

    it('pmo bypasses all access checks', async () => {
      for (const minRole of ['viewer', 'editor', 'manager', 'owner'] as const) {
        const handler = requireProjectAccess(minRole);
        const req = makeRequest({
          user: { userId: 'u1', username: 'pmo', role: 'pmo' },
          params: { projectId: 'proj1' },
        });
        const reply = makeReply();

        await handler(req, reply);

        expect(mockFindMembership).not.toHaveBeenCalled();
        expect(reply.status).not.toHaveBeenCalled();
      }
    });

    it('executive bypasses viewer-level checks (read-only)', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({
        user: { userId: 'u1', username: 'exec', role: 'executive' },
        params: { projectId: 'proj1' },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(mockFindMembership).not.toHaveBeenCalled();
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('executive is denied change (manager-level) access', async () => {
      const handler = requireProjectAccess('manager');
      const req = makeRequest({
        user: { userId: 'u1', username: 'exec', role: 'executive' },
        params: { projectId: 'proj1' },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.body.message).toContain('view projects but not change them');
    });

    it('executive is denied manager-level access', async () => {
      const handler = requireProjectAccess('manager');
      const req = makeRequest({
        user: { userId: 'u1', username: 'exec', role: 'executive' },
        params: { projectId: 'proj1' },
      });
      const reply = makeReply();

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
    });
  });

  // -----------------------------------------------------------------------
  // Membership checks
  // -----------------------------------------------------------------------
  describe('membership enforcement', () => {
    it('returns 404 for non-members (prevents info leakage)', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({ params: { projectId: 'proj1' } });
      const reply = makeReply();
      mockFindMembership.mockResolvedValue(undefined);

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(404);
      expect(reply.body.error).toBe('Not found');
    });

    it('grants owner access to project creator without membership row', async () => {
      const handler = requireProjectAccess('manager');
      const req = makeRequest({ params: { projectId: 'proj1' } });
      const reply = makeReply();
      mockFindMembership.mockResolvedValue(undefined);
      mockProjectFindById.mockResolvedValue({ id: 'proj1', createdBy: 'u1' });

      await handler(req, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('allows member with exact required role', async () => {
      const handler = requireProjectAccess('manager');
      const req = makeRequest({ params: { projectId: 'proj1' } });
      const reply = makeReply();
      mockFindMembership.mockResolvedValue(makeMembership('manager'));

      await handler(req, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('allows member with higher role than required', async () => {
      const handler = requireProjectAccess('manager');
      const req = makeRequest({ params: { projectId: 'proj1' } });
      const reply = makeReply();
      mockFindMembership.mockResolvedValue(makeMembership('owner'));

      await handler(req, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });

    it('denies member with lower role than required', async () => {
      const handler = requireProjectAccess('manager');
      const req = makeRequest({ params: { projectId: 'proj1' } });
      const reply = makeReply();
      mockFindMembership.mockResolvedValue(makeMembership('viewer'));

      await handler(req, reply);

      expect(reply.status).toHaveBeenCalledWith(403);
      expect(reply.body.error).toBe('Insufficient project role');
      expect(reply.body.message).toBe("Only the project's Manager or Owner can change this.");
    });

    it('attaches membership to request on success', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({ params: { projectId: 'proj1' } });
      const reply = makeReply();
      const membership = makeMembership('manager');
      mockFindMembership.mockResolvedValue(membership);

      await handler(req, reply);

      expect(req.projectMembership).toEqual(membership);
    });
  });

  // -----------------------------------------------------------------------
  // Role hierarchy matrix
  // -----------------------------------------------------------------------
  describe('role hierarchy', () => {
    const projectRoles = ['viewer', 'editor', 'manager', 'owner'] as const;
    // Editor was removed (Sep 2026): it is read-only, the same as Viewer
    const hierarchy: Record<string, number> = { viewer: 1, editor: 1, manager: 3, owner: 4 };

    for (const memberRole of projectRoles) {
      for (const requiredRole of projectRoles) {
        const shouldAllow = hierarchy[memberRole] >= hierarchy[requiredRole];
        it(`${memberRole} ${shouldAllow ? 'can' : 'cannot'} access ${requiredRole}-level routes`, async () => {
          const handler = requireProjectAccess(requiredRole);
          const req = makeRequest({ params: { projectId: 'proj1' } });
          const reply = makeReply();
          mockFindMembership.mockResolvedValue(makeMembership(memberRole));

          await handler(req, reply);

          if (shouldAllow) {
            expect(reply.status).not.toHaveBeenCalled();
          } else {
            expect(reply.status).toHaveBeenCalledWith(403);
          }
        });
      }
    }
  });

  // -----------------------------------------------------------------------
  // Default minRole
  // -----------------------------------------------------------------------
  describe('default minRole', () => {
    it('defaults to viewer when no minRole is specified', async () => {
      const handler = requireProjectAccess();
      const req = makeRequest({ params: { projectId: 'proj1' } });
      const reply = makeReply();
      mockFindMembership.mockResolvedValue(makeMembership('viewer'));

      await handler(req, reply);

      expect(reply.status).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Priority of extraction sources
  // -----------------------------------------------------------------------
  describe('extraction priority', () => {
    it('params.projectId takes precedence over body.projectId', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({
        params: { projectId: 'from-params' },
        body: { projectId: 'from-body' },
      });
      const reply = makeReply();
      mockFindMembership.mockResolvedValue(makeMembership('viewer'));

      await handler(req, reply);

      expect(mockFindMembership).toHaveBeenCalledWith('from-params', 'u1');
    });

    it('params.scheduleId takes precedence over body.projectId', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({
        params: { scheduleId: 'sched1' },
        body: { projectId: 'from-body' },
      });
      const reply = makeReply();
      mockScheduleFindById.mockResolvedValue({ id: 'sched1', projectId: 'from-schedule' });
      mockFindMembership.mockResolvedValue(makeMembership('viewer'));

      await handler(req, reply);

      expect(mockFindMembership).toHaveBeenCalledWith('from-schedule', 'u1');
    });
  });

  // -----------------------------------------------------------------------
  // Sep 2026: changes must name a project; several projects all checked
  // -----------------------------------------------------------------------
  describe('changes fail closed', () => {
    it('refuses a change when the project cannot be determined (used to skip the check)', async () => {
      const handler = requireProjectAccess('manager');
      const req = makeRequest({ params: {}, body: {} });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.status).toHaveBeenCalledWith(400);
      expect(reply.body.error).toBe('project_unknown');
    });

    it('still lets read-only list routes through without a project', async () => {
      const handler = requireProjectAccess('viewer');
      const req = makeRequest({ params: {}, body: {} });
      const reply = makeReply();
      await handler(req, reply);
      expect(reply.status).not.toHaveBeenCalled();
    });

    it('checks every project a request names (bulk tools spanning schedules)', async () => {
      const handler = requireProjectAccess('manager', { resolve: async () => ['pA', 'pB'] });
      const req = makeRequest({ params: {} });
      const reply = makeReply();
      mockFindMembership.mockImplementation(async (projectId: string) => makeMembership(projectId === 'pA' ? 'manager' : 'viewer'));
      await handler(req, reply);
      expect(reply.status).toHaveBeenCalledWith(403); // manager on A is not enough when B is also touched
    });

    it('an Editor can no longer change anything', async () => {
      const handler = requireProjectAccess('manager');
      const req = makeRequest({ params: { projectId: 'proj1' } });
      const reply = makeReply();
      mockFindMembership.mockResolvedValue(makeMembership('editor'));
      await handler(req, reply);
      expect(reply.status).toHaveBeenCalledWith(403);
    });
  });
});
