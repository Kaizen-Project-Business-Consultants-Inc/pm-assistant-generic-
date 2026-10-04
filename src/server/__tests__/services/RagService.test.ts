import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock database
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
  },
}));

// Mock config
vi.mock('../../config', () => ({
  config: {
    OPENAI_API_KEY: 'sk-test-key',
    EMBEDDING_ENABLED: true,
    EMBEDDING_MODEL: 'text-embedding-3-small',
    EMBEDDING_DIMENSIONS: 1536,
    RAG_TOP_K: 5,
    RAG_SIMILARITY_THRESHOLD: 0.3,
  },
}));

import { RagService } from '../../services/RagService';
import { EmbeddingService } from '../../services/EmbeddingService';
import { databaseService } from '../../database/connection';
import type { LessonLearned } from '../../schemas/lessonsLearnedSchemas';
import type { MeetingAnalysis } from '../../schemas/meetingSchemas';

describe('RagService', () => {
  let ragService: RagService;
  let embeddingService: EmbeddingService;

  beforeEach(() => {
    embeddingService = new EmbeddingService();
    ragService = new RagService(embeddingService);
    vi.clearAllMocks();
  });

  // --- isAvailable ---
  describe('isAvailable', () => {
    it('returns true when embedding service is available', () => {
      expect(ragService.isAvailable()).toBe(true);
    });
  });

  // --- indexLesson ---
  describe('indexLesson', () => {
    it('calls upsertEmbedding with correct text', async () => {
      const spy = vi.spyOn(embeddingService, 'upsertEmbedding').mockResolvedValue({ id: 'emb-1', skipped: false });

      const lesson: LessonLearned = {
        id: 'lesson-1',
        projectId: 'proj-1',
        projectName: 'Test Project',
        projectType: 'construction',
        category: 'budget',
        title: 'Budget overrun',
        description: 'The project exceeded budget by 20%',
        impact: 'negative',
        recommendation: 'Add contingency reserves',
        confidence: 80,
        createdAt: '2025-01-01T00:00:00Z',
      };

      await ragService.indexLesson(lesson);

      expect(spy).toHaveBeenCalledWith(
        'lesson',
        'lesson-1',
        expect.stringContaining('budget'),
      );
      expect(spy).toHaveBeenCalledWith(
        'lesson',
        'lesson-1',
        expect.stringContaining('Budget overrun'),
      );
    });

    it('does not throw on embedding failure', async () => {
      vi.spyOn(embeddingService, 'upsertEmbedding').mockRejectedValue(new Error('API down'));

      const lesson: LessonLearned = {
        id: 'lesson-2',
        projectId: 'proj-1',
        projectName: 'Test',
        projectType: 'it',
        category: 'schedule',
        title: 'Delay',
        description: 'Late',
        impact: 'negative',
        recommendation: 'Fix',
        confidence: 50,
        createdAt: '2025-01-01T00:00:00Z',
      };

      // Should not throw
      await ragService.indexLesson(lesson);
    });
  });

  // --- indexMeeting ---
  describe('indexMeeting', () => {
    it('calls upsertEmbedding with correct text', async () => {
      const spy = vi.spyOn(embeddingService, 'upsertEmbedding').mockResolvedValue({ id: 'emb-2', skipped: false });

      const analysis: MeetingAnalysis = {
        id: 'ma-1',
        projectId: 'proj-1',
        scheduleId: 'sched-1',
        transcript: 'Full transcript...',
        summary: 'Team discussed budget issues',
        actionItems: [{ description: 'Review budget', assignee: 'Alice', priority: 'high' }],
        decisions: [{ decision: 'Cut scope' }],
        risks: [{ description: 'Budget overrun', severity: 'high' }],
        taskUpdates: [],
        appliedItems: [],
        createdAt: '2025-01-01T00:00:00Z',
      };

      await ragService.indexMeeting(analysis);

      expect(spy).toHaveBeenCalledWith(
        'meeting',
        'ma-1',
        expect.stringContaining('budget issues'),
      );
    });
  });

  // --- search ---
  describe('search', () => {
    it('returns enriched results with full documents', async () => {
      vi.spyOn(embeddingService, 'searchSimilar').mockResolvedValue([
        { documentType: 'lesson', documentId: 'lesson-1', score: 0.85 },
      ]);

      vi.mocked(databaseService.query).mockResolvedValueOnce([
        {
          id: 'lesson-1',
          project_id: 'proj-1',
          project_name: 'Test',
          project_type: 'it',
          category: 'budget',
          title: 'Budget overrun',
          description: 'Over budget',
          impact: 'negative',
          recommendation: 'Fix it',
          confidence: 80,
          created_at: '2025-01-01T00:00:00Z',
        },
      ] as any);

      const results = await ragService.search('budget problems');

      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.85);
      expect(results[0].document).not.toBeNull();
      expect((results[0].document as LessonLearned).title).toBe('Budget overrun');
    });

    it('returns empty when service unavailable', async () => {
      vi.spyOn(embeddingService, 'isAvailable').mockReturnValue(false);

      const results = await ragService.search('anything');
      expect(results).toEqual([]);
    });
  });

  // --- buildContextString ---
  describe('buildContextString', () => {
    it('produces formatted text', async () => {
      vi.spyOn(embeddingService, 'searchSimilar').mockResolvedValue([
        { documentType: 'lesson', documentId: 'lesson-1', score: 0.9 },
      ]);

      vi.mocked(databaseService.query).mockResolvedValueOnce([
        {
          id: 'lesson-1',
          project_id: 'proj-1',
          project_name: 'Test Project',
          project_type: 'construction',
          category: 'budget',
          title: 'Budget overrun',
          description: 'Exceeded budget by 20%',
          impact: 'negative',
          recommendation: 'Add contingency',
          confidence: 80,
          created_at: '2025-01-01T00:00:00Z',
        },
      ] as any);

      const context = await ragService.buildContextString('budget issues', 'all');
      expect(context).toContain('Relevant Historical Context');
      expect(context).toContain('Budget overrun');
      expect(context).toContain('0.90');
    });

    it('returns empty string when no results', async () => {
      vi.spyOn(embeddingService, 'searchSimilar').mockResolvedValue([]);

      const context = await ragService.buildContextString('nothing', 'all');
      expect(context).toBe('');
    });
  });
});
