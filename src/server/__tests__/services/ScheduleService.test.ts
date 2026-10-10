import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: { append: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../services/DagWorkflowService', () => ({
  dagWorkflowService: {
    evaluateTaskChange: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../config', () => ({
  config: { APP_URL: 'https://pm.kpbc.ca' },
}));

vi.mock('../../services/WebSocketService', () => ({
  WebSocketService: { sendToUser: vi.fn(), broadcast: vi.fn() },
}));

vi.mock('../../services/EmailService', () => ({
  emailService: { sendNotificationEmail: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../services/UserService', () => ({
  userService: { findById: vi.fn().mockResolvedValue(null) },
}));

vi.mock('uuid', () => ({ v4: () => 'test-schedule-id' }));

import { ScheduleService } from '../../services/ScheduleService';
import { taskRepository } from '../../database/TaskRepository';
import { databaseService } from '../../database/connection';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;

const sampleScheduleRow = {
  id: 's1', project_id: 'p1', name: 'Sprint 1', description: 'First sprint',
  start_date: '2026-01-01', end_date: '2026-01-15',
  status: 'active', created_by: 'u1',
  created_at: '2026-01-01', updated_at: '2026-01-01',
};

const sampleTaskRow = {
  id: 't1', schedule_id: 's1', name: 'Task 1', description: 'Do something',
  status: 'pending', priority: 'medium', assigned_to: null,
  due_date: '2026-01-10', estimated_days: 5, estimated_duration_hours: 40,
  actual_duration_hours: null, start_date: '2026-01-01', end_date: '2026-01-05',
  progress_percentage: 0, dependency: null, dependency_type: null,
  risks: null, issues: null, comments: null, parent_task_id: null,
  recurrence_rule: null, recurrence_parent_id: null,
  is_recurrence_template: false, is_milestone: false,
  dependency_lag_days: 0, sort_order: 0, created_by: 'u1',
  created_at: '2026-01-01', updated_at: '2026-01-01',
};

describe('ScheduleService', () => {
  let service: ScheduleService;

  beforeEach(() => {
    service = new ScheduleService();
    vi.clearAllMocks();
  });

  describe('progressFromHoursTaskIds (% complete comes from approved hours)', () => {
    it('picks dated, non-heading, non-milestone tasks with someone planned on them', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 't1' }]);
      const set = await service.progressFromHoursTaskIds(['t1', 't2', 't1']);
      expect([...set]).toEqual(['t1']);
      const [sql, params] = mockQuery.mock.calls[0];
      expect(params).toEqual(['t1', 't2']);
      for (const part of ['start_date IS NOT NULL', 'end_date IS NOT NULL', 'is_milestone', 'is_summary', 'r.id = t.assigned_to', 'FROM task_assignments', 'FROM resource_assignments']) {
        expect(String(sql)).toContain(part);
      }
    });
    it('no tasks → no query', async () => {
      expect((await service.progressFromHoursTaskIds([])).size).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe('findByProjectId', () => {
    it('returns schedules for project', async () => {
      mockQuery.mockResolvedValueOnce([sampleScheduleRow]);
      const schedules = await service.findByProjectId('p1');
      expect(schedules).toHaveLength(1);
      expect(schedules[0].projectId).toBe('p1');
      expect(schedules[0].name).toBe('Sprint 1');
    });

    it('returns empty array when no schedules', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const schedules = await service.findByProjectId('p1');
      expect(schedules).toEqual([]);
    });
  });

  describe('findById', () => {
    it('returns schedule when found', async () => {
      mockQuery.mockResolvedValueOnce([sampleScheduleRow]);
      const schedule = await service.findById('s1');
      expect(schedule).not.toBeNull();
      expect(schedule!.id).toBe('s1');
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const schedule = await service.findById('nonexistent');
      expect(schedule).toBeNull();
    });
  });

  describe('create', () => {
    it('creates schedule and returns it', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([{ ...sampleScheduleRow, id: 'test-schedule-id' }]); // findById

      const schedule = await service.create({
        projectId: 'p1',
        name: 'Sprint 1',
        startDate: '2026-01-01',
        endDate: '2026-01-15',
        createdBy: 'u1',
      });

      expect(schedule.name).toBe('Sprint 1');
      expect(schedule.projectId).toBe('p1');
    });
  });

  describe('findTasksByScheduleId', () => {
    it('returns tasks with dependencies attached', async () => {
      mockQuery
        .mockResolvedValueOnce([sampleTaskRow]) // SELECT tasks
        .mockResolvedValueOnce([]); // SELECT task_dependencies

      const tasks = await service.findTasksByScheduleId('s1');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].name).toBe('Task 1');
      expect(tasks[0].dependencies).toEqual([]);
    });

    it('returns empty array when no tasks', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const tasks = await service.findTasksByScheduleId('s1');
      expect(tasks).toEqual([]);
    });

    it("each task carries the server's progressFromHours answer, from the same query the save uses", async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.startsWith('SELECT * FROM tasks WHERE schedule_id')) return [sampleTaskRow, { ...sampleTaskRow, id: 't2' }];
        if (sql.includes('FROM resource_assignments ra')) return [{ id: 't2' }];
        return [];
      });
      const tasks = await service.findTasksByScheduleId('s1');
      expect(tasks.map(t => [t.id, t.progressFromHours])).toEqual([['t1', false], ['t2', true]]);
      mockQuery.mockReset();
      mockQuery.mockResolvedValue([]);
    });
  });

  describe('findTaskById', () => {
    it('returns task with dependencies', async () => {
      mockQuery
        .mockResolvedValueOnce([sampleTaskRow]) // SELECT task
        .mockResolvedValueOnce([
          { id: 'd1', task_id: 't1', dependency_id: 't0', dependency_type: 'FS', lag_days: 0 },
        ]); // SELECT dependencies

      const task = await service.findTaskById('t1');
      expect(task).not.toBeNull();
      expect(task!.dependencies).toHaveLength(1);
      expect(task!.dependency).toBe('t0'); // legacy field synced
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const task = await service.findTaskById('nonexistent');
      expect(task).toBeNull();
    });
  });

  describe('delete', () => {
    it('returns true when schedule deleted', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 });
      const deleted = await service.delete('s1');
      expect(deleted).toBe(true);
    });

    it('returns false when schedule not found', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 0 });
      const deleted = await service.delete('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('loadDependenciesForTasks (via TaskRepository)', () => {
    it('returns map of dependencies keyed by task id', async () => {
      mockQuery.mockResolvedValueOnce([
        { id: 'd1', task_id: 't1', dependency_id: 't0', dependency_type: 'FS', lag_days: 2 },
        { id: 'd2', task_id: 't2', dependency_id: 't1', dependency_type: 'SS', lag_days: 0 },
      ]);

      const map = await taskRepository.loadDependenciesForTasks(['t1', 't2']);
      expect(map.get('t1')).toHaveLength(1);
      expect(map.get('t1')![0].lagDays).toBe(2);
      expect(map.get('t2')).toHaveLength(1);
    });

    it('returns empty map for empty input', async () => {
      const map = await taskRepository.loadDependenciesForTasks([]);
      expect(map.size).toBe(0);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });
  describe('recomputeParentRollup', () => {
    // A background re-price (task budgets, ~20 s after a change) rolls up quietly: a summary that
    // changes then is not "the plan changed since", which would block Undo in Schedule History
    it('quiet: keeps the summary task updated_at; a normal roll-up does not', async () => {
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('parent_task_id = ?')) return [{ ...sampleTaskRow, id: 'c1', parent_task_id: 'phase' }];
        if (sql.includes('FROM schedules')) return [sampleScheduleRow];
        if (sql.includes('FROM tasks')) return [{ ...sampleTaskRow, id: 'phase' }];
        return [];
      });
      await service.recomputeParentRollup('phase', 0, { quiet: true });
      const quiet = mockQuery.mock.calls.find(([sql]) => String(sql).includes('is_summary = 1'))!;
      expect(quiet[0]).toContain('updated_at = updated_at');
      mockQuery.mockClear();
      await service.recomputeParentRollup('phase');
      const normal = mockQuery.mock.calls.find(([sql]) => String(sql).includes('is_summary = 1'))!;
      expect(normal[0]).not.toContain('updated_at = updated_at');
      mockQuery.mockReset();
      mockQuery.mockResolvedValue([]);
    });

    // Work (effort hours) weights the summary's % only when the schedule's progressMode is 'work'
    // (2026-10-06: Work typed in the Gantt grid / Table is now saved, so this matters)
    it('work mode: a child\'s Work changes the summary %; duration mode: it does not', async () => {
      const rollupPct = async (mode: 'work' | 'duration', doneHours: number) => {
        mockQuery.mockReset();
        mockQuery.mockImplementation(async (sql: string) => {
          if (sql.includes('parent_task_id = ?')) return [
            { ...sampleTaskRow, id: 'done', parent_task_id: 'phase', progress_percentage: 100, estimated_days: 1, estimated_duration_hours: doneHours },
            { ...sampleTaskRow, id: 'todo', parent_task_id: 'phase', progress_percentage: 0, estimated_days: 1, estimated_duration_hours: 8 },
          ];
          if (sql.includes('FROM schedules')) return [{ ...sampleScheduleRow, progress_mode: mode }];
          if (sql.includes('FROM tasks')) return [{ ...sampleTaskRow, id: 'phase' }];
          return [];
        });
        await service.recomputeParentRollup('phase');
        const upd = mockQuery.mock.calls.find(([sql]) => String(sql).includes('is_summary = 1'))!;
        return (upd[1] as unknown[])[2]; // start, end, progress, …
      };
      expect(await rollupPct('work', 8)).toBe(50);
      expect(await rollupPct('work', 24)).toBe(75);
      expect(await rollupPct('duration', 8)).toBe(50);
      expect(await rollupPct('duration', 24)).toBe(50);
      mockQuery.mockReset();
      mockQuery.mockResolvedValue([]);
    });

    describe('audit 2026-10-09 M4', () => {
      const weekdays = (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6;
      const rollup = async (children: any[]) => {
        mockQuery.mockReset();
        mockQuery.mockImplementation(async (sql: string) => {
          if (sql.includes('parent_task_id = ?')) return children.map(c => ({ ...sampleTaskRow, parent_task_id: 'phase', ...c }));
          if (sql.includes('FROM schedules')) return [sampleScheduleRow];
          if (sql.includes('FROM tasks')) return [{ ...sampleTaskRow, id: 'phase' }];
          return [];
        });
        vi.spyOn(service, 'workingDayTest').mockResolvedValue(weekdays);
        await service.recomputeParentRollup('phase');
        const upd = mockQuery.mock.calls.find(([sql]) => String(sql).includes('is_summary = 1'))!;
        mockQuery.mockReset();
        mockQuery.mockResolvedValue([]);
        const [start, end, progress, status, , , days] = upd[1] as unknown[];
        return { start, end, progress, status, days };
      };

      it('a cancelled child counts in neither the % nor "all done": [done, cancelled] is a done summary', async () => {
        const r = await rollup([
          { id: 'a', status: 'completed', progress_percentage: 100 },
          { id: 'b', status: 'cancelled', progress_percentage: 0 },
        ]);
        expect(r).toMatchObject({ status: 'completed', progress: 100 });
      });

      it('every child cancelled: the summary is cancelled', async () => {
        const r = await rollup([{ id: 'a', status: 'cancelled' }, { id: 'b', status: 'cancelled' }]);
        expect(r.status).toBe('cancelled');
      });

      it('the summary duration is in working days: two back-to-back 5-day tasks (12–23 Oct) give 10, not 12', async () => {
        const r = await rollup([
          { id: 'a', start_date: '2026-10-12', end_date: '2026-10-16', estimated_days: 5 },
          { id: 'b', start_date: '2026-10-19', end_date: '2026-10-23', estimated_days: 5 },
        ]);
        expect(r).toMatchObject({ start: '2026-10-12', end: '2026-10-23', days: 10 });
      });
    });
  });
});
