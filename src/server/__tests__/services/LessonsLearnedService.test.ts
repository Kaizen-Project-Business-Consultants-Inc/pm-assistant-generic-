import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../services/claudeService', () => ({
  claudeService: { isAvailable: () => false },
  PromptTemplate: class {
    constructor(public template: string, public version: string) {}
    render(vars: Record<string, string>) { return this.template; }
  },
}));

vi.mock('../../services/ProjectService', () => ({
  projectService: { findAll: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../services/ScheduleService', () => ({
  scheduleService: {
    findByProjectId: vi.fn().mockResolvedValue([]),
    findTasksByScheduleId: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../services/RagService', () => ({
  ragService: { isAvailable: () => false, indexLesson: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('../../config', () => ({
  config: { AI_ENABLED: false },
}));

import { LessonsLearnedService } from '../../services/LessonsLearnedService';
import { databaseService } from '../../database/connection';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;

describe('LessonsLearnedService', () => {
  let service: LessonsLearnedService;

  beforeEach(() => {
    service = new LessonsLearnedService();
    vi.clearAllMocks();
  });

  describe('getLessons', () => {
    it('returns lessons with pagination', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: 'l1', project_id: 'p1', project_name: 'Alpha', project_type: 'it',
          category: 'schedule', title: 'On time', description: 'Good',
          impact: 'positive', recommendation: 'Keep it up', confidence: 80,
          created_at: '2026-01-01',
        },
      ]);

      const results = await service.getLessons(10, 0);
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('l1');
      expect(results[0].projectName).toBe('Alpha');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LIMIT ? OFFSET ?'),
        [10, 0],
      );
    });

    it('defaults to limit 20 offset 0', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await service.getLessons();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.any(String),
        [20, 0],
      );
    });
  });

  describe('countLessons', () => {
    it('returns count as number', async () => {
      mockQuery.mockResolvedValueOnce([{ cnt: 15 }]);
      const count = await service.countLessons();
      expect(count).toBe(15);
    });

    it('returns 0 when no rows', async () => {
      mockQuery.mockResolvedValueOnce([{}]);
      const count = await service.countLessons();
      expect(count).toBe(0);
    });
  });

  describe('addLesson', () => {
    it('persists lesson and returns it', async () => {
      mockQuery.mockResolvedValueOnce([]); // INSERT

      const result = await service.addLesson({
        projectId: 'p1',
        projectName: 'Alpha',
        projectType: 'it',
        category: 'budget',
        title: 'Budget overrun',
        description: 'Exceeded by 20%',
        impact: 'negative',
        recommendation: 'Better estimates',
      });

      expect(result.projectId).toBe('p1');
      expect(result.category).toBe('budget');
      expect(result.title).toBe('Budget overrun');
      expect(result.confidence).toBe(80); // default
      expect(result.id).toMatch(/^ll-manual-/);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('uses custom confidence when provided', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await service.addLesson({
        projectId: 'p1',
        projectName: 'Alpha',
        projectType: 'it',
        category: 'schedule',
        title: 'Test',
        description: 'Test',
        impact: 'neutral',
        recommendation: 'Test',
        confidence: 55,
      });

      expect(result.confidence).toBe(55);
    });
  });

  describe('updateLesson', () => {
    it('updates fields and returns true', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 });

      const updated = await service.updateLesson('l1', {
        title: 'Updated Title',
        description: 'Updated Desc',
      });

      expect(updated).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE lessons_learned SET'),
        expect.arrayContaining(['Updated Title', 'Updated Desc', 'l1']),
      );
    });

    it('returns false when no fields provided', async () => {
      const updated = await service.updateLesson('l1', {});
      expect(updated).toBe(false);
    });
  });

  describe('deleteLesson', () => {
    it('returns true on successful delete', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 });
      const deleted = await service.deleteLesson('l1');
      expect(deleted).toBe(true);
    });

    it('returns false when lesson not found', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 0 });
      const deleted = await service.deleteLesson('nonexistent');
      expect(deleted).toBe(false);
    });
  });

  describe('findRelevantLessons', () => {
    it('filters by projectType and category', async () => {
      mockQuery.mockResolvedValueOnce([
        {
          id: 'l1', project_id: 'p1', project_name: 'Alpha', project_type: 'it',
          category: 'budget', title: 'Test', description: 'Test',
          impact: 'negative', recommendation: 'Fix', confidence: 70,
          created_at: '2026-01-01',
        },
      ]);

      const results = await service.findRelevantLessons('it', 'budget');
      expect(results).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('project_type = ?'),
        ['approved', 'it', 'budget'],
      );
    });

    it('returns approved lessons when no filters', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await service.findRelevantLessons();
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY confidence DESC'),
        ['approved'],
      );
    });
  });
});
