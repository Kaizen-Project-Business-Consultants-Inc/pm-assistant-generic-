import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mjuzi acts as the signed-in user: it may only read projects that user can open (Sep 2026).

vi.mock('../../services/ProjectService', () => ({
  projectService: {
    findAll: vi.fn(),
    findAccessible: vi.fn(),
    findById: vi.fn(),
  },
}));
vi.mock('../../middleware/requireProjectAccess', () => ({ checkProjectRoleFor: vi.fn() }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findById: vi.fn(),
    findTaskById: vi.fn(),
    findByProjectId: vi.fn().mockResolvedValue([]),
    findTasksByScheduleIds: vi.fn().mockResolvedValue([]),
    findTasksByScheduleId: vi.fn().mockResolvedValue([]),
  },
  DependencyValidationError: class extends Error {},
}));
vi.mock('../../services/UserService', () => ({ userService: {} }));
// people by name: a task holds its person's resource id, not the name
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async (sql: string, params: any[] = []) => (
  sql.startsWith('SELECT id FROM resources WHERE name LIKE') && /jane/i.test(params[0]) ? [{ id: 'res-jane' }] : [])) } }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../services/PolicyEngineService', () => ({ policyEngineService: { evaluate: vi.fn().mockResolvedValue({ allowed: true, matchedPolicies: [] }) } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: vi.fn() } }));
