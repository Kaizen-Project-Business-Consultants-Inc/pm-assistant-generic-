import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A project's team (U8): picked from its client's pool or My resources; joining gives a person
 * who can sign in a Viewer membership, and leaving takes away only a membership the team gave.
 */

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));
const members = vi.hoisted(() => ({ findMembership: vi.fn(), insert: vi.fn(), deleteViewers: vi.fn() }));
vi.mock('../../database/ProjectMemberRepository', () => ({ projectMemberRepository: members }));
const resources = vi.hoisted(() => ({ findById: vi.fn(), findByIds: vi.fn() }));
vi.mock('../../database/ResourceRepository', () => ({ resourceRepository: resources }));

import { projectTeamService, TeamPoolError } from '../../services/ProjectTeamService';

const projectOf = (clientId: string | null) => (sql: string) =>
  sql.includes('FROM projects p LEFT JOIN project_groups') ? [{ group_id: clientId, name: clientId ? 'Acme' : null }] : [];

describe('ProjectTeamService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.query.mockImplementation(async (sql: string) => projectOf('c1')(sql));
  });

  it("refuses someone from another client's pool", async () => {
    resources.findById.mockResolvedValue({ id: 'r1', clientId: 'c2', userId: null });
    await expect(projectTeamService.add('p1', 'r1', null, 'u-pm')).rejects.toThrow(TeamPoolError);
  });

  it('adding someone who can sign in gives them Viewer, and records that the team gave it', async () => {
    resources.findById.mockResolvedValue({ id: 'r1', clientId: 'c1', userId: 'u1', name: 'Ann', email: 'a@x.test' });
    members.findMembership.mockResolvedValue(undefined);
    await projectTeamService.add('p1', 'r1', null, 'u-pm');
    const insert = db.query.mock.calls.find(c => String(c[0]).startsWith('INSERT INTO project_team'))!;
    expect(insert[1]).toEqual(['p1', 'r1', null, 'u-pm', 1]);
    expect(members.insert).toHaveBeenCalledWith('p1', expect.objectContaining({ userId: 'u1', role: 'viewer' }));
  });

  it('someone already on the project keeps their membership (granted_view 0)', async () => {
    resources.findById.mockResolvedValue({ id: 'r1', clientId: null, userId: 'u1', name: 'Ann', email: 'a@x.test' });
    members.findMembership.mockResolvedValue({ id: 'm1', role: 'viewer' });
    await projectTeamService.add('p1', 'r1', null, 'u-pm');
    const insert = db.query.mock.calls.find(c => String(c[0]).startsWith('INSERT INTO project_team'))!;
    expect(insert[1][4]).toBe(0);
    expect(members.insert).not.toHaveBeenCalled();
  });

  it('removing takes away a Viewer membership the team gave', async () => {
    db.query.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT project_id, resource_id, granted_view') ? [{ project_id: 'p1', resource_id: 'r1', granted_view: 1 }] : []);
    resources.findByIds.mockResolvedValue([{ id: 'r1', userId: 'u1' }]);
    await projectTeamService.remove('p1', 'r1');
    expect(members.deleteViewers).toHaveBeenCalledWith([{ projectId: 'p1', userId: 'u1' }]);
  });

  it("removing never touches a membership the PM gave separately", async () => {
    db.query.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT project_id, resource_id, granted_view') ? [{ project_id: 'p1', resource_id: 'r1', granted_view: 0 }] : []);
    await projectTeamService.remove('p1', 'r1');
    expect(members.deleteViewers).not.toHaveBeenCalled();
  });

  it("removing someone not on this project's team is refused", async () => {
    db.query.mockResolvedValue([]);
    await expect(projectTeamService.remove('p1', 'r-elsewhere')).rejects.toThrow(TeamPoolError);
  });

  it("a project moving client drops the old client's people (and the viewing the team gave)", async () => {
    db.query.mockImplementation(async (sql: string) =>
      sql.includes('NOT (r.client_id <=> p.group_id)') ? [{ project_id: 'p1', resource_id: 'r-old', granted_view: 1 }] : []);
    resources.findByIds.mockResolvedValue([{ id: 'r-old', userId: 'u-old' }]);
    await projectTeamService.dropOutsidePool('p1');
    expect(db.query).toHaveBeenCalledWith('DELETE FROM project_team WHERE (project_id, resource_id) IN ((?, ?))', ['p1', 'r-old']);
    expect(members.deleteViewers).toHaveBeenCalledWith([{ projectId: 'p1', userId: 'u-old' }]);
  });

  it('a person with no login loses only the team row', async () => {
    db.query.mockImplementation(async (sql: string) =>
      sql.includes('NOT (r.client_id <=> p.group_id)') ? [{ project_id: 'p1', resource_id: 'r1', granted_view: 1 }] : []);
    resources.findByIds.mockResolvedValue([{ id: 'r1', userId: null }]);
    await projectTeamService.dropPersonOutsidePool('r1');
    expect(members.deleteViewers).toHaveBeenCalledWith([]);
  });
});
