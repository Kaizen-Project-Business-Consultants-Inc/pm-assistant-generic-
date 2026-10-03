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

  describe('the sample project never counts (2026-10-03)', () => {
    const where = (dataSource: string, filters?: any) =>
      (reportBuilderService as any).buildWhereClause(dataSource, filters, 'all').whereClause as string;

    it('leaves the sample out of every cross-project data source', () => {
      expect(where('projects')).toContain('COALESCE(is_demo, 0) = 0');
      expect(where('budgets')).toContain('COALESCE(is_demo, 0) = 0');
      expect(where('tasks')).toContain('schedule_id NOT IN (SELECT ds.id FROM schedules ds JOIN projects dp ON dp.id = ds.project_id WHERE dp.is_demo = 1)');
      for (const ds of ['time_entries', 'raid_items', 'meetings', 'action_items']) {
        expect(where(ds)).toContain('(project_id IS NULL OR project_id NOT IN (SELECT id FROM projects WHERE is_demo = 1))');
      }
    });

    it("leaves the sample's example people out of the resource pool", () => {
      expect(where('resources')).toContain(`id NOT LIKE 'demo-%'`);
      expect(where('resources', { projectId: 'demo-sample-webapp' })).toContain(`id NOT LIKE 'demo-%'`);
    });

    it('a report about one project (the sample included) shows that project', () => {
      expect(where('projects', { projectId: 'demo-sample-webapp' })).not.toContain('is_demo');
      expect(where('tasks', { projectId: 'demo-sample-webapp' })).not.toContain('is_demo');
    });
  });

  describe('"Action Items" reads the RAID log (Oct 2026)', () => {
    const template = (section: Record<string, unknown>) => [{
      id: 't1', user_id: 'u1', name: 'Actions', description: null,
      config: JSON.stringify({ sections: [section] }),
      is_shared: false, created_at: '2026-01-01', updated_at: '2026-01-01',
    }];

    it('a saved table report keeps its columns, now filled from RAID actions', async () => {
      mockQuery.mockResolvedValueOnce(template({
        type: 'table', dataSource: 'action_items',
        columns: ['description', 'assignee_name', 'priority', 'meeting_id', 'due_date'],
        filters: { projectId: 'p-1', status: 'open' },
      })).mockResolvedValueOnce([{ description: 'Send minutes', assignee_name: 'Pat', priority: 'high', due_date: '2026-10-01' }]);

      const report = await reportBuilderService.generateReport('t1', undefined, new Set(['p-1']));
      const [sql, params] = mockQuery.mock.calls[1];
      expect(sql).not.toContain('meeting_action_items');
      expect(sql).toContain('FROM project_risks pr');
      expect(sql).toContain("WHERE pr.type = 'action'");
      expect(sql).toContain('pr.title AS description');
      expect(sql).toContain('pr.severity AS priority');
      expect(sql).toContain('AS assignee_name');
      // a column that no longer exists (meeting_id) is dropped, not sent to the database
      expect(sql).toMatch(/^SELECT description, assignee_name, priority, due_date FROM/);
      expect(sql).toContain('project_id IN (?)');
      expect(params).toEqual(['p-1', 'p-1', 'open']);
      expect(report.sections[0].data.table.rows[0]).toEqual(['Send minutes', 'Pat', 'high', '2026-10-01']);
    });

    it('charts and KPIs read RAID actions too, counting closed as done', async () => {
      mockQuery.mockResolvedValueOnce(template({ type: 'bar_chart', dataSource: 'action_items', groupBy: 'priority' }))
        .mockResolvedValueOnce([{ label: 'high', value: 2 }]);
      await reportBuilderService.generateReport('t1', undefined, 'all');
      expect(mockQuery.mock.calls[1][0]).toContain("WHERE pr.type = 'action'");
      expect(mockQuery.mock.calls[1][0]).toContain('GROUP BY priority');

      vi.clearAllMocks();
      mockQuery.mockResolvedValueOnce(template({ type: 'kpi', dataSource: 'action_items' }))
        .mockResolvedValueOnce([{ total: 4, open_items: 1, completed: 2, in_progress: 1 }]);
      const report = await reportBuilderService.generateReport('t1', undefined, 'all');
      expect(mockQuery.mock.calls[1][0]).toContain("status IN ('completed', 'closed')");
      expect(report.sections[0].data.kpis).toContainEqual({ label: 'Completion Rate', value: '50%' });
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
