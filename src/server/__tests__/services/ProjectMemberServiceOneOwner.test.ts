import { describe, it, expect, vi, beforeEach } from 'vitest';

/** One Owner per project (2026-10-29). Projects that already have several keep them; handing a project over is allowed. */
const h = vi.hoisted(() => ({ members: [] as any[], updated: [] as Array<[string, string]>, inserted: [] as any[] }));
vi.mock('../../database/ProjectMemberRepository', () => ({
  projectMemberRepository: {
    findByProjectId: vi.fn(async () => h.members),
    findMembership: vi.fn(async (_p: string, u: string) => h.members.find(m => m.userId === u)),
    findById: vi.fn(async (id: string) => h.members.find(m => m.id === id)),
    countOwners: vi.fn(async () => h.members.filter(m => m.role === 'owner').length),
    insert: vi.fn(async (_p: string, d: any) => { const row = { id: `m-${d.userId}`, projectId: 'p1', ...d }; h.inserted.push(row); return row; }),
    updateRole: vi.fn(async (id: string, role: string) => { h.updated.push([id, role]); }),
  },
}));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []) } }));

import { projectMemberService, OneOwnerError, LastOwnerError } from '../../services/ProjectMemberService';

beforeEach(() => {
  h.updated = []; h.inserted = [];
  h.members = [
    { id: 'm-dana', projectId: 'p1', userId: 'dana', role: 'owner' },
    { id: 'm-sam', projectId: 'p1', userId: 'sam', role: 'viewer' },
  ];
});

describe('one Owner per project', () => {
  it('refuses a second Owner, whether the person is new or already on the team', async () => {
    await expect(projectMemberService.addMember('p1', { userId: 'new', userName: 'N', email: 'n@x.io', role: 'owner' })).rejects.toBeInstanceOf(OneOwnerError);
    await expect(projectMemberService.updateRole('m-sam', 'owner')).rejects.toBeInstanceOf(OneOwnerError);
    expect(h.inserted).toHaveLength(0);
    expect(h.updated).toHaveLength(0);
  });

  it('still allows the first Owner (a new project) and everything that is not Owner', async () => {
    h.members = [];
    await expect(projectMemberService.addMember('p1', { userId: 'dana', userName: 'D', email: 'd@x.io', role: 'owner' })).resolves.toBeTruthy();
    h.members = [{ id: 'm-dana', projectId: 'p1', userId: 'dana', role: 'owner' }];
    await expect(projectMemberService.addMember('p1', { userId: 'x', userName: 'X', email: 'x@x.io', role: 'manager' })).resolves.toBeTruthy();
  });

  it('an Owner can be re-saved as Owner (no change), and the last Owner still cannot be demoted', async () => {
    await expect(projectMemberService.updateRole('m-dana', 'owner')).resolves.toBeTruthy();
    await expect(projectMemberService.updateRole('m-dana', 'manager')).rejects.toBeInstanceOf(LastOwnerError);
  });

  it('a project that already has two Owners keeps them: either can be demoted', async () => {
    h.members.push({ id: 'm-lee', projectId: 'p1', userId: 'lee', role: 'owner' });
    await expect(projectMemberService.updateRole('m-lee', 'manager')).resolves.toBeTruthy();
  });
});

describe('handing the project to a new Owner', () => {
  it('makes the new person Owner and the old Owner a Manager', async () => {
    const r = await projectMemberService.reassignOwner('p1', { userId: 'sam', userName: 'Sam', email: 's@x.io' });
    expect(r.owner.role).toBe('owner');
    expect(r.previousOwners.map(o => o.userId)).toEqual(['dana']);
    expect(h.updated).toEqual(expect.arrayContaining([['m-sam', 'owner'], ['m-dana', 'manager']]));
  });

  it('works for someone not yet on the team', async () => {
    await projectMemberService.reassignOwner('p1', { userId: 'new', userName: 'N', email: 'n@x.io' });
    expect(h.inserted[0]).toMatchObject({ userId: 'new', role: 'owner' });
    expect(h.updated).toContainEqual(['m-dana', 'manager']);
  });

  it('refuses someone who has not registered yet', async () => {
    await expect(projectMemberService.reassignOwner('p1', { userId: 'pending_abc', userName: 'P', email: 'p@x.io' })).rejects.toThrow();
  });
});
