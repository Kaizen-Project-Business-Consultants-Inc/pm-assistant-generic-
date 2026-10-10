import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mjuzi's reschedule tools count WORKING days (2026-09-29): dates the AI gives are kept,
// anything derived (the other end of the task, successors) uses the project calendar.

vi.mock('../../services/ProjectService', () => ({ projectService: {} }));
vi.mock('../../middleware/requireProjectAccess', () => ({ checkProjectRoleFor: vi.fn() }));
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTaskById: vi.fn(),
    updateTask: vi.fn(),
    workingDayTest: vi.fn(),
    findAllDownstreamTasks: vi.fn(),
  },
  DependencyValidationError: class extends Error {},
}));
vi.mock('../../services/followSuccessors', () => ({ moveSuccessorsAfter: vi.fn() }));
vi.mock('../../services/UserService', () => ({ userService: {} }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: { append: vi.fn().mockResolvedValue(undefined) } }));
vi.mock('../../services/PolicyEngineService', () => ({ policyEngineService: { evaluate: vi.fn() } }));
vi.mock('../../services/DeadLetterService', () => ({ deadLetterService: { capture: vi.fn() } }));
vi.mock('../../services/AgentMemoryService', () => ({ agentMemoryService: {} }));
vi.mock('../../services/KnowledgeBaseService', () => ({ knowledgeBaseService: {} }));

import { AIActionExecutor } from '../../services/aiActionExecutor';
import { scheduleService } from '../../services/ScheduleService';
import { moveSuccessorsAfter } from '../../services/followSuccessors';
import { weekdaysOnly } from '../../utils/workingDays';

const ss = scheduleService as unknown as Record<string, ReturnType<typeof vi.fn>>;
const CTX = { userId: 'u1', userRole: 'admin' };
const follow = moveSuccessorsAfter as unknown as ReturnType<typeof vi.fn>;
const BUILD = { id: 't1', name: 'Build', scheduleId: 's1', startDate: '2026-10-05', endDate: '2026-10-09' };

describe('Mjuzi reschedule tools — working days', () => {
  const executor = new AIActionExecutor() as any;

  beforeEach(() => {
    vi.clearAllMocks();
    ss.workingDayTest.mockResolvedValue(weekdaysOnly);
    follow.mockResolvedValue({ affectedTasks: [] });
    // Mon 5 Oct – Fri 9 Oct 2026: five working days
    ss.findTaskById.mockResolvedValue(BUILD);
  });

  describe('cascade_reschedule', () => {
    it('keeps the given start, derives the finish in working days, and successors follow through the shared re-flow', async () => {
      const saved = { ...BUILD, startDate: '2026-10-08', endDate: '2026-10-14' };
      ss.updateTask.mockResolvedValue(saved);
      follow.mockResolvedValue({ affectedTasks: [
        { taskId: 't2', taskName: 'Test', newStartDate: '2026-10-19', newEndDate: '2026-10-20' },
      ] });
      // Start moved to Thu 8 Oct: five working days → Wed 14 Oct (over the weekend)
      const r = await executor.cascadeReschedule({ taskId: 't1', newStartDate: '2026-10-08' }, CTX);
      expect(ss.updateTask).toHaveBeenCalledWith('t1', { startDate: '2026-10-08', endDate: '2026-10-14' });
      expect(follow).toHaveBeenCalledWith(BUILD, saved);
      expect(ss.findAllDownstreamTasks).not.toHaveBeenCalled(); // no calendar-day shifting of its own
      expect(r.success).toBe(true);
      expect(r.data.affectedTasks).toEqual([{ id: 't2', name: 'Test', newStart: '2026-10-19', newEnd: '2026-10-20' }]);
      expect(r.data.deltaDays).toBe(3);
      expect(r.summary).toContain('3 working days forward');
    });

    it('keeps the given finish and derives the start back in working days', async () => {
      // Finish Tue 13 Oct, five working days → Wed 7 Oct
      await executor.cascadeReschedule({ taskId: 't1', newEndDate: '2026-10-13' }, CTX);
      expect(ss.updateTask).toHaveBeenCalledWith('t1', { startDate: '2026-10-07', endDate: '2026-10-13' });
    });

    it('a given finish on a day off is kept; the derived start still lands on a working day', async () => {
      // Sat 10 Oct: the five working days are Mon 5 – Fri 9
      await executor.cascadeReschedule({ taskId: 't1', newEndDate: '2026-10-10' }, CTX);
      expect(ss.updateTask).toHaveBeenCalledWith('t1', { startDate: '2026-10-05', endDate: '2026-10-10' });
    });

    it('keeps both given dates as they are', async () => {
      await executor.cascadeReschedule({ taskId: 't1', newStartDate: '2026-10-12', newEndDate: '2026-10-30' }, CTX);
      expect(ss.updateTask).toHaveBeenCalledWith('t1', { startDate: '2026-10-12', endDate: '2026-10-30' });
    });

    it('refuses with no dates', async () => {
      const r = await executor.cascadeReschedule({ taskId: 't1' }, CTX);
      expect(r.success).toBe(false);
      expect(ss.updateTask).not.toHaveBeenCalled();
      expect(follow).not.toHaveBeenCalled();
    });
  });

  describe('reschedule_task', () => {
    it('writes the dates as given, then successors that now start too early are pushed', async () => {
      const saved = { id: 't1', name: 'Build', startDate: '2026-10-05', endDate: '2026-10-16' };
      ss.updateTask.mockResolvedValue(saved);
      follow.mockResolvedValue({ affectedTasks: [
        { taskId: 't2', taskName: 'Test', newStartDate: '2026-10-19', newEndDate: '2026-10-20' },
      ] });
      const r = await executor.rescheduleTask({ taskId: 't1', endDate: '2026-10-16' }, CTX);
      expect(ss.updateTask).toHaveBeenCalledWith('t1', { endDate: new Date('2026-10-16') });
      expect(follow).toHaveBeenCalledWith(BUILD, saved);
      expect(r.summary).toContain('1 downstream task moved');
    });

    it('says nothing about downstream tasks when none had to move', async () => {
      ss.updateTask.mockResolvedValue({ id: 't1', name: 'Build', startDate: '2026-10-06', endDate: '2026-10-09' });
      const r = await executor.rescheduleTask({ taskId: 't1', startDate: '2026-10-06' }, CTX);
      expect(r.summary).not.toContain('downstream');
    });
  });
});
