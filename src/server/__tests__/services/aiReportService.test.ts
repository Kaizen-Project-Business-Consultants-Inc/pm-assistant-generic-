import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before import
vi.mock('../../database/connection', () => ({
  databaseService: {
    query: vi.fn().mockResolvedValue([]),
    queryControlPlane: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../services/claudeService', () => ({
  claudeService: {
    isAvailable: vi.fn(),
    complete: vi.fn(),
  },
  promptTemplates: {
    reportGeneration: {
      render: vi.fn().mockReturnValue('system-prompt-text'),
    },
  },
}));

vi.mock('../../services/aiContextBuilder', () => ({
  AIContextBuilder: vi.fn().mockImplementation(() => ({
    buildProjectContext: vi.fn().mockResolvedValue({
      project: { name: 'Test Project' },
    }),
    toPromptString: vi.fn().mockReturnValue('project-context-string'),
  })),
}));

vi.mock('../../services/aiUsageLogger', () => ({
  logAIUsage: vi.fn(),
}));

vi.mock('../../utils/aiReportRenderer', () => ({
  renderAIReportHtml: vi.fn().mockImplementation((title: string, md: string) => `<html>${title}: ${md}</html>`),
}));

vi.mock('../../utils/statusReportRenderer', () => ({
  renderStatusReportHtml: vi.fn().mockReturnValue('<html>status-report</html>'),
}));

vi.mock('../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { AIReportService } from '../../services/aiReportService';
import { databaseService } from '../../database/connection';
import { claudeService } from '../../services/claudeService';
import { logAIUsage } from '../../services/aiUsageLogger';
import { renderAIReportHtml } from '../../utils/aiReportRenderer';
import { renderStatusReportHtml } from '../../utils/statusReportRenderer';
import logger from '../../utils/logger';

const mockQueryCP = databaseService.queryControlPlane as ReturnType<typeof vi.fn>;
const mockIsAvailable = claudeService.isAvailable as ReturnType<typeof vi.fn>;
const mockComplete = claudeService.complete as ReturnType<typeof vi.fn>;
const mockLogAIUsage = logAIUsage as ReturnType<typeof vi.fn>;
const mockRenderAIReport = renderAIReportHtml as ReturnType<typeof vi.fn>;
const mockRenderStatusReport = renderStatusReportHtml as ReturnType<typeof vi.fn>;

describe('AIReportService', () => {
  let service: AIReportService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AIReportService();
    mockQueryCP.mockResolvedValue([]);
  });

  // ─── generateReport ───────────────────────────────────────────────

  describe('generateReport', () => {
    it('generates a fallback report when AI is not available', async () => {
      mockIsAvailable.mockReturnValue(false);

      const result = await service.generateReport('weekly-status', 'proj-1', 'user-1');

      expect(result.aiPowered).toBe(false);
      expect(result.reportType).toBe('weekly-status');
      expect(result.title).toContain('Weekly Status Report');
      expect(result.title).toContain('Test Project');
      expect(result.id).toBeDefined();
      expect(result.generatedAt).toBeDefined();
      expect(result.metadata.projectId).toBe('proj-1');
      expect(mockRenderAIReport).toHaveBeenCalledOnce();
      // Should store the report
      expect(mockQueryCP).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ai_conversations'),
        expect.arrayContaining(['user-1']),
      );
    });

    it('generates an AI-powered report when Claude is available', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue({
        content: '# AI Generated Report\nContent here',
        usage: { inputTokens: 500, outputTokens: 300 },
        latencyMs: 1200,
      });

      const result = await service.generateReport('risk-assessment', 'proj-1', 'user-1');

      expect(result.aiPowered).toBe(true);
      expect(result.reportType).toBe('risk-assessment');
      expect(result.title).toContain('Risk Assessment Report');
      expect(result.metadata.tokenCount).toBe(800); // 500 + 300
      expect(mockComplete).toHaveBeenCalledOnce();
      expect(mockLogAIUsage).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'user-1',
        feature: 'report-risk-assessment',
        success: true,
      }));
    });

    it('falls back gracefully when AI call throws', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockRejectedValue(new Error('API timeout'));

      const result = await service.generateReport('budget-forecast', 'proj-1', 'user-1');

      expect(result.aiPowered).toBe(false);
      expect(result.reportType).toBe('budget-forecast');
      expect(result.title).toContain('Budget Forecast Report');
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('AI report generation failed'));
      // Should log failure usage
      expect(mockLogAIUsage).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        errorMessage: 'API timeout',
      }));
    });

    it('handles context builder failure gracefully', async () => {
      mockIsAvailable.mockReturnValue(false);
      // Recreate service with a context builder that throws
      const svc = new AIReportService();
      // Access the private contextBuilder and make it throw
      (svc as any).contextBuilder.buildProjectContext = vi.fn().mockRejectedValue(new Error('DB error'));

      const result = await svc.generateReport('resource-utilization', 'proj-1', 'user-1');

      expect(result.aiPowered).toBe(false);
      expect(result.title).toContain('Unknown'); // projectName unavailable
      expect(result.title).toContain('Resource Utilization Report');
    });

    it('generates correct titles for all report types', async () => {
      mockIsAvailable.mockReturnValue(false);

      const types = ['weekly-status', 'risk-assessment', 'budget-forecast', 'resource-utilization'] as const;
      const expectedPrefixes = [
        'Weekly Status Report',
        'Risk Assessment Report',
        'Budget Forecast Report',
        'Resource Utilization Report',
      ];

      for (let i = 0; i < types.length; i++) {
        const result = await service.generateReport(types[i], 'proj-1', 'user-1');
        expect(result.title).toContain(expectedPrefixes[i]);
      }
    });

    it('stores the report after generation', async () => {
      mockIsAvailable.mockReturnValue(false);

      await service.generateReport('weekly-status', 'proj-1', 'user-1');

      expect(mockQueryCP).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO ai_conversations'),
        expect.arrayContaining(['proj-1', expect.stringContaining('Weekly Status Report')]),
      );
    });

    it('does not throw when storeReport fails', async () => {
      mockIsAvailable.mockReturnValue(false);
      mockQueryCP.mockRejectedValueOnce(new Error('DB write failed'));

      // Should not throw — storeReport catches errors
      const result = await service.generateReport('weekly-status', 'proj-1', 'user-1');
      expect(result).toBeDefined();
      expect(result.reportType).toBe('weekly-status');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to store report'));
    });

    it('passes correct parameters to claudeService.complete', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockResolvedValue({
        content: 'report content',
        usage: { inputTokens: 100, outputTokens: 200 },
        latencyMs: 500,
      });

      await service.generateReport('weekly-status', 'proj-1', 'user-1');

      expect(mockComplete).toHaveBeenCalledWith(expect.objectContaining({
        systemPrompt: 'system-prompt-text',
        temperature: 0.3,
        maxTokens: 4096,
      }));
    });

    it('logs AI usage with error when complete throws a non-Error', async () => {
      mockIsAvailable.mockReturnValue(true);
      mockComplete.mockRejectedValue('string error');

      await service.generateReport('weekly-status', 'proj-1', 'user-1');

      expect(mockLogAIUsage).toHaveBeenCalledWith(expect.objectContaining({
        success: false,
        errorMessage: 'string error',
      }));
    });
  });

  // ─── getReportHistory ─────────────────────────────────────────────

  describe('getReportHistory', () => {
    it('returns empty result when no userId is provided', async () => {
      const result = await service.getReportHistory({});

      expect(result.reports).toEqual([]);
      expect(result.total).toBe(0);
      expect(result.totalPages).toBe(0);
      expect(mockQueryCP).not.toHaveBeenCalled();
    });

    it('returns paginated results for a given user', async () => {
      // Mock type counts query
      mockQueryCP.mockResolvedValueOnce([
        { context_type: 'report', cnt: 5 },
        { context_type: 'status-report', cnt: 3 },
      ]);
      // Mock total count query
      mockQueryCP.mockResolvedValueOnce([{ total: 8 }]);
      // Mock data query
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Weekly Status Report — Test — Sep 1, 2026',
          context_type: 'report',
          project_id: 'proj-1',
          created_at: '2026-09-01T00:00:00Z',
          has_content: 1,
        },
      ]);

      const result = await service.getReportHistory({ userId: 'user-1' });

      expect(result.reports).toHaveLength(1);
      expect(result.reports[0].reportType).toBe('weekly-status');
      expect(result.reports[0].aiPowered).toBe(true); // context_type = 'report'
      expect(result.total).toBe(8);
      expect(result.typeCounts).toEqual({ report: 5, 'status-report': 3 });
    });

    it('correctly derives reportType from title prefix', async () => {
      mockQueryCP.mockResolvedValueOnce([]); // type counts
      mockQueryCP.mockResolvedValueOnce([{ total: 4 }]);
      mockQueryCP.mockResolvedValueOnce([
        { id: 'r1', title: 'Weekly Status Report — X', context_type: 'report', project_id: null, created_at: '2026-01-01', has_content: 0 },
        { id: 'r2', title: 'Risk Assessment Report — Y', context_type: 'report', project_id: null, created_at: '2026-01-01', has_content: 0 },
        { id: 'r3', title: 'Budget Forecast Report — Z', context_type: 'report', project_id: null, created_at: '2026-01-01', has_content: 0 },
        { id: 'r4', title: 'Resource Utilization Report — W', context_type: 'report', project_id: null, created_at: '2026-01-01', has_content: 0 },
      ]);

      const result = await service.getReportHistory({ userId: 'user-1' });

      expect(result.reports[0].reportType).toBe('weekly-status');
      expect(result.reports[1].reportType).toBe('risk-assessment');
      expect(result.reports[2].reportType).toBe('budget-forecast');
      expect(result.reports[3].reportType).toBe('resource-utilization');
    });

    it('identifies raid-report and status-report context types', async () => {
      mockQueryCP.mockResolvedValueOnce([]);
      mockQueryCP.mockResolvedValueOnce([{ total: 2 }]);
      mockQueryCP.mockResolvedValueOnce([
        { id: 'r1', title: 'RAID Report', context_type: 'raid-report', project_id: null, created_at: '2026-01-01', has_content: 1 },
        { id: 'r2', title: 'Status Report', context_type: 'status-report', project_id: null, created_at: '2026-01-01', has_content: 1 },
      ]);

      const result = await service.getReportHistory({ userId: 'user-1' });

      expect(result.reports[0].reportType).toBe('raid-report');
      expect(result.reports[0].aiPowered).toBe(false); // raid-report is not AI-powered
      expect(result.reports[1].reportType).toBe('status-report');
      expect(result.reports[1].aiPowered).toBe(true);
    });

    it('clamps page and limit to safe values', async () => {
      mockQueryCP.mockResolvedValueOnce([]);
      mockQueryCP.mockResolvedValueOnce([{ total: 0 }]);
      mockQueryCP.mockResolvedValueOnce([]);

      const result = await service.getReportHistory({
        userId: 'user-1',
        page: -5,
        limit: 999,
      });

      expect(result.page).toBe(1);
      expect(result.limit).toBe(100);
    });

    it('filters by type when valid', async () => {
      mockQueryCP.mockResolvedValueOnce([]);
      mockQueryCP.mockResolvedValueOnce([{ total: 0 }]);
      mockQueryCP.mockResolvedValueOnce([]);

      await service.getReportHistory({ userId: 'user-1', type: 'report' });

      // The total query should include the type condition
      const totalCall = mockQueryCP.mock.calls[1];
      expect(totalCall[0]).toContain('context_type = ?');
      expect(totalCall[1]).toContain('report');
    });

    it('ignores invalid type values', async () => {
      mockQueryCP.mockResolvedValueOnce([]);
      mockQueryCP.mockResolvedValueOnce([{ total: 0 }]);
      mockQueryCP.mockResolvedValueOnce([]);

      await service.getReportHistory({ userId: 'user-1', type: 'invalid-type' });

      // Should NOT include context_type = ? for invalid type
      const totalCall = mockQueryCP.mock.calls[1];
      expect(totalCall[0]).not.toContain('context_type = ?');
    });

    it('filters by subType using title LIKE', async () => {
      mockQueryCP.mockResolvedValueOnce([]);
      mockQueryCP.mockResolvedValueOnce([{ total: 0 }]);
      mockQueryCP.mockResolvedValueOnce([]);

      await service.getReportHistory({ userId: 'user-1', subType: 'risk-assessment' });

      const totalCall = mockQueryCP.mock.calls[1];
      expect(totalCall[0]).toContain('title LIKE ?');
      expect(totalCall[1]).toContain('Risk Assessment Report%');
    });

    it('filters by search term', async () => {
      mockQueryCP.mockResolvedValueOnce([]);
      mockQueryCP.mockResolvedValueOnce([{ total: 0 }]);
      mockQueryCP.mockResolvedValueOnce([]);

      await service.getReportHistory({ userId: 'user-1', search: 'quarterly' });

      const totalCall = mockQueryCP.mock.calls[1];
      expect(totalCall[0]).toContain('title LIKE ?');
      expect(totalCall[1]).toContain('%quarterly%');
    });

    it('filters by dateFrom and dateTo', async () => {
      mockQueryCP.mockResolvedValueOnce([]);
      mockQueryCP.mockResolvedValueOnce([{ total: 0 }]);
      mockQueryCP.mockResolvedValueOnce([]);

      await service.getReportHistory({
        userId: 'user-1',
        dateFrom: '2026-01-01',
        dateTo: '2026-12-31',
      });

      const totalCall = mockQueryCP.mock.calls[1];
      expect(totalCall[0]).toContain('created_at >= ?');
      expect(totalCall[0]).toContain('DATE_ADD(?, INTERVAL 1 DAY)');
    });

    it('uses allowlisted sort columns and defaults to DESC', async () => {
      mockQueryCP.mockResolvedValueOnce([]);
      mockQueryCP.mockResolvedValueOnce([{ total: 0 }]);
      mockQueryCP.mockResolvedValueOnce([]);

      await service.getReportHistory({ userId: 'user-1', sortBy: 'title', sortOrder: 'asc' });

      const dataCall = mockQueryCP.mock.calls[2];
      expect(dataCall[0]).toContain('ORDER BY title ASC');
    });

    it('defaults unknown sort columns to created_at', async () => {
      mockQueryCP.mockResolvedValueOnce([]);
      mockQueryCP.mockResolvedValueOnce([{ total: 0 }]);
      mockQueryCP.mockResolvedValueOnce([]);

      await service.getReportHistory({ userId: 'user-1', sortBy: 'DROP TABLE' });

      const dataCall = mockQueryCP.mock.calls[2];
      expect(dataCall[0]).toContain('ORDER BY created_at');
    });

    it('returns empty result on database error', async () => {
      mockQueryCP.mockRejectedValueOnce(new Error('Connection lost'));

      const result = await service.getReportHistory({ userId: 'user-1' });

      expect(result.reports).toEqual([]);
      expect(result.total).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to fetch report history'));
    });

    it('calculates totalPages correctly', async () => {
      mockQueryCP.mockResolvedValueOnce([]);
      mockQueryCP.mockResolvedValueOnce([{ total: 45 }]);
      mockQueryCP.mockResolvedValueOnce([]);

      const result = await service.getReportHistory({ userId: 'user-1', limit: 20 });

      expect(result.totalPages).toBe(3); // ceil(45/20)
    });

    it('reports with unknown title prefix get reportType "report"', async () => {
      mockQueryCP.mockResolvedValueOnce([]);
      mockQueryCP.mockResolvedValueOnce([{ total: 1 }]);
      mockQueryCP.mockResolvedValueOnce([
        { id: 'r1', title: 'Custom Report Title', context_type: 'report', project_id: null, created_at: '2026-01-01', has_content: 0 },
      ]);

      const result = await service.getReportHistory({ userId: 'user-1' });

      expect(result.reports[0].reportType).toBe('report');
    });
  });

  // ─── getReportById ────────────────────────────────────────────────

  describe('getReportById', () => {
    it('returns null when report is not found', async () => {
      mockQueryCP.mockResolvedValueOnce([]);

      const result = await service.getReportById('nonexistent', 'user-1');

      expect(result).toBeNull();
    });

    it('returns metadata with contentPurged=true when messages is null', async () => {
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Weekly Status Report — Test',
          context_type: 'report',
          project_id: 'proj-1',
          messages: null,
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);

      const result = await service.getReportById('r1', 'user-1');

      expect(result).not.toBeNull();
      expect(result!.contentPurged).toBe(true);
      expect(result!.content).toBe('');
      expect(result!.reportType).toBe('report');
    });

    it('returns metadata with contentPurged=true for raid-report type', async () => {
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'RAID Report',
          context_type: 'raid-report',
          project_id: null,
          messages: null,
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);

      const result = await service.getReportById('r1', 'user-1');

      expect(result!.reportType).toBe('raid-report');
      expect(result!.aiPowered).toBe(false);
      expect(result!.contentPurged).toBe(true);
    });

    it('parses messages JSON and extracts content', async () => {
      const reportData = {
        reportType: 'weekly-status',
        content: '<html>report content</html>',
        aiPowered: true,
      };
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Weekly Status Report — Test',
          context_type: 'report',
          project_id: 'proj-1',
          messages: JSON.stringify([{ content: JSON.stringify(reportData) }]),
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);

      const result = await service.getReportById('r1', 'user-1');

      expect(result!.contentPurged).toBe(false);
      expect(result!.content).toBe('<html>report content</html>');
      expect(result!.reportType).toBe('weekly-status');
      expect(result!.aiPowered).toBe(true);
    });

    it('re-renders AI report when content is raw markdown (no HTML prefix)', async () => {
      const reportData = {
        reportType: 'risk-assessment',
        content: '# Risk Report\nSome content',
      };
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Risk Assessment Report — Test',
          context_type: 'report',
          project_id: 'proj-1',
          messages: JSON.stringify([{ content: JSON.stringify(reportData) }]),
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);

      const result = await service.getReportById('r1', 'user-1');

      expect(mockRenderAIReport).toHaveBeenCalledWith(
        'Risk Assessment Report — Test',
        '# Risk Report\nSome content',
        'risk-assessment',
      );
      expect(result!.contentPurged).toBe(false);
    });

    it('does not re-render when content already starts with HTML tag', async () => {
      const reportData = {
        reportType: 'weekly-status',
        content: '<div>Already rendered</div>',
      };
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Weekly Status Report — Test',
          context_type: 'report',
          project_id: 'proj-1',
          messages: JSON.stringify([{ content: JSON.stringify(reportData) }]),
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);

      const result = await service.getReportById('r1', 'user-1');

      expect(mockRenderAIReport).not.toHaveBeenCalled();
      expect(result!.content).toBe('<div>Already rendered</div>');
    });

    it('renders status-report when content is empty', async () => {
      const reportData = {
        reportType: 'status-report',
        projectName: 'My Project',
        reportDate: 'Sep 1, 2026',
        reportingPeriod: 'Week 35',
        preparedBy: 'John',
      };
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Status Report — My Project — Sep 1, 2026',
          context_type: 'status-report',
          project_id: 'proj-1',
          messages: JSON.stringify([{ content: JSON.stringify(reportData) }]),
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);

      const result = await service.getReportById('r1', 'user-1');

      expect(result!.reportType).toBe('status-report');
      expect(mockRenderStatusReport).toHaveBeenCalledOnce();
    });

    it('handles malformed messages JSON gracefully', async () => {
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Report',
          context_type: 'report',
          project_id: null,
          messages: 'not valid json',
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);

      const result = await service.getReportById('r1', 'user-1');

      // Should not throw, returns empty content
      expect(result).not.toBeNull();
      expect(result!.content).toBe('');
      expect(result!.contentPurged).toBe(false);
    });

    it('handles messages as already-parsed object', async () => {
      const reportData = {
        reportType: 'budget-forecast',
        content: '<html>budget</html>',
      };
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Budget Forecast Report — Test',
          context_type: 'report',
          project_id: null,
          messages: [{ content: JSON.stringify(reportData) }], // already parsed
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);

      const result = await service.getReportById('r1', 'user-1');

      expect(result!.reportType).toBe('budget-forecast');
      expect(result!.content).toBe('<html>budget</html>');
    });

    it('handles render error for AI report gracefully', async () => {
      const reportData = {
        reportType: 'weekly-status',
        content: '# Raw markdown',
      };
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Weekly Status Report — Test',
          context_type: 'report',
          project_id: null,
          messages: JSON.stringify([{ content: JSON.stringify(reportData) }]),
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);
      mockRenderAIReport.mockImplementationOnce(() => { throw new Error('Render failed'); });

      const result = await service.getReportById('r1', 'user-1');

      // Should not throw — logs error and keeps original markdown content
      expect(result).not.toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Failed to render AI report HTML', expect.objectContaining({ id: 'r1' }));
    });

    it('handles render error for status report gracefully', async () => {
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Status Report — Proj — Sep 1, 2026',
          context_type: 'status-report',
          project_id: null,
          messages: JSON.stringify([{ content: '{}' }]),
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);
      mockRenderStatusReport.mockImplementationOnce(() => { throw new Error('Render failed'); });

      const result = await service.getReportById('r1', 'user-1');

      expect(result).not.toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Failed to re-render status report', expect.objectContaining({ id: 'r1' }));
    });

    it('overrides reportType for raid-report and status-report context types', async () => {
      const reportData = { reportType: 'weekly-status', content: '<html>x</html>' };
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'RAID Report',
          context_type: 'raid-report',
          project_id: null,
          messages: JSON.stringify([{ content: JSON.stringify(reportData) }]),
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);

      const result = await service.getReportById('r1', 'user-1');

      // context_type overrides reportData.reportType
      expect(result!.reportType).toBe('raid-report');
    });

    it('derives fallback values for status-report fields', async () => {
      // No projectName, reportDate, reportingPeriod, preparedBy in reportData
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Status Report — Alpha Project — Sep 1, 2026',
          context_type: 'status-report',
          project_id: null,
          messages: JSON.stringify([{ content: '{}' }]),
          created_at: '2026-09-01T00:00:00Z',
        },
      ]);

      await service.getReportById('r1', 'user-1');

      expect(mockRenderStatusReport).toHaveBeenCalledWith(expect.objectContaining({
        projectName: 'Alpha Project',
        preparedBy: 'AI-Generated',
      }));
    });

    it('returns contentPurged=true when messages is undefined', async () => {
      mockQueryCP.mockResolvedValueOnce([
        {
          id: 'r1',
          title: 'Report',
          context_type: 'status-report',
          project_id: null,
          messages: undefined,
          created_at: '2026-01-01',
        },
      ]);

      const result = await service.getReportById('r1', 'user-1');

      expect(result!.contentPurged).toBe(true);
      expect(result!.reportType).toBe('status-report');
    });
  });

  // ─── deleteReport ─────────────────────────────────────────────────

  describe('deleteReport', () => {
    it('soft-deletes a report by setting is_active to FALSE', async () => {
      await service.deleteReport('r1', 'user-1');

      expect(mockQueryCP).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE ai_conversations SET is_active = FALSE'),
        ['r1', 'user-1'],
      );
    });

    it('scopes delete to the correct user and report types', async () => {
      await service.deleteReport('r1', 'user-1');

      const sql = mockQueryCP.mock.calls[0][0] as string;
      expect(sql).toContain('user_id = ?');
      expect(sql).toContain("context_type IN ('report', 'raid-report', 'status-report')");
    });
  });

  // ─── generateFallbackReport (via generateReport) ──────────────────

  describe('fallback report content', () => {
    beforeEach(() => {
      mockIsAvailable.mockReturnValue(false);
    });

    it('weekly-status fallback contains expected sections', async () => {
      const result = await service.generateReport('weekly-status', 'proj-1', 'user-1');

      // The fallback markdown is passed to renderAIReportHtml
      const markdownArg = mockRenderAIReport.mock.calls[0][1] as string;
      expect(markdownArg).toContain('Weekly Status Report');
      expect(markdownArg).toContain('Template (AI unavailable)');
      expect(markdownArg).toContain('Executive Summary');
    });

    it('risk-assessment fallback contains risk areas', async () => {
      await service.generateReport('risk-assessment', 'proj-1', 'user-1');

      const markdownArg = mockRenderAIReport.mock.calls[0][1] as string;
      expect(markdownArg).toContain('Risk Assessment Report');
      expect(markdownArg).toContain('Key Risk Areas');
      expect(markdownArg).toContain('Schedule delays');
    });

    it('budget-forecast fallback contains budget recommendations', async () => {
      await service.generateReport('budget-forecast', 'proj-1', 'user-1');

      const markdownArg = mockRenderAIReport.mock.calls[0][1] as string;
      expect(markdownArg).toContain('Budget Forecast Report');
      expect(markdownArg).toContain('earned value analysis');
    });

    it('resource-utilization fallback contains resource recommendations', async () => {
      await service.generateReport('resource-utilization', 'proj-1', 'user-1');

      const markdownArg = mockRenderAIReport.mock.calls[0][1] as string;
      expect(markdownArg).toContain('Resource Utilization Report');
      expect(markdownArg).toContain('workload analysis');
    });

    it('fallback includes project data in the report', async () => {
      await service.generateReport('weekly-status', 'proj-1', 'user-1');

      const markdownArg = mockRenderAIReport.mock.calls[0][1] as string;
      expect(markdownArg).toContain('project-context-string');
    });
  });
});
