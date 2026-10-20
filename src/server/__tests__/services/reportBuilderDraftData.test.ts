import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * 2026-10-20, Report Builder in plain words: drafts are previewed without saving, and three gaps
 * the typed requests need — overdue only, people by name, a count per person in a table — plus
 * the designer's own date filters, which were ignored.
 */
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn().mockResolvedValue([]) } }));
vi.mock('../../services/AuditLedgerService', () => ({ auditLedgerService: {} }));
vi.mock('../../services/PolicyEngineService', () => ({ policyEngineService: {} }));

import { reportBuilderService } from '../../services/ReportBuilderService';
import { databaseService } from '../../database/connection';

const mockQuery = databaseService.query as ReturnType<typeof vi.fn>;

beforeEach(() => { vi.clearAllMocks(); mockQuery.mockResolvedValue([{}]); }); // one empty row: a count query always returns a row

describe('Report Builder — draft support', () => {
  it('generateSections runs unsaved sections, limited to readable projects (no template read)', async () => {
    await reportBuilderService.generateSections([{ type: 'kpi_card', dataSource: 'projects' }], undefined, new Set(['p1']));
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('id IN (?)');
    expect(params).toContain('p1');
    expect(sql).not.toContain('report_templates');
  });

  it('nothing readable: nothing shown', async () => {
    await reportBuilderService.generateSections([{ type: 'kpi_card', dataSource: 'tasks' }], undefined, new Set());
    expect(mockQuery.mock.calls[0][0]).toContain('1 = 0');
  });

  it('overdue only: tasks due (or finishing) before today, not done, not summary rows — as the dashboard judges late', async () => {
    await reportBuilderService.generateSections([{ type: 'kpi_card', dataSource: 'tasks', filters: { overdue: true } }], undefined, 'all');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("COALESCE(due_date, end_date) < ? AND status NOT IN ('completed', 'cancelled') AND COALESCE(is_summary, 0) = 0");
    expect(params[params.length - 1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('overdue only on action items leaves out every finished RAID status (resolved, cancelled, mitigated …)', async () => {
    await reportBuilderService.generateSections([{ type: 'kpi_card', dataSource: 'action_items', filters: { overdue: true } }], undefined, 'all');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('LOWER(status) NOT IN (');
    expect(params).toEqual(expect.arrayContaining(['resolved', 'cancelled', 'mitigated', 'closed', 'completed']));
  });

  it('overdue is ignored where it means nothing (projects)', async () => {
    await reportBuilderService.generateSections([{ type: 'kpi_card', dataSource: 'projects', filters: { overdue: true } }], undefined, 'all');
    expect(mockQuery.mock.calls[0][0]).not.toContain('due_date');
  });

  it('tasks by person show the name (resources), not the stored id', async () => {
    mockQuery.mockResolvedValueOnce([{ label: 'Priya Nair', value: 3 }]);
    const r = await reportBuilderService.generateSections([{ type: 'bar_chart', dataSource: 'tasks', groupBy: 'assignee' }], undefined, 'all');
    expect(mockQuery.mock.calls[0][0]).toContain('SELECT pr_name.name FROM resources pr_name WHERE pr_name.id = tasks.assigned_to');
    expect(r.sections[0].data.chartData).toEqual([{ label: 'Priya Nair', value: 3 }]);
  });

  it('a table grouped by person is a count per person, with how late for an overdue list', async () => {
    mockQuery.mockResolvedValueOnce([{ label: 'Priya Nair', value: 3, most_late: 12 }, { label: 'Not assigned', value: 1, most_late: 2 }]);
    const r = await reportBuilderService.generateSections([{ type: 'table', dataSource: 'tasks', groupBy: 'assignee', filters: { overdue: true } }], undefined, 'all');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('MAX(DATEDIFF(?, COALESCE(due_date, end_date))) as most_late');
    expect(sql).toContain('GROUP BY label');
    expect(params[0]).toMatch(/^\d{4}-\d{2}-\d{2}$/); // today comes first: it is in the SELECT
    expect(r.sections[0].data.table).toEqual({ headers: ['Person', 'Count', 'Most late (days)'], rows: [['Priya Nair', 3, 12], ['Not assigned', 1, 2]] });
  });

  it('a grouped table without the overdue filter is just a count', async () => {
    mockQuery.mockResolvedValueOnce([{ label: 'high', value: 4 }]);
    const r = await reportBuilderService.generateSections([{ type: 'table', dataSource: 'raid_items', groupBy: 'severity' }], undefined, 'all');
    expect(mockQuery.mock.calls[0][0]).not.toContain('most_late');
    expect(r.sections[0].data.table).toEqual({ headers: ['Severity', 'Count'], rows: [['high', 4]] });
  });

  it('hours per person: time entries grouped by person add up hours and show names (the first example chip)', async () => {
    mockQuery.mockResolvedValueOnce([{ label: 'Priya Nair', value: '37.50' }]);
    const r = await reportBuilderService.generateSections([{ type: 'bar_chart', dataSource: 'time_entries', groupBy: 'resource' }], undefined, 'all');
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('te_res.user_id = time_entries.user_id');
    expect(sql).toContain('COALESCE(SUM(hours), 0) as value');
    expect(sql).not.toContain('assigned_to');
    expect(r.sections[0].data.chartData).toEqual([{ label: 'Priya Nair', value: 37.5 }]);
  });

  it('a grouped table of time says Hours', async () => {
    mockQuery.mockResolvedValueOnce([{ label: 'Priya Nair', value: 8 }]);
    const r = await reportBuilderService.generateSections([{ type: 'table', dataSource: 'time_entries', groupBy: 'resource' }], undefined, 'all');
    expect(r.sections[0].data.table.headers).toEqual(['Person', 'Hours']);
  });

  it("a table's person column shows names too", async () => {
    await reportBuilderService.generateSections([{ type: 'table', dataSource: 'tasks', columns: ['name', 'assigned_to'] }], undefined, 'all');
    expect(mockQuery.mock.calls[0][0]).toContain('AS assigned_to');
  });

  it("the designer's own dates (dateStart/dateEnd) now filter — they were ignored", async () => {
    await reportBuilderService.generateSections([{ type: 'kpi_card', dataSource: 'time_entries', filters: { dateStart: '2026-10-01', dateEnd: '2026-10-31' } }], undefined, 'all');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('date >= ?');
    expect(sql).toContain('date < DATE_ADD(?, INTERVAL 1 DAY)'); // the whole end day
    expect(params).toEqual(expect.arrayContaining(['2026-10-01', '2026-10-31']));
  });
});
