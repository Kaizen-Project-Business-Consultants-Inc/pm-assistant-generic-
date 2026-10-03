import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/ProjectMemberService', () => ({ projectMemberService: { findByUserId: vi.fn(), findMembership: vi.fn() } }));
vi.mock('../../services/ScheduleService', () => ({ scheduleService: { findById: vi.fn() } }));
vi.mock('../../services/ProjectService', () => ({ projectService: { findById: vi.fn() } }));

import { editableProjectIds, checkProjectRoleFor } from '../../middleware/requireProjectAccess';
import { projectMemberService } from '../../services/ProjectMemberService';
import { projectService } from '../../services/ProjectService';

const findByUserId = projectMemberService.findByUserId as ReturnType<typeof vi.fn>;
const findMembership = projectMemberService.findMembership as ReturnType<typeof vi.fn>;
const findProject = (projectService as any).findById as ReturnType<typeof vi.fn>;

// 2026-10-03: the dashboard showed "Start" on projects where a project manager was only a Viewer.
// The list now carries canEdit per project — it must agree with the rule the server enforces.
describe('editableProjectIds — which listed projects you may change', () => {
  const projects = [
    { id: 'mine', createdBy: 'u1' },            // created it, no membership row → owner
    { id: 'managed', createdBy: 'x' },          // member as manager
    { id: 'viewing', createdBy: 'x' },          // member as viewer
    { id: 'editor', createdBy: 'x' },           // legacy "editor" = read-only
    { id: 'demo', createdBy: 'x' },             // sample project, no membership
  ];
  beforeEach(() => {
    vi.clearAllMocks();
    findByUserId.mockResolvedValue([
      { projectId: 'managed', userId: 'u1', role: 'manager' },
      { projectId: 'viewing', userId: 'u1', role: 'viewer' },
      { projectId: 'editor', userId: 'u1', role: 'editor' },
    ]);
  });

  it('a project manager may change only what they own or manage', async () => {
    const ids = await editableProjectIds({ userId: 'u1', role: 'project_manager' }, projects);
    expect([...ids].sort()).toEqual(['managed', 'mine']);
  });

  it('admin and PMO may change everything; executives nothing; guests get no global pass', async () => {
    expect((await editableProjectIds({ userId: 'u1', role: 'admin' }, projects)).size).toBe(5);
    expect((await editableProjectIds({ userId: 'u1', role: 'pmo' }, projects)).size).toBe(5);
    expect((await editableProjectIds({ userId: 'u1', role: 'executive' }, projects)).size).toBe(0);
    expect([...(await editableProjectIds({ userId: 'u1', role: 'admin', isGuest: true }, projects))].sort()).toEqual(['managed', 'mine']);
  });

  it('agrees with the per-project check the server uses on every change', async () => {
    const editable = await editableProjectIds({ userId: 'u1', role: 'project_manager' }, projects);
    for (const p of projects) {
      const m = (await findByUserId('u1')).find((x: any) => x.projectId === p.id) ?? null;
      findMembership.mockResolvedValueOnce(m);
      findProject.mockResolvedValueOnce({ id: p.id, createdBy: p.createdBy, isDemo: p.id === 'demo' });
      const d = await checkProjectRoleFor({ userId: 'u1', role: 'project_manager' }, p.id, 'manager');
      expect([p.id, editable.has(p.id)]).toEqual([p.id, d.ok]);
    }
  });
});
