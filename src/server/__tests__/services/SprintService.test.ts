import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/SprintRepository', () => {
  const mockRepo = {
    create: vi.fn(),
    findByProject: vi.fn().mockResolvedValue([]),
    findByProjectPaginated: vi.fn().mockResolvedValue({ rows: [], total: 0 }),
    findBySchedule: vi.fn().mockResolvedValue([]),
    findById: vi.fn().mockResolvedValue(null),
    update: vi.fn(),
    deleteSprint: vi.fn(),
    addTask: vi.fn(),
    removeTask: vi.fn(),
    updateStatus: vi.fn(),
    getSprintBoard: vi.fn().mockResolvedValue({ scheduleId: null, tasks: [] }),
    getTotalPoints: vi.fn().mockResolvedValue(0),
    getCompletedTasksWithDates: vi.fn().mockResolvedValue([]),
    getSprintTasksWithAddedDates: vi.fn().mockResolvedValue([]),
    getVelocityHistory: vi.fn().mockResolvedValue([]),
  };
  return { sprintRepository: mockRepo };
});

// Project calendar: Mon–Fri unless a test says otherwise
const mockWorkingDayTest = vi.fn(async (_id?: string): Promise<(d: Date) => boolean> => (d: Date) => d.getUTCDay() !== 0 && d.getUTCDay() !== 6);
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: { workingDayTest: (...args: any[]) => mockWorkingDayTest(...(args as [string])) },
}));

vi.mock('../../services/StatusDateService', () => ({
  statusDateFor: vi.fn(async () => '2026-01-07'),
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: { append: vi.fn().mockResolvedValue({}) },
}));

vi.mock('../../services/DeadLetterService', () => ({
  deadLetterService: { capture: vi.fn() },
}));

import { SprintService } from '../../services/SprintService';
import { sprintRepository } from '../../database/SprintRepository';

const mockRepo = sprintRepository as any;

