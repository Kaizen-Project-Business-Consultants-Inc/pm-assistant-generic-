import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryControlPlane: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(),
  },
}));

vi.mock('../../config', () => ({
  config: { jwtSecret: 'test', port: 3001 },
}));

vi.mock('../../database/TimeEntryRepository', () => {
  const mockRepo = {
    insert: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    updateFields: vi.fn(),
    deleteById: vi.fn(),
    findByTask: vi.fn().mockResolvedValue([]),
    findByProject: vi.fn().mockResolvedValue([]),
    findByUserAndDateRange: vi.fn().mockResolvedValue([]),
    sumHoursBySchedule: vi.fn().mockResolvedValue([]),
  };
  return { timeEntryRepository: mockRepo };
});

vi.mock('../../database/TimesheetSubmissionRepository', () => ({
  timesheetSubmissionRepository: {
    findByScheduleProjectUserWeek: vi.fn().mockResolvedValue(null),
    insert: vi.fn(),
    updateStatus: vi.fn(),
    findById: vi.fn().mockResolvedValue(null),
    findPendingByReviewer: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findTasksByScheduleId: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../services/ProjectMemberService', () => ({
  projectMemberService: {
    hasRole: vi.fn().mockResolvedValue(true),
  },
}));

vi.mock('../../services/NotificationService', () => ({
  notificationService: {
    createNotification: vi.fn().mockResolvedValue(undefined),
  },
}));

import { TimeEntryService } from '../../services/TimeEntryService';
import { timeEntryRepository } from '../../database/TimeEntryRepository';
import { scheduleService } from '../../services/ScheduleService';

const mockRepo = timeEntryRepository as any;

const sampleEntry = {
  id: 'te1', taskId: 't1', scheduleId: 'sch1', projectId: 'p1',
  userId: 'u1', date: '2026-01-06', hours: 4, description: 'Coding',
  billable: true, createdAt: '2026-01-06', updatedAt: '2026-01-06',
};

describe('TimeEntryService', () => {
  let service: TimeEntryService;

  beforeEach(() => {
    service = new TimeEntryService();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates time entry with defaults', async () => {
      mockRepo.insert.mockResolvedValueOnce(sampleEntry);
      const entry = await service.create({
        taskId: 't1', scheduleId: 'sch1', projectId: 'p1',
        userId: 'u1', date: '2026-01-06', hours: 4, description: 'Coding',
      });
      expect(entry.hours).toBe(4);
      expect(mockRepo.insert).toHaveBeenCalledWith(
        expect.any(String), 't1', 'sch1', 'p1', 'u1', '2026-01-06', 4, 'Coding', true,
      );
    });

    it('respects billable=false', async () => {
      mockRepo.insert.mockResolvedValueOnce({ ...sampleEntry, billable: false });
      await service.create({
        taskId: 't1', scheduleId: 'sch1', projectId: 'p1',
        userId: 'u1', date: '2026-01-06', hours: 2, billable: false,
      });
      expect(mockRepo.insert.mock.calls[0][8]).toBe(false);
    });
  });

  describe('update', () => {
    it('updates specified fields', async () => {
      mockRepo.findById.mockResolvedValueOnce({ ...sampleEntry, hours: 6 });
      const entry = await service.update('te1', { hours: 6 });
      expect(mockRepo.updateFields).toHaveBeenCalledWith('te1', ['hours = ?'], [6]);
    });
  });

  describe('getByTask', () => {
    it('returns entries for task', async () => {
      mockRepo.findByTask.mockResolvedValueOnce([sampleEntry]);
      const entries = await service.getByTask('t1');
      expect(entries).toHaveLength(1);
    });
  });

  describe('getByProject', () => {
    it('passes date filters', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([]);
      await service.getByProject('p1', '2026-01-01', '2026-01-31');
      expect(mockRepo.findByProject).toHaveBeenCalledWith('p1', '2026-01-01', '2026-01-31');
    });
  });

  describe('getWeeklyTimesheet', () => {
    it('returns 7 days and total hours', async () => {
      mockRepo.findByUserAndDateRange.mockResolvedValueOnce([
        { ...sampleEntry, hours: 4 },
        { ...sampleEntry, id: 'te2', hours: 3 },
      ]);
      const result = await service.getWeeklyTimesheet('u1', '2026-01-06');
      expect(result.days).toHaveLength(7);
      expect(result.totalHours).toBe(7);
    });
  });

  describe('getActualVsEstimated', () => {
    it('computes actual vs estimated hours', async () => {
      (scheduleService.findTasksByScheduleId as any).mockResolvedValueOnce([
        { id: 't1', name: 'Task 1', estimatedDays: 2 },
        { id: 't2', name: 'Task 2', estimatedDays: 1 },
      ]);
      mockRepo.sumHoursBySchedule.mockResolvedValueOnce([
        { task_id: 't1', total: 12 },
      ]);

      const result = await service.getActualVsEstimated('sch1');
      expect(result.tasks).toHaveLength(2);
      expect(result.tasks[0].estimatedHours).toBe(16); // 2 days * 8
      expect(result.tasks[0].actualHours).toBe(12);
      expect(result.tasks[1].actualHours).toBe(0); // no time logged
    });
  });
});
