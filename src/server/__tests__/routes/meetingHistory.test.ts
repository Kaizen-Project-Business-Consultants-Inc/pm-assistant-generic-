import { describe, it, expect, vi, beforeAll } from 'vitest';
import Fastify from 'fastify';

/**
 * Meeting Intelligence → Analysis History (2026-10-01). The route sent the list before it was
 * ready (an un-awaited promise, which goes out as {}), so History always said "No previous
 * analyses". It must send the analyses, with each one's Meeting Coach scorecard.
 */
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireTier', () => ({ requireFeature: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: () => vi.fn(async () => {}),
  projectsOfSchedules: vi.fn(),
  checkProjectRole: vi.fn(),
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const mis = vi.hoisted(() => ({ getProjectHistory: vi.fn(), getAnalysis: vi.fn() }));
vi.mock('../../services/MeetingIntelligenceService', () => ({ meetingIntelligenceService: mis }));
const risk = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../../services/RiskService', () => ({ riskService: risk }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
const members = vi.hoisted(() => ({ findByProjectId: vi.fn() }));
vi.mock('../../services/ProjectMemberService', () => ({ projectMemberService: members }));
const meetingRepo = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../database/MeetingRepository', () => ({ meetingRepository: meetingRepo }));
vi.mock('../../services/FileAttachmentService', () => ({ fileAttachmentService: {} }));

import { meetingIntelligenceRoutes } from '../../routes/collaboration/meetingIntelligence';

describe('Meeting Intelligence history', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(meetingIntelligenceRoutes, { prefix: '/api/v1/meeting-intelligence' }); }, 60_000);

  it("sends the project's analyses, not an empty object", async () => {
    mis.getProjectHistory.mockResolvedValue([
      { id: 'ma-1', summary: 'Weekly status', coach: { calledOut: 4, aiOnly: 2 } },
      { id: 'ma-2', summary: 'Kick-off' },
    ]);
    const res = await app.inject({ method: 'GET', url: '/api/v1/meeting-intelligence/project/p1/history' });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.map((a: any) => a.id)).toEqual(['ma-1', 'ma-2']);
    expect(res.json().data[0].coach).toEqual({ calledOut: 4, aiOnly: 2 });
  });

  it('Send to RAID records which meeting an action came from', async () => {
    mis.getAnalysis.mockResolvedValue({ id: 'ma-1', meetingId: 'm-1', createdAt: '2026-10-01 10:00:00' });
    meetingRepo.findById.mockResolvedValue({ id: 'm-1', title: 'Steering committee' });
    members.findByProjectId.mockResolvedValue([]);
    risk.create.mockImplementation(async (d: any) => ({ id: 'r-1', ...d }));

    const res = await app.inject({
      method: 'POST', url: '/api/v1/meeting-intelligence/ma-1/send-to-raid',
      payload: { projectId: 'p1', items: [{ type: 'action', title: 'Send minutes', ownerName: 'Pat' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(risk.create.mock.calls[0][0]).toMatchObject({ type: 'action', source: 'meeting', sourceMeeting: 'Steering committee', ownerName: 'Pat' });

    // Not linked to a meeting: the analysis date says which one
    risk.create.mockClear();
    mis.getAnalysis.mockResolvedValue({ id: 'ma-2', meetingId: null, createdAt: '2026-09-30 09:00:00' });
    await app.inject({
      method: 'POST', url: '/api/v1/meeting-intelligence/ma-2/send-to-raid',
      payload: { projectId: 'p1', items: [{ type: 'action', title: 'Book room' }] },
    });
    expect(risk.create.mock.calls[0][0].sourceMeeting).toBe('Meeting analysis 2026-09-30');
  });
});
