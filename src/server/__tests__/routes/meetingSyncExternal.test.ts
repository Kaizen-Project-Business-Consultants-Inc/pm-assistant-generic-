import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * Import Meeting (POST /meetings/sync-external), Oct 2026: the meeting's actions go into the
 * project's RAID log as actions (source 'meeting'), not the retired meeting action items list.
 * Only the project's Manager/Owner adds to RAID, so a team member is refused with a clear 403.
 * The real project-access check runs; only who-is-on-the-project is stubbed.
 */
const who = vi.hoisted(() => ({ user: { userId: 'u-pm', role: 'team_member' } as { userId: string; role: string } }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { ...who.user }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const membership = vi.hoisted(() => ({ findMembership: vi.fn() }));
vi.mock('../../services/ProjectMemberService', () => ({ projectMemberService: membership }));
vi.mock('../../services/ProjectService', () => ({ projectService: { findById: vi.fn().mockResolvedValue(null) } }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { findById: vi.fn() } }));

const meetings = vi.hoisted(() => ({ createMeeting: vi.fn(), completeMeeting: vi.fn() }));
vi.mock('../../services/MeetingService', () => ({ meetingService: meetings }));
const risks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../services/RiskService', () => ({ riskService: risks }));
vi.mock('../../services/MeetingIntelligenceService', () => ({ meetingIntelligenceService: {} }));
vi.mock('../../database/MeetingRepository', () => ({ meetingRepository: {} }));
vi.mock('../../services/EmailService', () => ({ emailService: {}, EmailRejectedError: class extends Error {} }));
vi.mock('../../middleware/checkEntityProjectAccess', () => ({ checkEntityProjectAccess: vi.fn() }));

import { meetingRoutes } from '../../routes/collaboration/meetings';

const body = {
  projectId: 'p-1',
  title: 'Weekly status',
  scheduledDate: '2026-10-02',
  summary: 'Went through the plan.',
  actionItems: [
    { description: 'Send the revised plan', assigneeName: 'Pat', priority: 'high', dueDate: '2026-10-09' },
    { description: 'Book the UAT room' },
  ],
};

describe('Import Meeting → actions go to RAID', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(meetingRoutes, { prefix: '/api/v1/meetings' });
  });
  beforeEach(() => {
    vi.clearAllMocks();
    meetings.createMeeting.mockResolvedValue({ id: 'm-1', projectId: 'p-1', title: 'Weekly status' });
    meetings.completeMeeting.mockResolvedValue(undefined);
    risks.create.mockImplementation(async (d: any) => ({ id: `r-${d.title.length}`, ...d }));
  });

  it('a team member is refused with a clear message, and nothing is created', async () => {
    who.user = { userId: 'u-team', role: 'team_member' };
    membership.findMembership.mockResolvedValue({ projectId: 'p-1', userId: 'u-team', role: 'viewer' });

    const res = await app.inject({ method: 'POST', url: '/api/v1/meetings/sync-external', payload: body });

    expect(res.statusCode).toBe(403);
    expect(res.json().message).toBe("Only the project's Manager or Owner can change this.");
    expect(meetings.createMeeting).not.toHaveBeenCalled();
    expect(risks.create).not.toHaveBeenCalled();
  });

  it("the project's manager adds each action to RAID, traced to the meeting", async () => {
    who.user = { userId: 'u-pm', role: 'team_member' };
    membership.findMembership.mockResolvedValue({ projectId: 'p-1', userId: 'u-pm', role: 'manager' });

    const res = await app.inject({ method: 'POST', url: '/api/v1/meetings/sync-external', payload: body });

    expect(res.statusCode).toBe(201);
    expect(res.json().raidActionsAdded).toBe(2);
    expect(res.json().actionItems).toHaveLength(2);
    expect(risks.create).toHaveBeenCalledTimes(2);
    expect(risks.create.mock.calls[0][0]).toMatchObject({
      projectId: 'p-1', type: 'action', title: 'Send the revised plan', severity: 'high',
      ownerName: 'Pat', dueDate: '2026-10-09', source: 'meeting', sourceMeeting: 'Weekly status', createdBy: 'u-pm',
    });
    expect(risks.create.mock.calls[1][0]).toMatchObject({ type: 'action', severity: 'medium', ownerName: undefined, sourceMeeting: 'Weekly status' });
  });

  it('a long action keeps its full text in the description, with a short title', async () => {
    who.user = { userId: 'u-pm', role: 'project_manager' };
    membership.findMembership.mockResolvedValue({ projectId: 'p-1', userId: 'u-pm', role: 'owner' });
    const long = 'x'.repeat(400);

    const res = await app.inject({ method: 'POST', url: '/api/v1/meetings/sync-external', payload: { ...body, actionItems: [{ description: long }] } });

    expect(res.statusCode).toBe(201);
    const created = risks.create.mock.calls[0][0];
    expect(created.title.length).toBeLessThanOrEqual(255);
    expect(created.description).toBe(long);
  });
});
