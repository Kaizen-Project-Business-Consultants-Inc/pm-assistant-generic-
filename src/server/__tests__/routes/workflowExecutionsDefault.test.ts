import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import Fastify from 'fastify';

/**
 * GET /workflows/executions with no filters (2026-10-08). The Workflows page asks without
 * naming a workflow; that was a 400 for everyone but admin/PMO. Now it lists the newest runs the
 * caller can see: runs of their projects' workflows, and runs of company-wide workflows on tasks
 * in their projects (a company-wide workflow runs on every project and the run names the task).
 */
vi.mock('../../middleware/auth', () => ({
  authMiddleware: vi.fn(async (req: any) => { req.user = { userId: 'u1', role: req.headers['x-test-role'] }; }),
}));
vi.mock('../../middleware/requireTier', () => ({ requireFeature: () => vi.fn(async () => {}) }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const dag = vi.hoisted(() => ({ listDefinitions: vi.fn(), listExecutions: vi.fn(), getExecution: vi.fn() }));
vi.mock('../../services/DagWorkflowService', () => ({ dagWorkflowService: dag }));
const readable = vi.hoisted(() => ({ readableProjectIds: vi.fn() }));
vi.mock('../../utils/readableProjects', () => readable);
const access = vi.hoisted(() => ({ checkProjectRole: vi.fn(), projectsOfSchedules: vi.fn() }));
vi.mock('../../middleware/requireProjectAccess', () => access);
const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../database/connection', () => ({ databaseService: db }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: {} }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
vi.mock('../../services/claudeService', () => ({ claudeService: {} }));

import { workflowRoutes } from '../../routes/collaboration/workflows';

describe('GET /workflows/executions', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(workflowRoutes, { prefix: '/api/v1/workflows' }); }, 60_000);
  beforeEach(() => {
    dag.listDefinitions.mockReset().mockResolvedValue([
      { id: 'wf-org', projectId: null },
      { id: 'wf-mine', projectId: 'p-mine' },
      { id: 'wf-other', projectId: 'p-other' },
    ]);
    dag.listExecutions.mockReset().mockResolvedValue([{ id: 'run-1' }]);
    readable.readableProjectIds.mockReset().mockResolvedValue(new Set(['p-mine']));
    access.checkProjectRole.mockReset().mockResolvedValue({ ok: true });
    db.query.mockReset();
  });

  const get = (role: string, query = '') =>
    app.inject({ method: 'GET', url: `/api/v1/workflows/executions${query}`, headers: { 'x-test-role': role } });

  const mine = { projectWorkflowIds: ['wf-mine'], orgWorkflowIds: ['wf-org'], projectIds: ['p-mine'] };

  it.each(['project_manager', 'team_member'])('%s with no filters gets the runs on their projects', async role => {
    const res = await get(role);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ executions: [{ id: 'run-1' }] });
    expect(dag.listExecutions).toHaveBeenCalledWith(expect.objectContaining({ visibleTo: mine, limit: 50 }));
  });

  it('other filters without a workflow only narrow the same visible set', async () => {
    const res = await get('team_member', '?entityId=t1&status=failed');
    expect(res.statusCode).toBe(200);
    expect(dag.listExecutions).toHaveBeenCalledWith(expect.objectContaining({ visibleTo: mine, entityId: 't1', status: 'failed' }));
  });

  it("naming a company-wide workflow still shows only its runs on the caller's projects", async () => {
    db.query.mockResolvedValue([{ project_id: null }]);
    const res = await get('team_member', '?workflowId=wf-org');
    expect(res.statusCode).toBe(200);
    expect(dag.listExecutions).toHaveBeenCalledWith(expect.objectContaining({ workflowId: 'wf-org', visibleTo: mine }));
  });

  it('admin / PMO / executive with no filters see the whole log', async () => {
    readable.readableProjectIds.mockResolvedValue('all');
    const res = await get('executive');
    expect(res.statusCode).toBe(200);
    expect(dag.listExecutions).toHaveBeenCalledWith(expect.objectContaining({ visibleTo: undefined }));
  });

  it('a bad limit falls back to the default page', async () => {
    const res = await get('project_manager', '?limit=abc');
    expect(res.statusCode).toBe(200);
    expect(dag.listExecutions).toHaveBeenCalledWith(expect.objectContaining({ limit: 50 }));
  });

  it('naming a workflow still checks the caller can read it', async () => {
    db.query.mockResolvedValue([{ project_id: 'p-other' }]);
    access.checkProjectRole.mockResolvedValue({ ok: false, status: 403, body: { error: 'Not a member' } });
    const res = await get('team_member', '?workflowId=wf-other');
    expect(res.statusCode).toBe(403);
    expect(dag.listExecutions).not.toHaveBeenCalled();
  });
});

/**
 * GET /workflows/executions/:id (2026-10-08): the same rule as the list. A run the caller may not
 * see answers 404 — exactly as a run that doesn't exist, so its existence isn't given away.
 */
describe('GET /workflows/executions/:id', () => {
  let app: any;
  beforeAll(async () => { app = Fastify(); await app.register(workflowRoutes, { prefix: '/api/v1/workflows' }); }, 60_000);
  beforeEach(() => {
    dag.listDefinitions.mockReset().mockResolvedValue([
      { id: 'wf-org', projectId: null },
      { id: 'wf-mine', projectId: 'p-mine' },
      { id: 'wf-other', projectId: 'p-other' },
    ]);
    dag.listExecutions.mockReset();
    dag.getExecution.mockReset().mockResolvedValue({ id: 'run-1', nodeExecutions: [] });
    readable.readableProjectIds.mockReset().mockResolvedValue(new Set(['p-mine']));
  });

  const get = (role: string, id = 'run-1') =>
    app.inject({ method: 'GET', url: `/api/v1/workflows/executions/${id}`, headers: { 'x-test-role': role } });
  const mine = { projectWorkflowIds: ['wf-mine'], orgWorkflowIds: ['wf-org'], projectIds: ['p-mine'] };

  it('a team member opens a run they may see', async () => {
    dag.listExecutions.mockResolvedValue([{ id: 'run-1' }]);
    const res = await get('team_member');
    expect(res.statusCode).toBe(200);
    expect(res.json().execution.id).toBe('run-1');
    expect(dag.listExecutions).toHaveBeenCalledWith({ id: 'run-1', visibleTo: mine, limit: 1 });
  });

  it("a person without access to the run's project gets 404, the same as for a missing run", async () => {
    dag.listExecutions.mockResolvedValue([]); // e.g. a company-wide workflow's run on p-other
    const hidden = await get('team_member');
    expect(hidden.statusCode).toBe(404);
    expect(dag.getExecution).not.toHaveBeenCalled();
    dag.getExecution.mockResolvedValue(null);
    readable.readableProjectIds.mockResolvedValue('all');
    const missing = await get('pmo', 'no-such-run');
    expect(missing.statusCode).toBe(404);
    expect(hidden.json()).toEqual(missing.json());
  });

  it('admin / PMO / executive open any run without the extra lookup', async () => {
    readable.readableProjectIds.mockResolvedValue('all');
    const res = await get('executive');
    expect(res.statusCode).toBe(200);
    expect(dag.listExecutions).not.toHaveBeenCalled();
  });
});
