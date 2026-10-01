import { describe, it, expect, vi } from 'vitest';

/**
 * readableProjectJoin (2026-10-01): the Morning Briefing and the dashboard widgets limit their
 * queries to the projects a person can read — created, member of, or the sample project — the
 * same rule as the dashboard's project list. They used membership only, so the sample project
 * was listed on the dashboard but missing from the briefing ("no active projects yet").
 */
const list = vi.hoisted(() => vi.fn());
vi.mock('../../services/ProjectService', () => ({ projectService: { findByUserId: list } }));
vi.mock('../../services/UserService', () => ({ userService: {} }));

import { readableProjectJoin } from '../../utils/readableProjects';

describe('readableProjectJoin', () => {
  it('limits to the readable projects (incl. one you are not a member of) and joins your membership', async () => {
    list.mockResolvedValueOnce([{ id: 'own' }, { id: 'sample' }]);
    const { join, params } = await readableProjectJoin({ userId: 'u1', role: 'project_manager' }, false);
    expect(join).toContain('rp0.id IN (?,?)');
    expect(join).toContain('LEFT JOIN project_members pm ON pm.project_id = p.id AND pm.user_id = ?');
    expect(params).toEqual(['own', 'sample', 'u1']);
  });

  it('nothing readable → matches nothing (never everything)', async () => {
    list.mockResolvedValueOnce([]);
    const { join, params } = await readableProjectJoin({ userId: 'u1', role: 'team_member' }, false);
    expect(join).toContain('ON 1 = 0');
    expect(params).toEqual(['u1']);
  });

  it('admin / PMO / executive see every project: no limit', async () => {
    expect(await readableProjectJoin({ userId: 'u1', role: 'admin' }, true)).toEqual({ join: '', params: [] });
    expect(await readableProjectJoin({ userId: 'u1', role: 'pmo' }, false)).toEqual({ join: '', params: [] });
  });

  it('another table alias', async () => {
    list.mockResolvedValueOnce([{ id: 'own' }]);
    const { join } = await readableProjectJoin({ userId: 'u1', role: 'project_manager' }, false, 'proj');
    expect(join).toContain('rp.rp_id = proj.id');
  });
});
