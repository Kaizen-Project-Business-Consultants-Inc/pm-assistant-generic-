import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * A permission-matrix run against staging (2026-09-29) sent an empty body `{}` to every
 * route. These answered 500 — a crash — instead of telling the caller what was missing:
 *   - a schema check that threw straight out of the handler (project groups, calendars,
 *     availability) or fell into a catch-all 500 (time entries, intake, goals, …)
 *   - a service's "not found" Error also turned into 500 (groups, intake, Monte Carlo)
 * One test per root cause, driven through the real route with Fastify's inject.
 */

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  maskPii: (v: string) => v,
}));
vi.mock('../../middleware/auth', () => ({
  // x-test-role lets a case act as admin (resource-request decisions are admin/PMO only)
  authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: req.headers['x-test-role'] || 'team_member' }; }),
}));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: () => vi.fn(async () => {}),
  projectsOfSchedules: vi.fn(),
  checkProjectRole: vi.fn(async () => ({ ok: true })),
  checkProjectRoleFor: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../../middleware/requireTier', () => ({ requirePaidTier: vi.fn(async () => {}), requireFeature: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/viewerWriteBypass', () => ({ viewerWriteBypass: () => vi.fn(async () => {}), ownWorkScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/checkEntityProjectAccess', () => ({ checkEntityProjectAccess: vi.fn(async () => true) }));
vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([]), queryControlPlane: vi.fn().mockResolvedValue([]) },
}));

const groups = vi.hoisted(() => ({
  getGroups: vi.fn(), createGroup: vi.fn(), updateGroup: vi.fn(), deleteGroup: vi.fn(),
  reorderGroups: vi.fn(), assignProject: vi.fn(), unassignProject: vi.fn(),
}));
vi.mock('../../services/ProjectGroupService', () => ({ projectGroupService: groups }));

const intake = vi.hoisted(() => ({
  getFormById: vi.fn(), submitForm: vi.fn(), getSubmissionById: vi.fn(), reviewSubmission: vi.fn(),
  convertToProject: vi.fn(), createForm: vi.fn(),
}));
vi.mock('../../services/IntakeFormService', () => ({ intakeFormService: intake }));

const monteCarlo = vi.hoisted(() => ({ runSimulation: vi.fn() }));
vi.mock('../../services/MonteCarloService', () => ({ monteCarloService: monteCarlo }));
vi.mock('../../services/UserService', () => ({ userService: { findById: vi.fn(async () => ({ subscriptionTier: 'sme' })) } }));

vi.mock('../../services/TimeEntryService', () => ({ timeEntryService: { create: vi.fn() } }));
vi.mock('../../services/WeeklyTimesheetService', () => ({ weeklyTimesheetService: { reject: vi.fn(), flag: vi.fn(), assertWeekOpen: vi.fn() }, TimesheetError: class TimesheetError extends Error { statusCode = 400; } }));
vi.mock('../../services/TimeAnomalyService', () => ({ timeAnomalyService: {} }));
vi.mock('../../database/TimeEntryRepository', () => ({ timeEntryRepository: {} }));
vi.mock('../../services/automation/AutomationEventBus', () => ({ automationEventBus: { emit: vi.fn(async () => {}) } }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { findById: vi.fn(), findTaskById: vi.fn() } }));

// 2026-10-07 sweep: more routes that crashed (500) on an empty, partial or non-upload body
const resourceRequests = vi.hoisted(() => ({ getRequest: vi.fn(), rejectRequest: vi.fn(), fulfillRequest: vi.fn() }));
vi.mock('../../services/ResourceRequestService', () => ({ resourceRequestService: resourceRequests }));
const projectLinks = vi.hoisted(() => ({ reorder: vi.fn() }));
vi.mock('../../database/ProjectLinkRepository', () => ({ projectLinkRepository: projectLinks }));
const sprints = vi.hoisted(() => ({ getById: vi.fn(), addTask: vi.fn(), updateTaskStoryPoints: vi.fn() }));
vi.mock('../../services/SprintService', () => ({ sprintService: sprints }));
const customFields = vi.hoisted(() => ({ createField: vi.fn(), updateField: vi.fn() }));
vi.mock('../../services/CustomFieldService', () => ({ customFieldService: customFields }));
vi.mock('../../database/CustomFieldRepository', () => ({ customFieldRepository: { findById: vi.fn(async () => ({ id: 'cf1', projectId: 'p1' })) } }));
vi.mock('../../services/ProjectStatusReportService', () => ({ projectStatusReportService: {} }));
vi.mock('../../services/ReportScheduleService', () => ({ reportScheduleService: {} }));
const attachments = vi.hoisted(() => ({ getById: vi.fn(), upload: vi.fn() }));
vi.mock('../../services/FileAttachmentService', () => ({ fileAttachmentService: attachments }));

