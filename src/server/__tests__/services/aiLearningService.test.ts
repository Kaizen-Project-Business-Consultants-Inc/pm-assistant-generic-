import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the service under test
// ---------------------------------------------------------------------------

vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: vi.fn().mockReturnValue(false),
    complete: vi.fn().mockResolvedValue({
      content: '{}',
      usage: { inputTokens: 100, outputTokens: 50 },
      latencyMs: 200,
    }),
  },
  PromptTemplate: vi.fn().mockImplementation((template: string) => ({
    render: vi.fn().mockReturnValue(template),
  })),
}));

vi.mock('../../services/aiUsageLogger', () => ({
  logAIUsage: vi.fn(),
}));

vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  return {
    ...actual,
    randomUUID: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { AILearningServiceV2 } from '../../services/aiLearningService';
import { databaseService } from '../../database/connection';
import { claudeService } from '../../services/claudeService';
import { logAIUsage } from '../../services/aiUsageLogger';
import logger from '../../utils/logger';
import { randomUUID } from 'crypto';
import type { AIFeedbackRecord, AIAccuracyRecord } from '../../schemas/phase5Schemas';

const mockRandomUUID = randomUUID as ReturnType<typeof vi.fn>;
const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;
const mockIsAvailable = claudeService.isAvailable as ReturnType<typeof vi.fn>;
const mockComplete = claudeService.complete as ReturnType<typeof vi.fn>;
const mockLogAIUsage = logAIUsage as ReturnType<typeof vi.fn>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AILearningServiceV2', () => {
  let service: AILearningServiceV2;

  beforeEach(async () => {
    // Flush any pending microtasks from fire-and-forget calls in prior tests
    await new Promise(r => setTimeout(r, 0));
    // resetAllMocks clears Once queues, call history, and implementations
    vi.resetAllMocks();
    // Re-establish defaults after reset
    mockQuery.mockResolvedValue([]);
    mockIsAvailable.mockReturnValue(false);
    mockRandomUUID.mockReturnValue('mock-uuid-1234');
    service = new AILearningServiceV2();
  });

  // =========================================================================
  // recordFeedback
  // =========================================================================

  describe('recordFeedback', () => {
    const baseFeedback: AIFeedbackRecord = {
      feature: 'risk_prediction',
      userAction: 'accepted',
    };

    it('inserts feedback with all fields', () => {
      const feedback: AIFeedbackRecord = {
        feature: 'cost_estimate',
        projectId: 'proj-1',
        userAction: 'modified',
        suggestionData: { value: 100 },
        modifiedData: { value: 120 },
        feedbackText: 'Too low',
      };

      service.recordFeedback(feedback, 'user-1');

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const args = mockQuery.mock.calls[0];
      expect(args[0]).toContain('INSERT INTO ai_feedback');
      expect(args[1]).toEqual([
        'mock-uuid-1234',
        'user-1',
        'proj-1',
        'cost_estimate',
        JSON.stringify({ value: 100 }),
        'modified',
        JSON.stringify({ value: 120 }),
        'Too low',
      ]);
    });

    it('inserts feedback with minimal fields (nulls for optionals)', () => {
      service.recordFeedback(baseFeedback, 'user-2');

      const args = mockQuery.mock.calls[0][1];
      expect(args[2]).toBeNull();  // projectId
      expect(args[4]).toBeNull();  // suggestionData
      expect(args[6]).toBeNull();  // modifiedData
      expect(args[7]).toBeNull();  // feedbackText
    });

    it('logs warning on query failure (fire-and-forget)', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB down'));

      service.recordFeedback(baseFeedback, 'user-1');

      // Allow the promise rejection to propagate
      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to record AI feedback'),
        );
      });
    });
  });

  // =========================================================================
  // recordAccuracy
  // =========================================================================

  describe('recordAccuracy', () => {
    const baseRecord: AIAccuracyRecord = {
      projectId: 'proj-1',
      metricType: 'duration_estimate',
      predictedValue: 10,
      actualValue: 8,
    };

    it('inserts accuracy record with computed variance', () => {
      service.recordAccuracy(baseRecord);

      expect(mockQuery).toHaveBeenCalledTimes(1);
      const args = mockQuery.mock.calls[0][1];
      expect(args[0]).toBe('mock-uuid-1234');
      expect(args[1]).toBe('proj-1');
      expect(args[2]).toBeNull();  // taskId
      expect(args[3]).toBe('duration_estimate');
      expect(args[4]).toBe(10);
      expect(args[5]).toBe(8);
      // variance = ((10 - 8) / 8) * 100 = 25.00
      expect(args[6]).toBe(25);
      expect(args[7]).toBeNull();  // projectType
    });

    it('computes negative variance for under-prediction', () => {
      service.recordAccuracy({ ...baseRecord, predictedValue: 6, actualValue: 8 });

      const variancePct = mockQuery.mock.calls[0][1][6];
      // ((6 - 8) / 8) * 100 = -25.00
      expect(variancePct).toBe(-25);
    });

    it('handles actualValue = 0 (variance defaults to 0)', () => {
      service.recordAccuracy({ ...baseRecord, predictedValue: 5, actualValue: 0 });

      const variancePct = mockQuery.mock.calls[0][1][6];
      expect(variancePct).toBe(0);
    });

    it('includes optional taskId and projectType', () => {
      service.recordAccuracy({
        ...baseRecord,
        taskId: 'task-1',
        projectType: 'software',
      });

      const args = mockQuery.mock.calls[0][1];
      expect(args[2]).toBe('task-1');
      expect(args[7]).toBe('software');
    });

    it('logs warning on query failure', async () => {
      mockQuery.mockRejectedValueOnce(new Error('insert failed'));

      service.recordAccuracy(baseRecord);

      await vi.waitFor(() => {
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to record AI accuracy'),
        );
      });
    });
  });

  // =========================================================================
  // getFeedbackStats
  // =========================================================================

  describe('getFeedbackStats', () => {
    it('returns zeroed stats when no rows', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const stats = await service.getFeedbackStats();

      expect(stats).toEqual({
        total: 0,
        accepted: 0,
        modified: 0,
        rejected: 0,
        acceptanceRate: 0,
      });
    });

    it('computes stats from grouped rows', async () => {
      mockQuery.mockResolvedValueOnce([
        { user_action: 'accepted', cnt: '7' },
        { user_action: 'modified', cnt: '2' },
        { user_action: 'rejected', cnt: '1' },
      ]);

      const stats = await service.getFeedbackStats();

      expect(stats.total).toBe(10);
      expect(stats.accepted).toBe(7);
      expect(stats.modified).toBe(2);
      expect(stats.rejected).toBe(1);
      expect(stats.acceptanceRate).toBe(70);
    });

    it('filters by feature when provided', async () => {
      mockQuery.mockResolvedValueOnce([
        { user_action: 'accepted', cnt: '3' },
      ]);

      await service.getFeedbackStats('risk_prediction');

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('WHERE feature = ?');
      expect(mockQuery.mock.calls[0][1]).toEqual(['risk_prediction']);
    });

    it('does not add WHERE clause when no feature filter', async () => {
      mockQuery.mockResolvedValueOnce([]);

      await service.getFeedbackStats();

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).not.toContain('WHERE feature = ?');
    });

    it('handles partial action types (only accepted)', async () => {
      mockQuery.mockResolvedValueOnce([
        { user_action: 'accepted', cnt: '5' },
      ]);

      const stats = await service.getFeedbackStats();

      expect(stats.total).toBe(5);
      expect(stats.modified).toBe(0);
      expect(stats.rejected).toBe(0);
      expect(stats.acceptanceRate).toBe(100);
    });
  });

  // =========================================================================
  // getAccuracyReport
  // =========================================================================

  describe('getAccuracyReport', () => {
    function mockReportQueries(
      overall = [{ total: '0', avg_var: null }],
      metric: any[] = [],
      typeRows: any[] = [],
      feedbackRows: any[] = [],
    ) {
      mockQuery
        .mockResolvedValueOnce(overall)   // overall query
        .mockResolvedValueOnce(metric)    // by metric
        .mockResolvedValueOnce(typeRows)  // by project type
        .mockResolvedValueOnce(feedbackRows); // feedback stats (getFeedbackStats)
    }

    it('returns empty report when no data', async () => {
      mockReportQueries();

      const report = await service.getAccuracyReport();

      expect(report.overall.totalRecords).toBe(0);
      expect(report.overall.averageVariance).toBe(0);
      expect(report.overall.accuracy).toBe(100);
      expect(report.byMetric).toEqual([]);
      expect(report.byProjectType).toEqual([]);
      expect(report.feedbackSummary.total).toBe(0);
      expect(report.improvements).toEqual([]);
    });

    it('computes overall accuracy correctly', async () => {
      mockReportQueries(
        [{ total: '20', avg_var: '15.5' }],
        [{ metric_type: 'duration_estimate', cnt: '20', avg_var: '15.5' }],
      );

      const report = await service.getAccuracyReport();

      expect(report.overall.totalRecords).toBe(20);
      expect(report.overall.averageVariance).toBe(15.5);
      expect(report.overall.accuracy).toBe(84.5);
    });

    it('clamps accuracy between 0 and 100', async () => {
      // avg_var = 150 => accuracy would be -50 but clamped to 0
      mockReportQueries(
        [{ total: '5', avg_var: '150' }],
        [{ metric_type: 'cost_estimate', cnt: '5', avg_var: '150' }],
      );

      const report = await service.getAccuracyReport();

      expect(report.overall.accuracy).toBe(0);
      expect(report.byMetric[0].accuracy).toBe(0);
    });

    it('populates byMetric and byProjectType arrays', async () => {
      mockReportQueries(
        [{ total: '30', avg_var: '10' }],
        [
          { metric_type: 'duration_estimate', cnt: '15', avg_var: '8.3' },
          { metric_type: 'cost_estimate', cnt: '15', avg_var: '11.7' },
        ],
        [
          { project_type: 'software', cnt: '20', avg_var: '9' },
          { project_type: 'construction', cnt: '10', avg_var: '12' },
        ],
      );

      const report = await service.getAccuracyReport();

      expect(report.byMetric).toHaveLength(2);
      expect(report.byMetric[0].metricType).toBe('duration_estimate');
      expect(report.byMetric[0].count).toBe(15);

      expect(report.byProjectType).toHaveLength(2);
      expect(report.byProjectType[1].projectType).toBe('construction');
    });

    it('adds improvement for low accuracy metrics', async () => {
      mockReportQueries(
        [{ total: '10', avg_var: '25' }],
        [{ metric_type: 'risk_prediction', cnt: '10', avg_var: '25' }], // 75% accuracy < 80%
      );

      const report = await service.getAccuracyReport();

      expect(report.improvements.length).toBeGreaterThanOrEqual(1);
      expect(report.improvements[0]).toContain('risk_prediction');
      expect(report.improvements[0]).toContain('recalibrating');
    });

    it('adds improvement for low acceptance rate', async () => {
      mockReportQueries(
        [{ total: '10', avg_var: '5' }],
        [{ metric_type: 'duration_estimate', cnt: '10', avg_var: '5' }], // 95% accuracy, no metric suggestion
        [],
        [
          { user_action: 'accepted', cnt: '2' },
          { user_action: 'rejected', cnt: '5' },
          { user_action: 'modified', cnt: '3' },
        ], // 20% acceptance, total=10 > 5
      );

      const report = await service.getAccuracyReport();

      expect(report.improvements).toEqual(
        expect.arrayContaining([
          expect.stringContaining('acceptance rate'),
        ]),
      );
    });

    it('adds positive message when all metrics are acceptable', async () => {
      mockReportQueries(
        [{ total: '10', avg_var: '5' }],
        [{ metric_type: 'duration_estimate', cnt: '10', avg_var: '5' }], // 95% > 80%
        [],
        [{ user_action: 'accepted', cnt: '8' }, { user_action: 'rejected', cnt: '2' }], // 80% acceptance > 60%
      );

      const report = await service.getAccuracyReport();

      expect(report.improvements).toEqual(['All prediction metrics are within acceptable accuracy ranges.']);
    });

    it('applies projectType filter to queries', async () => {
      mockReportQueries();

      await service.getAccuracyReport({ projectType: 'software' });

      // All three accuracy queries should include project_type = ?
      const overallSql = mockQuery.mock.calls[0][0];
      expect(overallSql).toContain('project_type = ?');
      expect(mockQuery.mock.calls[0][1]).toEqual(['software']);
    });
  });

  // =========================================================================
  // buildLearningContext
  // =========================================================================

  describe('buildLearningContext', () => {
    it('returns empty string when no accuracy rows', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const context = await service.buildLearningContext();

      expect(context).toBe('');
    });

    it('builds context string with accuracy data', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { metric_type: 'duration_estimate', avg_var: '12.5', cnt: '20' },
          { metric_type: 'cost_estimate', avg_var: '8.3', cnt: '15' },
        ])
        .mockResolvedValueOnce([]); // feedback rows

      const context = await service.buildLearningContext();

      expect(context).toContain('Historical AI Accuracy Context');
      expect(context).toContain('duration_estimate');
      expect(context).toContain('87.5% accurate');
      expect(context).toContain('20 samples');
      expect(context).toContain('cost_estimate');
    });

    it('includes feedback patterns when feedback rows exist', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { metric_type: 'duration_estimate', avg_var: '10', cnt: '5' },
        ])
        .mockResolvedValueOnce([
          { feature: 'risk_prediction', user_action: 'accepted', cnt: '7' },
          { feature: 'risk_prediction', user_action: 'rejected', cnt: '3' },
        ]);

      const context = await service.buildLearningContext();

      expect(context).toContain('User Feedback Patterns');
      expect(context).toContain('risk_prediction');
      expect(context).toContain('70% accepted');
      expect(context).toContain('30% rejected');
      expect(context).toContain('Adjust predictions');
    });

    it('filters by projectType when provided', async () => {
      mockQuery
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      await service.buildLearningContext('software');

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('project_type = ?');
      expect(mockQuery.mock.calls[0][1]).toEqual(['software']);
    });

    it('returns empty string and logs warning on error', async () => {
      mockQuery.mockRejectedValueOnce(new Error('DB error'));

      const context = await service.buildLearningContext();

      expect(context).toBe('');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to build learning context'),
      );
    });

    it('skips feedback section when no feedback rows', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { metric_type: 'duration_estimate', avg_var: '10', cnt: '5' },
        ])
        .mockResolvedValueOnce([]); // no feedback

      const context = await service.buildLearningContext();

      expect(context).toContain('Historical AI Accuracy Context');
      expect(context).not.toContain('User Feedback Patterns');
    });

    it('handles multiple features in feedback data', async () => {
      mockQuery
        .mockResolvedValueOnce([
          { metric_type: 'duration_estimate', avg_var: '10', cnt: '5' },
        ])
        .mockResolvedValueOnce([
          { feature: 'risk_prediction', user_action: 'accepted', cnt: '4' },
          { feature: 'risk_prediction', user_action: 'rejected', cnt: '1' },
          { feature: 'cost_estimate', user_action: 'modified', cnt: '3' },
          { feature: 'cost_estimate', user_action: 'accepted', cnt: '2' },
        ]);

      const context = await service.buildLearningContext();

      expect(context).toContain('risk_prediction');
      expect(context).toContain('cost_estimate');
    });
  });

  // =========================================================================
  // getAIAccuracyInsights
  // =========================================================================

  describe('getAIAccuracyInsights', () => {
    function mockReportQueries(
      overall = [{ total: '0', avg_var: null }],
      metric: any[] = [],
      typeRows: any[] = [],
      feedbackRows: any[] = [],
    ) {
      mockQuery
        .mockResolvedValueOnce(overall)
        .mockResolvedValueOnce(metric)
        .mockResolvedValueOnce(typeRows)
        .mockResolvedValueOnce(feedbackRows);
    }

    it('returns non-AI-powered report when Claude is unavailable', async () => {
      mockIsAvailable.mockReturnValue(false);
      mockReportQueries([{ total: '5', avg_var: '10' }], [{ metric_type: 'duration_estimate', cnt: '5', avg_var: '10' }]);

      const result = await service.getAIAccuracyInsights('user-1');

      expect(result.aiPowered).toBe(false);
      expect(result.insights.overall.totalRecords).toBe(5);
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('returns non-AI-powered report when no records exist', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockReportQueries(); // totalRecords = 0

      const result = await service.getAIAccuracyInsights('user-1');

      expect(result.aiPowered).toBe(false);
      expect(mockComplete).not.toHaveBeenCalled();
    });

    it('calls Claude and returns AI-powered insights', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockReportQueries(
        [{ total: '10', avg_var: '12' }],
        [{ metric_type: 'duration_estimate', cnt: '10', avg_var: '12' }],
      );
      mockComplete.mockResolvedValueOnce({
        content: JSON.stringify({ improvements: ['Calibrate duration model', 'Add more training data'] }),
        usage: { inputTokens: 200, outputTokens: 100 },
        latencyMs: 300,
      });

      const result = await service.getAIAccuracyInsights('user-1');

      expect(result.aiPowered).toBe(true);
      expect(result.insights.improvements).toEqual(['Calibrate duration model', 'Add more training data']);
      expect(mockComplete).toHaveBeenCalledTimes(1);
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          feature: 'accuracy_insights',
          success: true,
        }),
      );
    });

    it('falls back to deterministic insights on Claude error', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockReportQueries(
        [{ total: '10', avg_var: '25' }],
        [{ metric_type: 'risk_prediction', cnt: '10', avg_var: '25' }], // <80% accuracy
      );
      mockComplete.mockRejectedValueOnce(new Error('API timeout'));

      const result = await service.getAIAccuracyInsights('user-1');

      expect(result.aiPowered).toBe(false);
      expect(result.insights.improvements.length).toBeGreaterThanOrEqual(1);
      expect(result.insights.improvements[0]).toContain('risk_prediction');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('AI accuracy insights failed'),
      );
    });

    it('falls back when Claude returns invalid JSON', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockReportQueries(
        [{ total: '10', avg_var: '10' }],
        [{ metric_type: 'duration_estimate', cnt: '10', avg_var: '10' }],
      );
      mockComplete.mockResolvedValueOnce({
        content: 'not valid json',
        usage: { inputTokens: 100, outputTokens: 50 },
        latencyMs: 200,
      });

      const result = await service.getAIAccuracyInsights('user-1');

      expect(result.aiPowered).toBe(false);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('falls back when Claude returns JSON without improvements array', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockReportQueries(
        [{ total: '10', avg_var: '10' }],
        [{ metric_type: 'duration_estimate', cnt: '10', avg_var: '10' }],
      );
      mockComplete.mockResolvedValueOnce({
        content: JSON.stringify({ suggestions: ['something'] }), // wrong key
        usage: { inputTokens: 100, outputTokens: 50 },
        latencyMs: 200,
      });

      const result = await service.getAIAccuracyInsights('user-1');

      // parsed.improvements is undefined, not Array => original deterministic improvements kept
      expect(result.aiPowered).toBe(true);
      // The deterministic improvements should still be there since parsed.improvements is not an array
      expect(result.insights.improvements).not.toEqual(['something']);
    });

    it('works without userId parameter', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockReportQueries(
        [{ total: '5', avg_var: '10' }],
        [{ metric_type: 'duration_estimate', cnt: '5', avg_var: '10' }],
      );
      mockComplete.mockResolvedValueOnce({
        content: JSON.stringify({ improvements: ['Improve'] }),
        usage: { inputTokens: 50, outputTokens: 25 },
        latencyMs: 100,
      });

      const result = await service.getAIAccuracyInsights();

      expect(result.aiPowered).toBe(true);
      expect(mockLogAIUsage).toHaveBeenCalledWith(
        expect.objectContaining({ userId: undefined }),
      );
    });
  });
});
