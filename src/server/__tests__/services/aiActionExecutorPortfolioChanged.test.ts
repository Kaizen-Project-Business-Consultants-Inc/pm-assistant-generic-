import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Mjuzi's changes go through /api/v1/ai-chat, which the "something changed" counter skips (it is
 * mostly talk), so the dashboard numbers kept the old portfolio after Mjuzi created a project
 * (2026-10-11). Its write tools now count as a change (even one that failed half-way); reads and refusals don't.
 */

const marks = vi.hoisted(() => ({ markCurrentCompanyChanged: vi.fn() }));
vi.mock('../../utils/portfolioChanges', () => marks);
vi.mock('../../services/ProjectService', () => ({
  projectService: {
    create: vi.fn(async (d: any) => ({ id: 'p-new', name: d.name })),
    findAccessible: vi.fn(async () => []),
    findById: vi.fn(async (id: string) => ({ id, name: 'Alpha' })),
    update: vi.fn(async (id: string, d: any) => ({ id, ...d })),
  },
}));
vi.mock('../../middleware/requireProjectAccess', () => ({ checkProjectRoleFor: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { create: vi.fn(async () => ({ id: 's-new' })) } }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../services/PolicyEngineService', () => ({ policyEngineService: { evaluate: vi.fn().mockResolvedValue({ allowed: true, matchedPolicies: [] }) } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: vi.fn() } }));
vi.mock('../../services/AgentMemoryService', () => ({ agentMemoryService: { store: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../services/KnowledgeBaseService', () => ({ knowledgeBaseService: {} }));

import { AIActionExecutor } from '../../services/aiActionExecutor';
import { projectService } from '../../services/ProjectService';
import { checkProjectRoleFor } from '../../middleware/requireProjectAccess';

const ctx = { userId: 'u1', userRole: 'project_manager' } as any;

describe('Mjuzi changes count as portfolio changes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creating a project marks the company as changed', async () => {
    const r = await new AIActionExecutor().execute('create_project', { name: 'New one' }, ctx);
    expect(r.success).toBe(true);
    expect(marks.markCurrentCompanyChanged).toHaveBeenCalled();
  });

  it('a read (list projects) does not', async () => {
    await new AIActionExecutor().execute('list_projects', {}, ctx);
    expect(marks.markCurrentCompanyChanged).not.toHaveBeenCalled();
  });

  it('changing a project (one of the write tools) marks it', async () => {
    const r = await new AIActionExecutor().execute('update_project', { projectId: 'p1', name: 'Renamed' }, ctx);
    expect(r.success).toBe(true);
    expect(marks.markCurrentCompanyChanged).toHaveBeenCalled();
  });

  it('a write that fails half-way still marks it (its first part may be saved)', async () => {
    vi.mocked(projectService.update).mockRejectedValueOnce(new Error('db down'));
    const r = await new AIActionExecutor().execute('update_project', { projectId: 'p1', name: 'X' }, ctx);
    expect(r.success).toBe(false);
    expect(marks.markCurrentCompanyChanged).toHaveBeenCalledTimes(1);
  });

  it('a change refused (not the Manager/Owner) does not — nothing was written', async () => {
    vi.mocked(checkProjectRoleFor).mockResolvedValueOnce({ ok: false } as never);
    const r = await new AIActionExecutor().execute('update_project', { projectId: 'p1', name: 'X' }, ctx);
    expect(r.success).toBe(false);
    expect(marks.markCurrentCompanyChanged).not.toHaveBeenCalled();
  });
});