import { projectGroupRoutes } from '../../routes/core/projectGroups';
import { intakeFormRoutes } from '../../routes/collaboration/intakeForms';
import { monteCarloRoutes } from '../../routes/scheduling/monteCarlo';
import { timeEntryRoutes } from '../../routes/resources/timeEntries';
import multipart from '@fastify/multipart';
import { resourceRequestRoutes } from '../../routes/resources/resourceRequests';
import { projectLinkRoutes } from '../../routes/core/projectLinks';
import { sprintRoutes } from '../../routes/collaboration/sprints';
import { customFieldRoutes } from '../../routes/resources/customFields';
import { statusReportRoutes } from '../../routes/reporting/statusReports';
import { fileAttachmentRoutes } from '../../routes/collaboration/fileAttachments';
import { documentIntelligenceRoutes } from '../../routes/collaboration/documentIntelligence';
import { importRoutes } from '../../routes/scheduling/import';
import { scheduleService } from '../../services/ScheduleService';
import { config } from '../../config';

async function buildApp() {
  const app = Fastify();
  await app.register(projectGroupRoutes, { prefix: '/api/v1/project-groups' });
  await app.register(intakeFormRoutes, { prefix: '/api/v1/intake' });
  await app.register(monteCarloRoutes, { prefix: '/api/v1/monte-carlo' });
  await app.register(timeEntryRoutes, { prefix: '/api/v1/time-entries' });
  return app;
}

const ID = '00000000-0000-4000-8000-000000000001';

