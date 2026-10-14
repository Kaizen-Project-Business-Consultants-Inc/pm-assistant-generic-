import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';

/**
 * Meeting Intelligence analysis (2026-10-14). The transcript upload always failed (the client sent
 * the file before projectId/scheduleId); once fixed it became reachable, so both analysis routes
 * now need the plan's Meeting Intelligence feature (each is an AI call), and a meeting the analysis
 * is attached to must belong to the project.
 */
const plan = vi.hoisted(() => ({ hasFeature: true }));
vi.mock('../../middleware/auth', () => ({ authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'project_manager' }; }) }));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireTier', () => ({
  requireFeature: () => vi.fn(async (_req: any, reply: any) => {
    if (!plan.hasFeature) return reply.status(403).send({ error: 'UPGRADE_REQUIRED', message: 'paid plan' });
  }),
}));
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: () => vi.fn(async () => {}),
  projectsOfSchedules: vi.fn(async () => ['p1']),
  checkProjectRole: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const mis = vi.hoisted(() => ({ analyzeTranscript: vi.fn(async () => ({ id: 'ma-1' })) }));
vi.mock('../../services/MeetingIntelligenceService', () => ({ meetingIntelligenceService: mis }));
vi.mock('../../services/RiskService', () => ({ riskService: {} }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
vi.mock('../../services/ProjectMemberService', () => ({ projectMemberService: {} }));
const meetingRepo = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../database/MeetingRepository', () => ({ meetingRepository: meetingRepo }));
vi.mock('../../services/FileAttachmentService', () => ({ fileAttachmentService: { upload: vi.fn(async () => ({})) } }));

import { meetingIntelligenceRoutes } from '../../routes/collaboration/meetingIntelligence';

const TRANSCRIPT = 'Ali: the API is done. Sam: design slips a week.';

/** A multipart body with the fields BEFORE the file, as the app now sends it */
function uploadBody(fields: Record<string, string>) {
  const b = 'XXB';
  let body = '';
  for (const [k, v] of Object.entries(fields)) body += `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`;
  body += `--${b}\r\nContent-Disposition: form-data; name="file"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\n${TRANSCRIPT}\r\n--${b}--\r\n`;
  return { payload: body, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

describe('Meeting Intelligence analysis guards', () => {
  let app: any;
  beforeAll(async () => {
    app = Fastify();
    await app.register(multipart);
    await app.register(meetingIntelligenceRoutes, { prefix: '/api/v1/meeting-intelligence' });
  }, 60_000);
  beforeEach(() => { plan.hasFeature = true; mis.analyzeTranscript.mockClear(); meetingRepo.findById.mockReset(); });

  it('an uploaded transcript with its project and schedule is analysed', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/meeting-intelligence/upload-transcript', ...uploadBody({ projectId: 'p1', scheduleId: 's1' }) });
    expect(res.statusCode).toBe(200);
    expect(mis.analyzeTranscript).toHaveBeenCalledWith(TRANSCRIPT, 'p1', 's1', 'u1', undefined);
  });

  it('a plan without Meeting Intelligence is refused on both routes, and no AI runs', async () => {
    plan.hasFeature = false;
    const up = await app.inject({ method: 'POST', url: '/api/v1/meeting-intelligence/upload-transcript', ...uploadBody({ projectId: 'p1', scheduleId: 's1' }) });
    const paste = await app.inject({ method: 'POST', url: '/api/v1/meeting-intelligence/analyze', payload: { transcript: TRANSCRIPT, projectId: 'p1', scheduleId: 's1' } });
    expect(up.statusCode).toBe(403);
    expect(paste.statusCode).toBe(403);
    expect(mis.analyzeTranscript).not.toHaveBeenCalled();
  });

  it("a meeting from another project can't be attached, on either route", async () => {
    meetingRepo.findById.mockResolvedValue({ id: 'm-9', projectId: 'p-other' });
    const up = await app.inject({ method: 'POST', url: '/api/v1/meeting-intelligence/upload-transcript', ...uploadBody({ projectId: 'p1', scheduleId: 's1', meetingId: 'm-9' }) });
    const paste = await app.inject({ method: 'POST', url: '/api/v1/meeting-intelligence/analyze', payload: { transcript: TRANSCRIPT, projectId: 'p1', scheduleId: 's1', meetingId: 'm-9' } });
    expect(up.statusCode).toBe(400);
    expect(paste.statusCode).toBe(400);
    expect(paste.json().message).toMatch(/isn't in this project/);
    expect(mis.analyzeTranscript).not.toHaveBeenCalled();
  });
});