vi.mock('../../services/AgentMemoryService', () => ({ agentMemoryService: { store: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../services/KnowledgeBaseService', () => ({ knowledgeBaseService: {} }));

import { AIActionExecutor } from '../../services/aiActionExecutor';
import { projectService } from '../../services/ProjectService';
import { scheduleService } from '../../services/ScheduleService';
import { checkProjectRoleFor } from '../../middleware/requireProjectAccess';
import { agentMemoryService } from '../../services/AgentMemoryService';

const ps = projectService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const ss = scheduleService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const roleCheck = checkProjectRoleFor as ReturnType<typeof vi.fn>;
const TEAM_MEMBER = { userId: 'u-tm', userRole: 'team_member' };

describe('Mjuzi read tools — only the projects the user can open', () => {
  const executor = new AIActionExecutor();

  beforeEach(() => {
    vi.clearAllMocks();
    ps.findAccessible.mockResolvedValue([{ id: 'mine', name: 'Mine', status: 'active', priority: 'medium' }]);
    ps.findAll.mockResolvedValue([{ id: 'mine' }, { id: 'theirs' }]);
    roleCheck.mockImplementation(async (_u: unknown, projectId: string) =>
      projectId === 'mine' ? { ok: true } : { ok: false, status: 404, body: {} });
  });

  it('list_projects lists their projects, never the whole organisation', async () => {
    const r = await executor.execute('list_projects', {}, TEAM_MEMBER);
    expect(ps.findAccessible).toHaveBeenCalledWith({ userId: 'u-tm', role: 'team_member' });
    expect(ps.findAll).not.toHaveBeenCalled();
    expect(JSON.stringify(r.data)).not.toContain('theirs');
  });

  it("refuses another project's details without reading them", async () => {
    const r = await executor.execute('get_project_details', { projectId: 'theirs' }, TEAM_MEMBER);
    expect(r.success).toBe(false);
    expect(r.summary).toMatch(/projects you're on/);
    expect(ps.findById).not.toHaveBeenCalled();
  });

  it('refuses the tasks of a schedule in another project', async () => {
    ss.findById.mockResolvedValue({ id: 's9', projectId: 'theirs' });
    const r = await executor.execute('list_tasks', { scheduleId: 's9' }, TEAM_MEMBER);
    expect(r.success).toBe(false);
    expect(ss.findTasksByScheduleId).not.toHaveBeenCalled();
  });

  it('reads their own project', async () => {
    ps.findById.mockResolvedValue({ id: 'mine', name: 'Mine' });
    const r = await executor.execute('get_project_details', { projectId: 'mine' }, TEAM_MEMBER);
    expect(r.success).toBe(true);
  });

  it('portfolio summaries use their projects only', async () => {
    await executor.execute('get_portfolio_summary', {}, TEAM_MEMBER);
    expect(ps.findAccessible).toHaveBeenCalled();
    expect(ps.findAll).not.toHaveBeenCalled();
  });
});

// audit 2026-10-10 H1: tool results go back to the model on every later turn, so lists are bounded
describe('Mjuzi read tools — bounded results', () => {
  const executor = new AIActionExecutor();
  const tasks = (n: number, scheduleId = 's1') => Array.from({ length: n }, (_, i) => ({
    id: `${scheduleId}-t${i}`, scheduleId, name: `Task ${i}`, status: 'pending', priority: 'medium',
    dueDate: null, dependencies: [],
  }));

  beforeEach(() => {
    vi.clearAllMocks();
    roleCheck.mockResolvedValue({ ok: true });
  });

  it('list_tasks on a 5,000-task plan returns 200 rows and says how many there are', async () => {
    ss.findById.mockResolvedValue({ id: 's1', name: 'Big plan', projectId: 'mine' });
    ss.findTasksByScheduleId.mockResolvedValue(tasks(5000));
    const r = await executor.execute('list_tasks', { scheduleId: 's1' }, TEAM_MEMBER);
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(200);
    expect(r.summary).toMatch(/Found 5000 tasks.*Showing 200 of 5000/);
  });

  // review 2026-10-10 must-fix 2: a task deep in a big plan can be found by name
  it('nameContains finds task #250 of 300, which the 200-row list would leave out', async () => {
    ss.findById.mockResolvedValue({ id: 's1', name: 'Big plan', projectId: 'mine' });
    ss.findTasksByScheduleId.mockResolvedValue(tasks(300));
    const unfiltered = await executor.execute('list_tasks', { scheduleId: 's1' }, TEAM_MEMBER);
    expect(unfiltered.data.map((t: any) => t.name)).not.toContain('Task 250');
    expect(unfiltered.summary).toMatch(/Use nameContains, status or assignedTo/);
    const r = await executor.execute('list_tasks', { scheduleId: 's1', nameContains: 'task 250' }, TEAM_MEMBER);
    expect(r.data.map((t: any) => t.name)).toEqual(['Task 250']);
    expect(r.summary).toMatch(/Found 1 tasks .*matching name contains "task 250" \(of 300\)/);
  });

  it('status and assignedTo filter before the cap too', async () => {
    ss.findById.mockResolvedValue({ id: 's1', name: 'Big plan', projectId: 'mine' });
    ss.findTasksByScheduleId.mockResolvedValue(tasks(300).map((t, i) => ({ ...t, status: i === 280 ? 'blocked' : t.status, assignedTo: i === 290 ? 'res-jane' : null })));
    expect((await executor.execute('list_tasks', { scheduleId: 's1', status: 'blocked' }, TEAM_MEMBER)).data.map((t: any) => t.name)).toEqual(['Task 280']);
    // by part of the person's name (looked up among the people), or by their id
    expect((await executor.execute('list_tasks', { scheduleId: 's1', assignedTo: 'jane' }, TEAM_MEMBER)).data.map((t: any) => t.name)).toEqual(['Task 290']);
    expect((await executor.execute('list_tasks', { scheduleId: 's1', assignedTo: 'res-jane' }, TEAM_MEMBER)).data.map((t: any) => t.name)).toEqual(['Task 290']);
    expect((await executor.execute('list_tasks', { scheduleId: 's1', assignedTo: 'bob' }, TEAM_MEMBER)).data).toEqual([]);
  });

  it('a short list is left whole, with no note', async () => {
    ss.findById.mockResolvedValue({ id: 's1', name: 'Small plan', projectId: 'mine' });
    ss.findTasksByScheduleId.mockResolvedValue(tasks(3));
    const r = await executor.execute('list_tasks', { scheduleId: 's1' }, TEAM_MEMBER);
    expect(r.data).toHaveLength(3);
    expect(r.summary).not.toMatch(/Showing/);
  });

  it('get_project_details carries at most 200 tasks across plans, each plan with its count', async () => {
    ps.findById.mockResolvedValue({ id: 'mine', name: 'Mine', status: 'active' });
    ss.findByProjectId.mockResolvedValue([{ id: 's1', name: 'A' }, { id: 's2', name: 'B' }]);
    ss.findTasksByScheduleIds.mockResolvedValue([...tasks(180, 's1'), ...tasks(180, 's2')]);
    const r = await executor.execute('get_project_details', { projectId: 'mine' }, TEAM_MEMBER);
    expect(r.data.schedules.map((x: any) => x.taskCount)).toEqual([180, 180]);
    expect(r.data.schedules.map((x: any) => x.tasks.length)).toEqual([180, 20]);
    expect(r.summary).toMatch(/Showing 200 of 360 tasks/);
  });

  it('get_overdue_tasks keeps the 200 most overdue', async () => {
    ps.findAccessible.mockResolvedValue([{ id: 'mine', name: 'Mine' }]);
    ss.findByProjectIds = vi.fn().mockResolvedValue([{ id: 's1', projectId: 'mine', name: 'A' }]);
    const old = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    ss.findTasksByScheduleIds.mockResolvedValue(Array.from({ length: 300 }, (_, i) => ({
      id: `t${i}`, scheduleId: 's1', name: `T${i}`, status: 'pending', dueDate: old(i + 1),
    })));
    const r = await executor.execute('get_overdue_tasks', {}, TEAM_MEMBER);
    expect(r.data).toHaveLength(200);
    expect(r.data[0].daysOverdue).toBeGreaterThanOrEqual(r.data[199].daysOverdue);
    expect(r.data[0].id).toBe('t299'); // the oldest first
    expect(r.summary).toMatch(/300 overdue.*Showing 200 of 300/);
  });
});

// audit 2026-10-10 access M6: a project correction is shown to everyone asking Mjuzi about it
describe('Mjuzi remember_correction — project corrections only by the project PM', () => {
  const executor = new AIActionExecutor();
  const store = agentMemoryService.store as unknown as ReturnType<typeof vi.fn>;
  const input = { correctionKey: 'pm', wrongValue: 'Sarah', correctValue: 'John', projectId: 'p1' };

  beforeEach(() => { vi.clearAllMocks(); });

  it("the project's Manager/Owner sets it for the project", async () => {
    roleCheck.mockResolvedValue({ ok: true });
    const r = await executor.execute('remember_correction', input, { userId: 'u-pm', userRole: 'project_manager' });
    expect(roleCheck).toHaveBeenCalledWith({ userId: 'u-pm', role: 'project_manager' }, 'p1', 'manager');
    expect(store).toHaveBeenCalledWith('mjuzi-chat', 'project', 'p1', 'correction:pm', expect.any(Object));
    expect(r.summary).toMatch(/for this project/);
  });

  it("anyone else's correction is kept as their own, never on the project", async () => {
    roleCheck.mockResolvedValue({ ok: false, status: 403, body: {} });
    const r = await executor.execute('remember_correction', input, { userId: 'u-viewer', userRole: 'team_member' });
    expect(store).toHaveBeenCalledWith('mjuzi-chat', 'role', 'u-viewer', 'correction:pm', expect.any(Object));
    expect(store).not.toHaveBeenCalledWith('mjuzi-chat', 'project', 'p1', expect.anything(), expect.anything());
    expect(r.summary).toMatch(/for you \(only the project's Manager/);
  });
});
