import { describe, it, expect, vi, beforeEach } from 'vitest';

/** The Get started card's steps (U42/U47/U48, 2026-10-19): what counts as done, from your own data only */
const db = vi.hoisted(() => ({
  tenant: [] as Array<{ sql: string; params: any[] }>,
  cp: [] as Array<{ sql: string; params: any[] }>,
  project: null as null | { id: string },
  people: 0,
  tasks: 0,
  others: 0,
}));
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn(async (sql: string, params: any[]) => {
      db.tenant.push({ sql, params });
      if (sql.includes('FROM projects')) return db.project ? [db.project] : [];
      if (sql.includes('project_members')) return [{ n: db.people }];
      return [{ n: db.tasks }];
    }),
    queryControlPlane: vi.fn(async (sql: string, params: any[]) => { db.cp.push({ sql, params }); return [{ n: db.others }]; }),
  },
}));
const org = vi.hoisted(() => ({ value: null as any }));
vi.mock('../../services/OrganizationService', () => ({
  organizationService: { findByUserId: vi.fn(async () => org.value) },
}));

import { getStartedState } from '../../services/getStartedState';

beforeEach(() => {
  Object.assign(db, { tenant: [], cp: [], project: null, people: 0, tasks: 0, others: 0 });
  org.value = { id: 'org-1', ownerUserId: 'u1', billingModel: 'per_seat' };
});

describe('getStartedState', () => {
  it('a brand-new Team-plan owner: may invite, nothing done yet', async () => {
    expect(await getStartedState('u1')).toEqual({
      canInvite: true, invited: false, firstProjectId: null, projectHasPeople: false, projectHasTasks: false,
    });
  });

  it('each step is done once its data exists', async () => {
    Object.assign(db, { others: 2, project: { id: 'p1' }, people: 1, tasks: 1 });
    expect(await getStartedState('u1')).toEqual({
      canInvite: true, invited: true, firstProjectId: 'p1', projectHasPeople: true, projectHasTasks: true,
    });
  });

  it('only the owner on a per-seat plan gets the invite step', async () => {
    org.value = { id: 'org-1', ownerUserId: 'someone-else', billingModel: 'per_seat' };
    expect((await getStartedState('u1')).canInvite).toBe(false);
    org.value = { id: 'org-1', ownerUserId: 'u1', billingModel: 'flat' };
    expect((await getStartedState('u1')).canInvite).toBe(false);
  });

  it('no company (the platform admin): nothing is read — there is no company database', async () => {
    org.value = null;
    db.project = { id: 'p1' };
    expect(await getStartedState('u1')).toEqual({
      canInvite: false, invited: false, firstProjectId: null, projectHasPeople: false, projectHasTasks: false,
    });
    expect(db.tenant).toHaveLength(0);
    expect(db.cp).toHaveLength(0);
  });

  it('reads only your own: your projects (not the sample or archived ones), your company, others on the project', async () => {
    db.project = { id: 'p1' };
    await getStartedState('u1');
    expect(db.tenant[0].sql).toMatch(/created_by = \? AND is_demo = 0 AND archived_at IS NULL/);
    expect(db.tenant[0].params).toEqual(['u1']);
    expect(db.tenant[1].params).toEqual(['p1', 'u1']);
    expect(db.cp[0].params).toEqual(['org-1', 'u1']);
  });
});
