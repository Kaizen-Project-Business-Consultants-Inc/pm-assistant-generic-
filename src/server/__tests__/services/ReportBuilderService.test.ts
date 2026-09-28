import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../database/connection', () => ({
  databaseService: { query: vi.fn().mockResolvedValue([]) },
}));

vi.mock('../../services/AuditLedgerService', () => ({
  auditLedgerService: {
    verifyChain: vi.fn().mockResolvedValue({ valid: true, checkedCount: 5 }),
    getEntries: vi.fn().mockResolvedValue({ entries: [], total: 0 }),
  },
}));

vi.mock('../../services/PolicyEngineService', () => ({
  policyEngineService: {
    getEvaluationStats: vi.fn().mockResolvedValue({ total: 0, allowed: 0, blocked: 0, pendingApproval: 0 }),
  },
}));

import { reportBuilderService } from '../../services/ReportBuilderService';
import { databaseService } from '../../database/connection';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;

describe('ReportBuilderService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // executeSectionQuery — kpi_card normalization
  // -------------------------------------------------------------------------
  describe('generateReport — kpi_card normalization', () => {
    it('normalizes kpi_card type to kpi and returns kpis array', async () => {
      // Mock getTemplateById
      mockQuery
        .mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Test', description: null,
          config: JSON.stringify({
            sections: [{ type: 'kpi_card', dataSource: 'projects' }],
          }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }])
        // Mock KPI query for projects
        .mockResolvedValueOnce([{ total: 5, avg_progress: 42 }]);

      const report = await reportBuilderService.generateReport('t1', undefined, 'all');
      expect(report.sections).toHaveLength(1);
      // type in output preserves the original config type
      expect(report.sections[0].type).toBe('kpi_card');
      expect(report.sections[0].data.kpis).toBeDefined();
      expect(report.sections[0].data.kpis[0]).toEqual({ label: 'Total', value: 5 });
    });
  });

  // -------------------------------------------------------------------------
  // executeKpiQuery — all 4 data sources
  // -------------------------------------------------------------------------
  describe('executeKpiQuery', () => {
    it('returns budget KPIs for budgets dataSource', async () => {
      mockQuery
        .mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Budget Report', description: null,
          config: JSON.stringify({
            sections: [{ type: 'kpi', dataSource: 'budgets' }],
          }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }])
        .mockResolvedValueOnce([{
          total_projects: 3, total_allocated: 100000, total_spent: 75000, avg_budget: 33333,
        }]);

      const report = await reportBuilderService.generateReport('t1', undefined, 'all');
      const kpis = report.sections[0].data.kpis;
      expect(kpis).toHaveLength(4);
      expect(kpis[0]).toEqual({ label: 'Total Projects', value: 3 });
      expect(kpis[1]).toEqual({ label: 'Total Allocated', value: 100000 });
      expect(kpis[2]).toEqual({ label: 'Total Spent', value: 75000 });
    });

    it('returns task KPIs with completion rate', async () => {
      mockQuery
        .mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Task Report', description: null,
          config: JSON.stringify({
            sections: [{ type: 'kpi', dataSource: 'tasks' }],
          }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }])
        .mockResolvedValueOnce([{ total: 10, completed: 7 }]);

      const report = await reportBuilderService.generateReport('t1', undefined, 'all');
      const kpis = report.sections[0].data.kpis;
      expect(kpis).toHaveLength(3);
      expect(kpis[2]).toEqual({ label: 'Completion Rate', value: '70%' });
    });

    it('returns time entry KPIs', async () => {
      mockQuery
        .mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Time Report', description: null,
          config: JSON.stringify({
            sections: [{ type: 'kpi', dataSource: 'time_entries' }],
          }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }])
        .mockResolvedValueOnce([{ total_entries: 50, total_hours: 200, avg_hours: 4 }]);

      const report = await reportBuilderService.generateReport('t1', undefined, 'all');
      const kpis = report.sections[0].data.kpis;
      expect(kpis).toHaveLength(3);
      expect(kpis[0]).toEqual({ label: 'Total Entries', value: 50 });
      expect(kpis[1]).toEqual({ label: 'Total Hours', value: 200 });
    });
  });

  // -------------------------------------------------------------------------
  // executeChartQuery — groupBy allowlist
  // -------------------------------------------------------------------------
  describe('executeChartQuery', () => {
    it('uses safe groupBy and returns chartData shape', async () => {
      mockQuery
        .mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Chart Report', description: null,
          config: JSON.stringify({
            sections: [{ type: 'bar_chart', dataSource: 'projects', groupBy: 'status' }],
          }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }])
        .mockResolvedValueOnce([
          { label: 'active', value: 5 },
          { label: 'planning', value: 3 },
        ]);

      const report = await reportBuilderService.generateReport('t1', undefined, 'all');
      expect(report.sections[0].data.chartData).toHaveLength(2);
      expect(report.sections[0].data.chartData[0]).toEqual({ label: 'active', value: 5 });
    });

    it('falls back to status when groupBy is not in allowlist', async () => {
      mockQuery
        .mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Chart Report', description: null,
          config: JSON.stringify({
            sections: [{ type: 'pie_chart', dataSource: 'projects', groupBy: 'DROP TABLE projects' }],
          }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }])
        .mockResolvedValueOnce([{ label: 'active', value: 2 }]);

      await reportBuilderService.generateReport('t1', undefined, 'all');
      // The SQL should use 'status' not the injected value
      const chartQueryCall = mockQuery.mock.calls[1];
      expect(chartQueryCall[0]).toContain('status');
      expect(chartQueryCall[0]).not.toContain('DROP');
    });
  });

  describe('only the projects the person can read (Sep 2026)', () => {
    it('limits RAID rows to their projects', async () => {
      mockQuery.mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Mine', description: null,
          config: JSON.stringify({ sections: [{ type: 'table', dataSource: 'raid_items' }] }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }]).mockResolvedValueOnce([]);
      await reportBuilderService.generateReport('t1', undefined, new Set(['p-1', 'p-2']));
      const [sql, params] = mockQuery.mock.calls[1];
      expect(sql).toContain('project_id IN (?, ?)');
      expect(params).toEqual(expect.arrayContaining(['p-1', 'p-2']));
    });

    it('matches tasks through their schedule (tasks have no project column)', async () => {
      mockQuery.mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Mine', description: null,
          config: JSON.stringify({ sections: [{ type: 'table', dataSource: 'tasks' }] }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }]).mockResolvedValueOnce([]);
      await reportBuilderService.generateReport('t1', undefined, new Set(['p-1']));
      expect(mockQuery.mock.calls[1][0]).toContain('schedule_id IN (SELECT id FROM schedules WHERE project_id IN (?))');
    });

    it('returns nothing when they can read no projects', async () => {
      mockQuery.mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Mine', description: null,
          config: JSON.stringify({ sections: [{ type: 'table', dataSource: 'projects' }] }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }]).mockResolvedValueOnce([]);
      await reportBuilderService.generateReport('t1', undefined, new Set());
      expect(mockQuery.mock.calls[1][0]).toContain('1 = 0');
    });
  });

  // -------------------------------------------------------------------------
  // executeTableQuery — headers and rows
  // -------------------------------------------------------------------------
  describe('executeTableQuery', () => {
    it('returns humanized headers and mapped rows', async () => {
      mockQuery
        .mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Table Report', description: null,
          config: JSON.stringify({
            sections: [{ type: 'table', dataSource: 'projects' }],
          }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }])
        .mockResolvedValueOnce([
          { id: 'p1', project_name: 'Alpha', status: 'active' },
          { id: 'p2', project_name: 'Beta', status: 'planning' },
        ]);

      const report = await reportBuilderService.generateReport('t1', undefined, 'all');
      const table = report.sections[0].data.table;
      expect(table.headers).toEqual(['Id', 'Project Name', 'Status']);
      expect(table.rows).toHaveLength(2);
      expect(table.rows[0]).toEqual(['p1', 'Alpha', 'active']);
    });

    it('returns empty table when no rows', async () => {
      mockQuery
        .mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Table Report', description: null,
          config: JSON.stringify({
            sections: [{ type: 'table', dataSource: 'projects' }],
          }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }])
        .mockResolvedValueOnce([]);

      const report = await reportBuilderService.generateReport('t1', undefined, 'all');
      expect(report.sections[0].data.table).toEqual({ headers: [], rows: [] });
    });
  });

  // -------------------------------------------------------------------------
  // CRUD
  // -------------------------------------------------------------------------
  describe('CRUD operations', () => {
    it('createTemplate inserts and returns template', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // INSERT
        .mockResolvedValueOnce([{
          id: 'new-id', user_id: 'u1', name: 'My Report', description: null,
          config: JSON.stringify({ sections: [] }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }]);

      const result = await reportBuilderService.createTemplate('u1', {
        name: 'My Report',
        config: { sections: [] },
      });
      expect(result.name).toBe('My Report');
      expect(result.config.sections).toEqual([]);
    });

    it('getTemplateById returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce([]);
      const result = await reportBuilderService.getTemplateById('nonexistent');
      expect(result).toBeNull();
    });

    it('deleteTemplate executes DELETE query', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await reportBuilderService.deleteTemplate('t1');
      expect(mockQuery).toHaveBeenCalledWith('DELETE FROM report_templates WHERE id = ?', ['t1']);
    });
  });

  // -------------------------------------------------------------------------
  // CSV export
  // -------------------------------------------------------------------------
  describe('exportReport CSV', () => {
    it('generates CSV string for kpi sections', async () => {
      mockQuery
        .mockResolvedValueOnce([{
          id: 't1', user_id: 'u1', name: 'Report', description: null,
          config: JSON.stringify({
            sections: [{ type: 'kpi', dataSource: 'projects' }],
          }),
          is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
        }])
        .mockResolvedValueOnce([{ total: 5, avg_progress: 40 }]);

      const { data, contentType } = await reportBuilderService.exportReport('t1', 'csv');
      expect(contentType).toBe('text/csv');
      expect(typeof data).toBe('string');
      expect((data as string)).toContain('"Total"');
    });
  });
});
