import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Client resource pools (user 2026-10-14, U8): each client has its own people and rate card;
 * a project's team comes only from its client's pool or "My resources"; a client with people
 * can't be deleted; someone on the team who can sign in becomes a project member.
 */
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));
const members = vi.hoisted(() => ({ findMembership: vi.fn(), insert: vi.fn(), deleteViewers: vi.fn() }));
vi.mock('../../database/ProjectMemberRepository', () => ({ projectMemberRepository: members }));
const resources = vi.hoisted(() => ({ findById: vi.fn(), findByIds: vi.fn() }));
vi.mock('../../database/ResourceRepository', () => ({ resourceRepository: resources }));
vi.mock('../../services/ProjectService', () => ({ projectService: { invalidateCache: vi.fn() } }));
vi.mock('../../database/ProjectGroupRepository', () => ({ projectGroupRepository: { findById: vi.fn(async () => ({ id: 'c1' })), delete: vi.fn() } }));

import { ratesOn, type RateCardEntry } from '../../services/RateCardService';
import { projectTeamService, TeamPoolError } from '../../services/ProjectTeamService';
import { projectGroupService, ClientHasPeopleError } from '../../services/ProjectGroupService';

const CARD: RateCardEntry[] = [
  { id: 'r1', poolId: '', role: 'Developer', hourlyRate: 90, overtimeRate: null, effectiveFrom: '2026-01-01' },
  { id: 'r2', poolId: 'dbj', role: 'Developer', hourlyRate: 102, overtimeRate: null, effectiveFrom: '2026-01-01' },
];

describe('rate cards per pool', () => {
  it("a person is costed on their own pool's card, never another client's", () => {
    const base = { role: 'developer', costRateHourly: 50, overtimeRateHourly: null, useRateCard: true };
    expect(ratesOn({ ...base, clientId: 'dbj' }, '2026-10-14', CARD).standard).toBe(102);
    expect(ratesOn({ ...base, clientId: null }, '2026-10-14', CARD).standard).toBe(90);
    // a client with no card for the role: the person's own rate, not My resources' card
    expect(ratesOn({ ...base, clientId: 'nswma' }, '2026-10-14', CARD).standard).toBe(50);
  });
});

describe('project team', () => {
  beforeEach(() => { vi.clearAllMocks(); db.query.mockReset(); });

  it("someone from another client's pool can't join the project", async () => {
    db.query.mockResolvedValueOnce([{ group_id: 'dbj', name: 'DBJ Bank' }]);
    resources.findById.mockResolvedValue({ id: 'p1', clientId: 'nswma', userId: null, name: 'X', email: 'x@x.co' });
    await expect(projectTeamService.add('proj', 'p1', null, 'u-pm')).rejects.toBeInstanceOf(TeamPoolError);
    expect(db.query).toHaveBeenCalledTimes(1); // nothing written
  });

  it('someone from the client pool who can sign in joins and becomes a viewer member', async () => {
    db.query.mockResolvedValueOnce([{ group_id: 'dbj', name: 'DBJ Bank' }]).mockResolvedValueOnce([]);
    resources.findById.mockResolvedValue({ id: 'p2', clientId: 'dbj', userId: 'u-michaela', name: 'Michaela', email: 'm@dbj.co' });
    members.findMembership.mockResolvedValue(undefined);
    await projectTeamService.add('proj', 'p2', 'Product owner', 'u-pm');
    expect(members.insert).toHaveBeenCalledWith('proj', expect.objectContaining({ userId: 'u-michaela', role: 'viewer' }));
  });

  it('taking a viewer off the team takes away their view of the project', async () => {
    // the team gave them their view (granted_view), so leaving the team takes it away
    db.query.mockResolvedValueOnce([{ project_id: 'proj', resource_id: 'p2', granted_view: 1 }]).mockResolvedValue([]);
    resources.findByIds.mockResolvedValue([{ id: 'p2', userId: 'u-michaela' }]);
    await projectTeamService.remove('proj', 'p2');
    expect(members.deleteViewers).toHaveBeenCalledWith([{ projectId: 'proj', userId: 'u-michaela' }]);
  });
});

describe('deleting a client', () => {
  beforeEach(() => db.query.mockReset());
  it('is refused while its pool has people', async () => {
    db.query.mockResolvedValueOnce([{ n: 2 }]);
    await expect(projectGroupService.deleteGroup('c1')).rejects.toBeInstanceOf(ClientHasPeopleError);
  });
});
