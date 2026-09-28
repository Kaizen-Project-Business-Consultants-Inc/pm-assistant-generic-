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
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../services/PolicyEngineService', () => ({ policyEngineService: { evaluate: vi.fn().mockResolvedValue({ allowed: true, matchedPolicies: [] }) } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: vi.fn() } }));
vi.mock('../../services/AgentMemoryService', () => ({ agentMemoryService: {} }));
vi.mock('../../services/KnowledgeBaseService', () => ({ knowledgeBaseService: {} }));

import { AIActionExecutor } from '../../services/aiActionExecutor';
import { projectService } from '../../services/ProjectService';
import { scheduleService } from '../../services/ScheduleService';
import { checkProjectRoleFor } from '../../middleware/requireProjectAccess';

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
