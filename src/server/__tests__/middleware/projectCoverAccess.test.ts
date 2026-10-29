import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Temporary cover for a project's Owner (2026-10-29): someone covering today may change THAT project
 * (a Manager there, never Owner), whatever their account type; nothing else changes for them.
 */
const state = vi.hoisted(() => ({
  covers: new Map<string, any>(),          // `${projectId}:${userId}` → cover row
  hasOwner: false,
}));
vi.mock('../../services/ProjectMemberService', () => ({ projectMemberService: { findMembership: vi.fn(), findByUserId: vi.fn(async () => []) } }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { findById: vi.fn(async (id: string) => (id === 's1' ? { projectId: 'p1' } : null)) } }));
vi.mock('../../services/ProjectService', () => ({ projectService: { findById: vi.fn(async (id: string) => ({ id, createdBy: 'creator', isDemo: false })) } }));
vi.mock('../../database/ProjectMemberRepository', () => ({ projectMemberRepository: { hasOwner: vi.fn(async () => state.hasOwner) } }));
vi.mock('../../services/projectCoverAccess', () => ({
  activeCoverFor: vi.fn(async (projectId: string, userId: string) => state.covers.get(`${projectId}:${userId}`)),
  activeCoverProjectIds: vi.fn(async (userId: string) => [...state.covers.entries()].filter(([k]) => k.endsWith(`:${userId}`)).map(([k]) => k.split(':')[0])),
}));

import { checkProjectRoleFor, editableProjectIds, applyCoverRole, requireProjectAccess } from '../../middleware/requireProjectAccess';
import { projectMemberService } from '../../services/ProjectMemberService';

const findMembership = projectMemberService.findMembership as ReturnType<typeof vi.fn>;
const cover = (userId: string) => ({ id: 'c1', projectId: 'p1', ownerUserId: 'owner', coverUserId: userId, coverUserName: 'Sam', coverUserEmail: 's@x.io', startDate: '2026-11-02', endDate: '2026-11-12', startedAt: '2026-10-30 10:00:00' });

beforeEach(() => { state.covers.clear(); state.hasOwner = false; findMembership.mockReset(); findMembership.mockResolvedValue(undefined); });

describe('checkProjectRoleFor — someone covering for the Owner', () => {
  it('a viewer who covers may change the project (Manager), marked as acting', async () => {
    findMembership.mockResolvedValue({ projectId: 'p1', userId: 'sam', role: 'viewer' });
    state.covers.set('p1:sam', cover('sam'));
    const d = await checkProjectRoleFor({ userId: 'sam', role: 'viewer' }, 'p1', 'manager');
    expect(d.ok).toBe(true);
    expect((d as any).membership).toMatchObject({ role: 'manager', acting: true, coveringFor: 'owner', coverUntil: '2026-11-12' });
  });

  it('a person who is not on the project at all can still see and change it while covering', async () => {
    state.covers.set('p1:sam', cover('sam'));
    expect((await checkProjectRoleFor({ userId: 'sam', role: 'team_member' }, 'p1', 'viewer')).ok).toBe(true);
    expect((await checkProjectRoleFor({ userId: 'sam', role: 'team_member' }, 'p1', 'manager')).ok).toBe(true);
  });

  it('never Owner: the Owner-only gates (add or remove Owners, delete the project) refuse a cover', async () => {
    state.covers.set('p1:sam', cover('sam'));
    const d = await checkProjectRoleFor({ userId: 'sam', role: 'project_manager' }, 'p1', 'owner');
    expect(d.ok).toBe(false);
    expect((d as any).status).toBe(403);
  });

  it('an executive (read-only everywhere) can change only the project they cover', async () => {
    state.covers.set('p1:eve', cover('eve'));
    expect((await checkProjectRoleFor({ userId: 'eve', role: 'executive' }, 'p1', 'manager')).ok).toBe(true);
    expect((await checkProjectRoleFor({ userId: 'eve', role: 'executive' }, 'p2', 'manager')).ok).toBe(false);
  });

  it('without a cover nothing changes: a viewer stays a viewer, a non-member gets "not found"', async () => {
    findMembership.mockResolvedValueOnce({ projectId: 'p1', userId: 'sam', role: 'viewer' });
    expect((await checkProjectRoleFor({ userId: 'sam', role: 'viewer' }, 'p1', 'manager')).ok).toBe(false);
    const d = await checkProjectRoleFor({ userId: 'sam', role: 'viewer' }, 'p1', 'viewer');
    expect(d.ok).toBe(false);
    expect((d as any).status).toBe(404);
  });

  it('covering one project gives nothing on another', async () => {
    state.covers.set('p1:sam', cover('sam'));
    expect((await checkProjectRoleFor({ userId: 'sam', role: 'viewer' }, 'p2', 'viewer')).ok).toBe(false);
  });

  it('an existing Manager or Owner is not turned into a stand-in', async () => {
    findMembership.mockResolvedValue({ projectId: 'p1', userId: 'sam', role: 'owner' });
    state.covers.set('p1:sam', cover('sam'));
    const d = await checkProjectRoleFor({ userId: 'sam', role: 'project_manager' }, 'p1', 'owner');
    expect(d.ok).toBe(true);
    expect((d as any).membership.acting).toBeUndefined();
  });
});