const sampleSprint = {
  id: 's1', projectId: 'p1', scheduleId: 'sch1', name: 'Sprint 1',
  goal: 'Deliver MVP', startDate: '2026-01-01', endDate: '2026-01-14',
  status: 'planning', velocityCommitment: 20, createdBy: 'u1',
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

describe('SprintService', () => {
  let service: SprintService;

  beforeEach(() => {
    service = new SprintService();
    vi.clearAllMocks();
  });

  describe('create', () => {
    it('creates sprint and logs audit', async () => {
      mockRepo.create.mockResolvedValueOnce(sampleSprint);
      const sprint = await service.create('p1', 'sch1', {
        name: 'Sprint 1', startDate: '2026-01-01', endDate: '2026-01-14',
      }, 'u1');
      expect(sprint.name).toBe('Sprint 1');
      expect(mockRepo.create).toHaveBeenCalledOnce();
    });
  });

  describe('getByProject', () => {
    it('delegates to repository', async () => {
      mockRepo.findByProject.mockResolvedValueOnce([sampleSprint]);
      const sprints = await service.getByProject('p1');
      expect(sprints).toHaveLength(1);
    });
  });

  describe('getById', () => {
    it('returns sprint when found', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleSprint);
      const sprint = await service.getById('s1');
      expect(sprint).not.toBeNull();
      expect(sprint!.name).toBe('Sprint 1');
    });

    it('returns null when not found', async () => {
      const sprint = await service.getById('nonexistent');
      expect(sprint).toBeNull();
    });
  });

  describe('startSprint', () => {
    it('updates status to active', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleSprint);
      mockRepo.updateStatus.mockResolvedValueOnce({ ...sampleSprint, status: 'active' });
      const sprint = await service.startSprint('s1');
      expect(sprint.status).toBe('active');
      expect(mockRepo.updateStatus).toHaveBeenCalledWith('s1', 'active');
    });
  });

  describe('completeSprint', () => {
    it('updates status to completed', async () => {
      mockRepo.findById.mockResolvedValueOnce(sampleSprint);
      mockRepo.updateStatus.mockResolvedValueOnce({ ...sampleSprint, status: 'completed' });
      const sprint = await service.completeSprint('s1');
      expect(sprint.status).toBe('completed');
    });
  });

  describe('addTask', () => {
    it('adds task and logs audit', async () => {
      mockRepo.addTask.mockResolvedValueOnce({ id: 'st1', sprintId: 's1', taskId: 't1', storyPoints: 5, addedAt: '2026-01-01' });
      mockRepo.findById.mockResolvedValueOnce(sampleSprint);
      const st = await service.addTask('s1', 't1', 5);
      expect(st.storyPoints).toBe(5);
    });
  });

  describe('removeTask', () => {
    it('delegates to repository', async () => {
      await service.removeTask('s1', 't1');
      expect(mockRepo.removeTask).toHaveBeenCalledWith('s1', 't1');
    });
  });

  describe('getSprintBurndown', () => {
    it('returns empty burndown when sprint not found', async () => {
      const result = await service.getSprintBurndown('nonexistent');
      expect(result.dates).toHaveLength(0);
      expect(result.totalPoints).toBe(0);
    });

    it('computes burndown with ideal and actual lines', async () => {
      mockRepo.findById.mockResolvedValueOnce({
        ...sampleSprint,
        startDate: '2026-01-01',
        endDate: '2026-01-06', // 5-day sprint
      });
      mockRepo.getTotalPoints.mockResolvedValueOnce(10);
      mockRepo.getCompletedTasksWithDates.mockResolvedValueOnce([
        { story_points: 3, updated_at: '2026-01-02' },
        { story_points: 4, updated_at: '2026-01-04' },
      ]);

      const result = await service.getSprintBurndown('s1');
      expect(result.totalPoints).toBe(10);
      expect(result.dates).toHaveLength(6); // day 0 through day 5
      expect(result.ideal[0]).toBe(10); // start at totalPoints
      expect(result.ideal[result.ideal.length - 1]).toBe(0); // end at 0
    });

    it('ideal line burns only on working days — flat over the weekend', async () => {
      // Thu 1 – Wed 7 Jan: working days after the start are Fri 2, Mon 5, Tue 6, Wed 7 = 4
      mockRepo.findById.mockResolvedValueOnce({ ...sampleSprint, startDate: '2026-01-01', endDate: '2026-01-07' });
      mockRepo.getTotalPoints.mockResolvedValueOnce(8);

      const result = await service.getSprintBurndown('s1');
      expect(mockWorkingDayTest).toHaveBeenCalledWith('sch1');
      expect(result.dates).toEqual(['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04', '2026-01-05', '2026-01-06', '2026-01-07']);
      expect(result.ideal).toEqual([8, 6, 6, 6, 4, 2, 0]);
      // Status date Wed 7 Jan → no working days left after it
      expect(result.daysRemaining).toBe(0);
    });

    it('a project holiday is flat too, and days remaining count working days', async () => {
      // Mon 5 Jan is a holiday: burn days are Fri 2, Tue 6, Wed 7, Thu 8 = 4
      mockWorkingDayTest.mockResolvedValueOnce((d: Date) =>
        d.getUTCDay() !== 0 && d.getUTCDay() !== 6 && d.toISOString().slice(0, 10) !== '2026-01-05');
      mockRepo.findById.mockResolvedValueOnce({ ...sampleSprint, startDate: '2026-01-01', endDate: '2026-01-08' });
      mockRepo.getTotalPoints.mockResolvedValueOnce(8);

      const result = await service.getSprintBurndown('s1');
      expect(result.ideal).toEqual([8, 6, 6, 6, 6, 4, 2, 0]);
      expect(result.daysRemaining).toBe(1); // Thu 8 Jan, after the Wed 7 Jan status date
    });
  });

  describe('getVelocityHistory', () => {
    it('returns sprint velocity data', async () => {
      mockRepo.getVelocityHistory.mockResolvedValueOnce([
        { name: 'Sprint 1', velocity: 20, commitment: 25 },
      ]);
      const result = await service.getVelocityHistory('p1');
      expect(result.sprints).toHaveLength(1);
      expect(result.sprints[0].velocity).toBe(20);
    });
  });
});