describe('routes answer an empty or incomplete body with a clear 4xx, not a crash', () => {
  let app: any;
  beforeAll(async () => { app = await buildApp(); }, 60_000);
  beforeEach(() => { vi.clearAllMocks(); });

  const send = (method: string, url: string, payload?: unknown) =>
    app.inject({ method, url, ...(payload === undefined ? {} : { payload }) });
  // managing clients (project groups) is for the owner/PMO/PMs (2026-10-07) — test as a PM
  const sendPm = (method: string, url: string, payload?: unknown) =>
    app.inject({ method, url, headers: { 'x-test-role': 'project_manager' }, ...(payload === undefined ? {} : { payload }) });

  // Root cause 1: schema.parse() threw out of a handler with no try/catch
  it('project group without a name → 400 "Enter a name for the client."', async () => {
    const res = await sendPm('POST', '/api/v1/project-groups', {});
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Enter a name for the client.');
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  it('reorder / assign / unassign without their field → 400 saying what is missing', async () => {
    const reorder = await sendPm('PUT', '/api/v1/project-groups/reorder', {});
    expect(reorder.statusCode).toBe(400);
    expect(reorder.json().message).toMatch(/new order/);
    const assign = await sendPm('PUT', `/api/v1/project-groups/${ID}/assign`, {});
    expect(assign.statusCode).toBe(400);
    expect(assign.json().message).toMatch(/which project/);
    const unassign = await sendPm('PUT', '/api/v1/project-groups/unassign', {});
    expect(unassign.statusCode).toBe(400);
  });

  // Root cause 2: the service's "not found" Error became a 500
  it('deleting or renaming a group that does not exist → 404', async () => {
    groups.deleteGroup.mockRejectedValue(new Error('Group not found'));
    groups.updateGroup.mockRejectedValue(new Error('Group not found'));
    expect((await sendPm('DELETE', `/api/v1/project-groups/${ID}`)).statusCode).toBe(404);
    expect((await sendPm('PUT', `/api/v1/project-groups/${ID}`, {})).statusCode).toBe(404);
  });

  it('a duplicate group name → 409', async () => {
    groups.createGroup.mockRejectedValue(new Error('A group with this name already exists'));
    const res = await sendPm('POST', '/api/v1/project-groups', { name: 'Ops' });
    expect(res.statusCode).toBe(409);
  });

  it('a team member cannot manage the client list (403, said plainly)', async () => {
    const res = await send('POST', '/api/v1/project-groups', { name: 'Ops' });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/owner, PMO and project managers/);
  });

  it('a real failure still reaches the error handler (not swallowed as 4xx)', async () => {
    groups.deleteGroup.mockRejectedValue(new Error('connection lost'));
    expect((await sendPm('DELETE', `/api/v1/project-groups/${ID}`)).statusCode).toBe(500);
  });

  // Root cause 3: a ZodError inside try/catch fell into the catch-all 500
  it('time entry with an empty body → 400 naming the first missing thing', async () => {
    const res = await send('POST', '/api/v1/time-entries', {});
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Choose the task you worked on.');
  });

  it('sending a timesheet back, or flagging a line, with an empty body → 400 saying what is missing', async () => {
    const res = await send('POST', '/api/v1/time-entries/timesheets/ts-1/reject', {});
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/reason/);
    const flag = await send('POST', '/api/v1/time-entries/timesheets/ts-1/flags', {});
    expect(flag.statusCode).toBe(400);
    expect(flag.json().message).toMatch(/task line/);
  });

  it('intake: submitting to a form that does not exist → 404; reviewing without a decision → 400', async () => {
    intake.getFormById.mockResolvedValue(null);
    const submit = await send('POST', `/api/v1/intake/forms/${ID}/submit`, { values: {} });
    expect(submit.statusCode).toBe(404);
    expect(intake.submitForm).not.toHaveBeenCalled();

    const empty = await send('POST', `/api/v1/intake/forms/${ID}/submit`, {});
    expect(empty.statusCode).toBe(400);

    const review = await send('POST', `/api/v1/intake/submissions/${ID}/review`, {});
    expect(review.statusCode).toBe(400);
    expect(review.json().message).toBe('Choose a review decision (status).');

    intake.convertToProject.mockRejectedValue(new Error('Submission not found'));
    expect((await send('POST', `/api/v1/intake/submissions/${ID}/convert`, {})).statusCode).toBe(404);
  });

  it('Monte Carlo on a schedule that does not exist → 404', async () => {
    monteCarlo.runSimulation.mockRejectedValue(new Error(`Schedule not found: ${ID}`));
    const res = await send('POST', `/api/v1/monte-carlo/${ID}/simulate`, {});
    expect(res.statusCode).toBe(404);
    expect(res.json().message).toBe('That schedule no longer exists.');
  });
});

async function buildSweepApp() {
  const app = Fastify();
  await app.register(multipart);
  await app.register(resourceRequestRoutes, { prefix: '/api/v1/resource-requests' });
  await app.register(projectLinkRoutes, { prefix: '/api/v1/projects' });
  await app.register(sprintRoutes, { prefix: '/api/v1/sprints' });
  await app.register(customFieldRoutes, { prefix: '/api/v1/custom-fields' });
  await app.register(statusReportRoutes, { prefix: '/api/v1/status-reports' });
  await app.register(fileAttachmentRoutes, { prefix: '/api/v1/attachments' });
  await app.register(documentIntelligenceRoutes, { prefix: '/api/v1/projects' });
  await app.register(importRoutes, { prefix: '/api/v1/schedules' });
  return app;
}

/**
 * Sweep 2026-10-07: 35 more routes answered 500 to bad input. Groups A (empty / partial body)
 * and B (an upload route sent JSON or nothing) are driven here; every answer must be a 4xx with
 * a message, and the service must not be called.
 */