describe('the creator is Owner only while the project has no Owner of its own', () => {
  it('a creator with no membership row is Owner when nobody else is', async () => {
    expect((await checkProjectRoleFor({ userId: 'creator', role: 'project_manager' }, 'p1', 'owner')).ok).toBe(true);
  });
  it('after the project was handed to someone else, the creator loses Owner rights', async () => {
    state.hasOwner = true;
    expect((await checkProjectRoleFor({ userId: 'creator', role: 'project_manager' }, 'p1', 'manager')).ok).toBe(false);
  });
});

describe('editableProjectIds — covered projects', () => {
  it('lists a covered project as changeable, for an account that could change nothing', async () => {
    state.covers.set('p1:sam', cover('sam'));
    const ids = await editableProjectIds({ userId: 'sam', role: 'viewer' }, [{ id: 'p1' }, { id: 'p2' }]);
    expect([...ids]).toEqual(['p1']);
    const exec = await editableProjectIds({ userId: 'sam', role: 'executive' }, [{ id: 'p1' }, { id: 'p2' }]);
    expect([...exec]).toEqual(['p1']);
  });
});

describe('applyCoverRole — a read-only account becomes a project manager for the covered project only', () => {
  const req = (o: any = {}) => ({ user: { userId: 'sam', role: 'viewer' }, params: { projectId: 'p1' }, ...o }) as any;

  it('switches the role for this request and keeps the real one', async () => {
    state.covers.set('p1:sam', cover('sam'));
    const r = req();
    expect(await applyCoverRole(r)).toBe(true);
    expect(r.user.role).toBe('project_manager');
    expect(r.user.accountRole).toBe('viewer');
  });
  it('finds the project through a schedule id too', async () => {
    state.covers.set('p1:sam', cover('sam'));
    expect(await applyCoverRole(req({ params: { scheduleId: 's1' } }))).toBe(true);
  });
  it('does nothing for another project, an API key, a guest, or someone who can already write', async () => {
    state.covers.set('p1:sam', cover('sam'));
    expect(await applyCoverRole(req({ params: { projectId: 'p2' } }))).toBe(false);
    expect(await applyCoverRole(req({ apiKeyScopes: ['write'] }))).toBe(false);
    expect(await applyCoverRole(req({ user: { userId: 'sam', role: 'viewer', isGuest: true } }))).toBe(false);
    expect(await applyCoverRole(req({ user: { userId: 'sam', role: 'project_manager' } }))).toBe(false);
  });
  it('does nothing when the request does not name a project (bulk tools stay refused)', async () => {
    state.covers.set('p1:sam', cover('sam'));
    expect(await applyCoverRole(req({ params: {} }))).toBe(false);
  });
  it('ignores a projectId the caller puts in the body (it would lift the role on any write route)', async () => {
    state.covers.set('p1:sam', cover('sam'));
    const r = req({ params: {}, body: { name: 'mine', projectId: 'p1' } });
    expect(await applyCoverRole(r)).toBe(false);
    expect(r.user.role).toBe('viewer');
  });
});

describe('requireProjectAccess — marks the request and lets the handler see a project manager', () => {
  it('a covering viewer passes the manager gate and is handled as a project manager', async () => {
    state.covers.set('p1:sam', cover('sam'));
    const r: any = { user: { userId: 'sam', role: 'viewer' }, params: { projectId: 'p1' } };
    const reply: any = { status: vi.fn(() => reply), send: vi.fn() };
    await requireProjectAccess('manager')(r, reply);
    expect(reply.status).not.toHaveBeenCalled();
    expect(r.projectMembership).toMatchObject({ acting: true, role: 'manager' });
    expect(r.user.role).toBe('project_manager');
  });
});
