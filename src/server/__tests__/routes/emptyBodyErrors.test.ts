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
  authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: 'team_member' }; }),
}));
vi.mock('../../middleware/requireScope', () => ({ requireScope: () => vi.fn(async () => {}) }));
vi.mock('../../middleware/requireProjectAccess', () => ({
  requireProjectAccess: () => vi.fn(async () => {}),
  projectsOfSchedules: vi.fn(),
}));
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

import { projectGroupRoutes } from '../../routes/core/projectGroups';
import { intakeFormRoutes } from '../../routes/collaboration/intakeForms';
import { monteCarloRoutes } from '../../routes/scheduling/monteCarlo';
import { timeEntryRoutes } from '../../routes/resources/timeEntries';

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

  // Root cause 1: schema.parse() threw out of a handler with no try/catch
  it('project group without a name → 400 "Enter a name for the group."', async () => {
    const res = await send('POST', '/api/v1/project-groups', {});
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Enter a name for the group.');
    expect(groups.createGroup).not.toHaveBeenCalled();
  });

  it('reorder / assign / unassign without their field → 400 saying what is missing', async () => {
    const reorder = await send('PUT', '/api/v1/project-groups/reorder', {});
    expect(reorder.statusCode).toBe(400);
    expect(reorder.json().message).toMatch(/new order/);
    const assign = await send('PUT', `/api/v1/project-groups/${ID}/assign`, {});
    expect(assign.statusCode).toBe(400);
    expect(assign.json().message).toMatch(/which project/);
    const unassign = await send('PUT', '/api/v1/project-groups/unassign', {});
    expect(unassign.statusCode).toBe(400);
  });

  // Root cause 2: the service's "not found" Error became a 500
  it('deleting or renaming a group that does not exist → 404', async () => {
    groups.deleteGroup.mockRejectedValue(new Error('Group not found'));
    groups.updateGroup.mockRejectedValue(new Error('Group not found'));
    expect((await send('DELETE', `/api/v1/project-groups/${ID}`)).statusCode).toBe(404);
    expect((await send('PUT', `/api/v1/project-groups/${ID}`, {})).statusCode).toBe(404);
  });

  it('a duplicate group name → 409', async () => {
    groups.createGroup.mockRejectedValue(new Error('A group with this name already exists'));
    const res = await send('POST', '/api/v1/project-groups', { name: 'Ops' });
    expect(res.statusCode).toBe(409);
  });

  it('a real failure still reaches the error handler (not swallowed as 4xx)', async () => {
    groups.deleteGroup.mockRejectedValue(new Error('connection lost'));
    expect((await send('DELETE', `/api/v1/project-groups/${ID}`)).statusCode).toBe(500);
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
