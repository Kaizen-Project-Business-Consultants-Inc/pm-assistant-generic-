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
});