describe('more routes answer an empty, partial or non-upload body with a clear 4xx (2026-10-07)', () => {
  let app: any;
  beforeAll(async () => { app = await buildSweepApp(); }, 60_000);
  beforeEach(() => { vi.clearAllMocks(); });

  const send = (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  const expect4xx = (res: any, status = 400) => {
    expect(res.statusCode).toBe(status);
    expect(typeof res.json().message).toBe('string');
    expect(res.json().message.length).toBeGreaterThan(5);
  };
  const admin = { 'x-test-role': 'admin' };

  it('resource request: reject without a comment, fulfil without a resource -> 400', async () => {
    expect4xx(await send('POST', `/api/v1/resource-requests/${ID}/reject`, {}, admin));
    expect4xx(await send('POST', `/api/v1/resource-requests/${ID}/reject`, undefined, admin));
    expect4xx(await send('POST', `/api/v1/resource-requests/${ID}/fulfill`, {}, admin));
    expect(resourceRequests.rejectRequest).not.toHaveBeenCalled();
    expect(resourceRequests.fulfillRequest).not.toHaveBeenCalled();
  });

  it('reordering project links without a list of ids -> 400', async () => {
    expect4xx(await send('PUT', `/api/v1/projects/${ID}/links/reorder`, {}));
    expect4xx(await send('PUT', `/api/v1/projects/${ID}/links/reorder`, { orderedIds: [1, 2] }));
    expect(projectLinks.reorder).not.toHaveBeenCalled();
  });

  it('sprint: add a task without taskId -> 400; a task already in the sprint -> 409; text points -> 400', async () => {
    expect4xx(await send('POST', `/api/v1/sprints/${ID}/tasks`, {}));
    expect(sprints.addTask).not.toHaveBeenCalled();

    sprints.addTask.mockRejectedValue(Object.assign(new Error('Duplicate entry'), { code: 'ER_DUP_ENTRY' }));
    const dup = await send('POST', `/api/v1/sprints/${ID}/tasks`, { taskId: 't1' });
    expect4xx(dup, 409);
    expect(dup.json().message).toBe('That task is already in this sprint.');

    expect4xx(await send('PATCH', `/api/v1/sprints/${ID}/tasks/t1/points`, { storyPoints: 'five' }));
    expect4xx(await send('PATCH', `/api/v1/sprints/${ID}/tasks/t1/points`, {}));
    expect(sprints.updateTaskStoryPoints).not.toHaveBeenCalled();
  });

  it('custom field: create with an empty body or an unknown type -> 400; update with a bad value -> 400', async () => {
    expect4xx(await send('POST', `/api/v1/custom-fields/project/${ID}`, {}));
    expect4xx(await send('POST', `/api/v1/custom-fields/project/${ID}`, {
      entityType: 'task', fieldName: 'x', fieldLabel: 'X', fieldType: 'colour',
    }));
    expect(customFields.createField).not.toHaveBeenCalled();
    expect4xx(await send('PUT', '/api/v1/custom-fields/cf1', { isRequired: 'yes' }));
    expect(customFields.updateField).not.toHaveBeenCalled();
  });

  it('status report render / Word export with a partial report -> 400, not a renderer crash', async () => {
    for (const url of ['/api/v1/status-reports/render', '/api/v1/status-reports/export/docx']) {
      expect4xx(await send('POST', url, {}));
      expect4xx(await send('POST', url, { projectName: 'Alpha' }));
    }
    // A complete report still renders; lists the editor left out default to empty
    const ok = await send('POST', '/api/v1/status-reports/render', {
      projectName: 'Alpha', reportNumber: '1', reportingPeriod: 'Wk 40', preparedBy: 'PM',
      executiveSummary: 'On track', reportDate: '2026-10-07', aiPowered: false,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().html).toContain('Alpha');
  });

  it('upload routes sent JSON or nothing -> 400 "Send the file as a form upload"', async () => {
    attachments.getById.mockResolvedValue({ id: 'a1', entityType: 'goal', entityId: 'g1' });
    vi.mocked(scheduleService.findById).mockResolvedValue({ id: ID, projectId: 'p1' } as any);
    const aiWas = config.AI_ENABLED;
    (config as any).AI_ENABLED = true;
    try {
      for (const [url, payload] of [
        ['/api/v1/attachments/goal/g1', {}],
        ['/api/v1/attachments/goal/g1', undefined],
        ['/api/v1/attachments/a1/version', {}],
        [`/api/v1/projects/${ID}/documents/upload`, {}],
        [`/api/v1/schedules/${ID}/import-document`, {}],
      ] as const) {
        const res = await send('POST', url, payload);
        expect4xx(res);
        expect(res.json().message).toBe('Send the file as a form upload (multipart/form-data).');
      }
    } finally {
      (config as any).AI_ENABLED = aiWas;
    }
  });
});
