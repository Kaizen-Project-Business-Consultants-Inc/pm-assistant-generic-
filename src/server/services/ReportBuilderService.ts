import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';
import { reportTemplateRepository, ReportTemplateRow } from '../database/ReportTemplateRepository';
import { auditLedgerService } from './AuditLedgerService';
import { policyEngineService } from './PolicyEngineService';

export interface ReportTemplate {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  config: ReportConfig;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ReportConfig {
  sections: ReportSectionConfig[];
}

export type DataSource = 'projects' | 'tasks' | 'time_entries' | 'budgets' | 'resources' | 'raid_items' | 'meetings' | 'action_items';

export interface ReportSectionConfig {
  title?: string;
  type: 'kpi' | 'kpi_card' | 'table' | 'bar_chart' | 'line_chart' | 'pie_chart';
  dataSource: DataSource;
  filters?: {
    dateRange?: { start: string; end: string };
    projectId?: string;
    status?: string;
  };
  groupBy?: string;
  columns?: string[];
}

export interface ReportSection {
  title: string;
  type: string;
  data: any;
}

export interface GeneratedReport {
  sections: ReportSection[];
}

function rowToDTO(row: ReportTemplateRow): ReportTemplate {
  let config: ReportConfig = { sections: [] };
  if (row.config) {
    try { config = typeof row.config === 'string' ? JSON.parse(row.config) : row.config; } catch { config = { sections: [] }; }
  }
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    description: row.description,
    config,
    isShared: !!row.is_shared,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

class ReportBuilderService {
  async createTemplate(userId: string, data: {
    name: string;
    description?: string;
    config: ReportConfig;
    isShared?: boolean;
  }): Promise<ReportTemplate> {
    const id = uuidv4();
    await reportTemplateRepository.insert(id, userId, data.name, data.description || null, JSON.stringify(data.config), data.isShared || false);
    const row = await reportTemplateRepository.findById(id);
    return rowToDTO(row!);
  }

  async getTemplates(userId: string): Promise<ReportTemplate[]> {
    const rows = await reportTemplateRepository.findByUserOrShared(userId);
    return rows.map(rowToDTO);
  }

  async getTemplateById(id: string): Promise<ReportTemplate | null> {
    const row = await reportTemplateRepository.findById(id);
    if (!row) return null;
    return rowToDTO(row);
  }

  async updateTemplate(id: string, data: {
    name?: string;
    description?: string;
    config?: ReportConfig;
    isShared?: boolean;
  }): Promise<ReportTemplate> {
    const sets: string[] = [];
    const params: any[] = [];
    if (data.name !== undefined) { sets.push('name = ?'); params.push(data.name); }
    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description); }
    if (data.config !== undefined) { sets.push('config = ?'); params.push(JSON.stringify(data.config)); }
    if (data.isShared !== undefined) { sets.push('is_shared = ?'); params.push(data.isShared); }
    if (sets.length > 0) {
      await reportTemplateRepository.update(id, sets, params);
    }
    const row = await reportTemplateRepository.findById(id);
    return rowToDTO(row!);
  }

  async deleteTemplate(id: string): Promise<void> {
    await reportTemplateRepository.delete(id);
  }

  async generateReport(templateId: string, params?: {
    dateRange?: { start: string; end: string };
    projectId?: string;
  }): Promise<GeneratedReport> {
    const template = await this.getTemplateById(templateId);
    if (!template) throw new Error('Report template not found');

    const sections: ReportSection[] = [];

    for (const section of template.config.sections) {
      const mergedFilters = {
        ...section.filters,
        ...(params?.dateRange ? { dateRange: params.dateRange } : {}),
        ...(params?.projectId ? { projectId: params.projectId } : {}),
      };

      const data = await this.executeSectionQuery(section.type, section.dataSource, mergedFilters, section.groupBy, section.columns);
      sections.push({
        title: section.title || `${section.dataSource} ${section.type}`,
        type: section.type,
        data,
      });
    }

    return { sections };
  }

  private async executeSectionQuery(
    type: ReportSectionConfig['type'] | string,
    dataSource: DataSource,
    filters: ReportSectionConfig['filters'],
    groupBy?: string,
    columns?: string[],
  ): Promise<any> {
    // Normalize kpi_card → kpi (designer sends kpi_card, service expects kpi)
    const normalizedType = type === 'kpi_card' ? 'kpi' : type;

    const tableName = this.getTableName(dataSource);
    const { whereClause, whereParams } = this.buildWhereClause(dataSource, filters);

    if (normalizedType === 'kpi') {
      return this.executeKpiQuery(dataSource, tableName, whereClause, whereParams);
    }

    if (normalizedType === 'table') {
      return this.executeTableQuery(tableName, whereClause, whereParams, columns);
    }

    // Chart types: bar_chart, line_chart, pie_chart
    return this.executeChartQuery(tableName, whereClause, whereParams, groupBy || this.getDefaultGroupBy(dataSource), dataSource);
  }

  private getTableName(dataSource: DataSource): string {
    switch (dataSource) {
      case 'projects': return 'projects';
      case 'tasks': return 'tasks';
      case 'time_entries': return 'time_entries';
      case 'budgets': return 'projects';
      case 'resources': return 'resources';
      case 'raid_items': return 'project_risks';
      case 'meetings': return 'meetings';
      case 'action_items': return 'meeting_action_items';
      default: return 'projects';
    }
  }

  private getDefaultGroupBy(dataSource: DataSource): string {
    switch (dataSource) {
      case 'projects': return 'status';
      case 'tasks': return 'status';
      case 'time_entries': return 'project_id';
      case 'budgets': return 'status';
      case 'resources': return 'role';
      case 'raid_items': return 'type';
      case 'meetings': return 'meeting_type';
      case 'action_items': return 'status';
      default: return 'status';
    }
  }

  private buildWhereClause(
    dataSource: DataSource,
    filters?: ReportSectionConfig['filters'],
  ): { whereClause: string; whereParams: any[] } {
    const conditions: string[] = [];
    const params: any[] = [];

    if (!filters) return { whereClause: '', whereParams: [] };

    if (filters.projectId) {
      if (dataSource === 'projects' || dataSource === 'budgets') {
        conditions.push('id = ?');
      } else if (dataSource === 'resources') {
        // resources don't have project_id, skip
      } else {
        conditions.push('project_id = ?');
      }
      if (dataSource !== 'resources') {
        params.push(filters.projectId);
      }
    }

    if (filters.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }

    if (filters.dateRange) {
      let dateField = 'created_at';
      if (dataSource === 'time_entries') dateField = 'date';
      else if (dataSource === 'meetings') dateField = 'scheduled_date';
      else if (dataSource === 'action_items') dateField = 'due_date';
      if (filters.dateRange.start) {
        conditions.push(`${dateField} >= ?`);
        params.push(filters.dateRange.start);
      }
      if (filters.dateRange.end) {
        conditions.push(`${dateField} <= ?`);
        params.push(filters.dateRange.end);
      }
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    return { whereClause, whereParams: params };
  }

  private async executeKpiQuery(
    dataSource: DataSource,
    tableName: string,
    whereClause: string,
    whereParams: any[],
  ): Promise<any> {
    if (dataSource === 'budgets') {
      const rows = await databaseService.query<any>(
        `SELECT COUNT(*) as total_projects, COALESCE(SUM(budget_allocated), 0) as total_allocated, COALESCE(SUM(budget_spent), 0) as total_spent, COALESCE(AVG(budget_allocated), 0) as avg_budget FROM ${tableName}${whereClause}`,
        whereParams,
      );
      return {
        kpis: [
          { label: 'Total Projects', value: Number(rows[0].total_projects) },
          { label: 'Total Allocated', value: Number(rows[0].total_allocated) },
          { label: 'Total Spent', value: Number(rows[0].total_spent) },
          { label: 'Avg Budget', value: Number(rows[0].avg_budget) },
        ],
      };
    }

    if (dataSource === 'projects') {
      const rows = await databaseService.query<any>(
        `SELECT COUNT(*) as total, COALESCE(AVG(progress), 0) as avg_progress FROM ${tableName}${whereClause}`,
        whereParams,
      );
      return {
        kpis: [
          { label: 'Total', value: Number(rows[0].total) },
          { label: 'Avg Progress', value: Number(rows[0].avg_progress) },
        ],
      };
    }

    if (dataSource === 'tasks') {
      const rows = await databaseService.query<any>(
        `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed FROM ${tableName}${whereClause}`,
        whereParams,
      );
      const total = Number(rows[0].total);
      const completed = Number(rows[0].completed);
      const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
      return {
        kpis: [
          { label: 'Total', value: total },
          { label: 'Completed', value: completed },
          { label: 'Completion Rate', value: `${completionRate}%` },
        ],
      };
    }

    if (dataSource === 'time_entries') {
      const rows = await databaseService.query<any>(
        `SELECT COUNT(*) as total_entries, COALESCE(SUM(hours), 0) as total_hours, COALESCE(AVG(hours), 0) as avg_hours FROM ${tableName}${whereClause}`,
        whereParams,
      );
      return {
        kpis: [
          { label: 'Total Entries', value: Number(rows[0].total_entries) },
          { label: 'Total Hours', value: Number(rows[0].total_hours) },
          { label: 'Avg Hours', value: Number(rows[0].avg_hours) },
        ],
      };
    }

    if (dataSource === 'resources') {
      const rows = await databaseService.query<any>(
        `SELECT COUNT(*) as total, SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) as active, COALESCE(AVG(capacity_hours_per_week), 0) as avg_capacity, COALESCE(AVG(cost_rate_hourly), 0) as avg_rate FROM ${tableName}${whereClause}`,
        whereParams,
      );
      return {
        kpis: [
          { label: 'Total Resources', value: Number(rows[0].total) },
          { label: 'Active', value: Number(rows[0].active) },
          { label: 'Avg Capacity (hrs/wk)', value: Number(rows[0].avg_capacity) },
          { label: 'Avg Rate ($/hr)', value: `$${Number(rows[0].avg_rate).toFixed(2)}` },
        ],
      };
    }

    if (dataSource === 'raid_items') {
      const rows = await databaseService.query<any>(
        `SELECT COUNT(*) as total, SUM(CASE WHEN type='risk' THEN 1 ELSE 0 END) as risks, SUM(CASE WHEN type='issue' THEN 1 ELSE 0 END) as issues, SUM(CASE WHEN type='action' THEN 1 ELSE 0 END) as actions, SUM(CASE WHEN type='decision' THEN 1 ELSE 0 END) as decisions FROM ${tableName}${whereClause}`,
        whereParams,
      );
      return {
        kpis: [
          { label: 'Total RAID Items', value: Number(rows[0].total) },
          { label: 'Risks', value: Number(rows[0].risks) },
          { label: 'Issues', value: Number(rows[0].issues) },
          { label: 'Actions', value: Number(rows[0].actions) },
          { label: 'Decisions', value: Number(rows[0].decisions) },
        ],
      };
    }

    if (dataSource === 'meetings') {
      const rows = await databaseService.query<any>(
        `SELECT COUNT(*) as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) as upcoming, COALESCE(AVG(duration_minutes), 0) as avg_duration FROM ${tableName}${whereClause}`,
        whereParams,
      );
      return {
        kpis: [
          { label: 'Total Meetings', value: Number(rows[0].total) },
          { label: 'Completed', value: Number(rows[0].completed) },
          { label: 'Upcoming', value: Number(rows[0].upcoming) },
          { label: 'Avg Duration (min)', value: Math.round(Number(rows[0].avg_duration)) },
        ],
      };
    }

    if (dataSource === 'action_items') {
      const rows = await databaseService.query<any>(
        `SELECT COUNT(*) as total, SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) as open_items, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as in_progress FROM ${tableName}${whereClause}`,
        whereParams,
      );
      const total = Number(rows[0].total);
      const completed = Number(rows[0].completed);
      return {
        kpis: [
          { label: 'Total Action Items', value: total },
          { label: 'Open', value: Number(rows[0].open_items) },
          { label: 'In Progress', value: Number(rows[0].in_progress) },
          { label: 'Completed', value: completed },
          { label: 'Completion Rate', value: total > 0 ? `${Math.round((completed / total) * 100)}%` : '0%' },
        ],
      };
    }

    return { kpis: [] };
  }

  /** Allowlisted columns per data source for column selection (prevents SQL injection) */
  private getAllowedColumns(tableName: string): string[] {
    const map: Record<string, string[]> = {
      projects: ['id', 'name', 'status', 'priority', 'progress', 'budget_allocated', 'budget_spent', 'start_date', 'end_date', 'created_at', 'updated_at'],
      tasks: ['id', 'name', 'status', 'priority', 'assigned_to', 'start_date', 'end_date', 'estimated_days', 'progress', 'budget_allocated', 'created_at'],
      time_entries: ['id', 'project_id', 'resource_id', 'date', 'hours', 'description', 'status', 'created_at'],
      resources: ['id', 'name', 'role', 'email', 'capacity_hours_per_week', 'cost_rate_hourly', 'is_active', 'resource_group', 'created_at'],
      project_risks: ['id', 'project_id', 'type', 'title', 'category', 'severity', 'probability', 'impact', 'risk_score', 'status', 'owner_id', 'due_date', 'created_at'],
      meetings: ['id', 'project_id', 'title', 'meeting_type', 'scheduled_date', 'duration_minutes', 'location', 'status', 'created_at'],
      meeting_action_items: ['id', 'meeting_id', 'project_id', 'description', 'assignee_name', 'due_date', 'priority', 'status', 'source', 'created_at'],
    };
    return map[tableName] || [];
  }

  private async executeTableQuery(
    tableName: string,
    whereClause: string,
    whereParams: any[],
    columns?: string[],
  ): Promise<any> {
    let selectClause = '*';
    const allowed = this.getAllowedColumns(tableName);

    if (columns && columns.length > 0 && allowed.length > 0) {
      // Filter to only allowed columns
      const safeColumns = columns.filter(c => allowed.includes(c));
      if (safeColumns.length > 0) {
        selectClause = safeColumns.join(', ');
      }
    }

    const orderField = tableName === 'meetings' ? 'scheduled_date' : 'created_at';
    const rows = await databaseService.query<any>(
      `SELECT ${selectClause} FROM ${tableName}${whereClause} ORDER BY ${orderField} DESC LIMIT 500`,
      whereParams,
    );
    if (rows.length === 0) {
      return { table: { headers: [], rows: [] } };
    }
    const headers = Object.keys(rows[0]);
    const humanize = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    return {
      table: {
        headers: headers.map(humanize),
        rows: rows.map((r: any) => headers.map(h => r[h] ?? '')),
      },
    };
  }

  /**
   * Resolve a groupBy value from the client into a safe SQL expression.
   * Returns { selectExpr, groupExpr } or null if invalid.
   */
  private resolveGroupBy(groupBy: string, dataSource: DataSource): { selectExpr: string; groupExpr: string } | null {
    // Direct column allowlist (safe against SQL injection)
    const ALLOWED_COLUMNS = [
      'status', 'priority', 'project_id', 'assigned_to', 'category', 'role',
      'type', 'severity', 'meeting_type', 'assignee_name', 'source',
      'is_active', 'resource_group',
    ];
    if (ALLOWED_COLUMNS.includes(groupBy)) {
      return { selectExpr: groupBy, groupExpr: groupBy };
    }

    // Client-side aliases → actual column names
    const aliasMap: Record<string, string> = {
      project: 'project_id',
      assignee: 'assigned_to',
      resource: 'assigned_to',
    };
    if (aliasMap[groupBy] && ALLOWED_COLUMNS.includes(aliasMap[groupBy])) {
      return { selectExpr: aliasMap[groupBy], groupExpr: aliasMap[groupBy] };
    }

    // Computed temporal groupings
    const dateFieldMap: Record<DataSource, string> = {
      projects: 'created_at',
      tasks: 'created_at',
      time_entries: 'date',
      budgets: 'created_at',
      resources: 'created_at',
      raid_items: 'created_at',
      meetings: 'scheduled_date',
      action_items: 'due_date',
    };
    const dateField = dateFieldMap[dataSource] || 'created_at';

    if (groupBy === 'week') {
      const expr = `DATE_FORMAT(${dateField}, '%x-W%v')`;
      return { selectExpr: expr, groupExpr: expr };
    }
    if (groupBy === 'month') {
      const expr = `DATE_FORMAT(${dateField}, '%Y-%m')`;
      return { selectExpr: expr, groupExpr: expr };
    }

    return null;
  }

  private async executeChartQuery(
    tableName: string,
    whereClause: string,
    whereParams: any[],
    groupBy: string,
    dataSource?: DataSource,
  ): Promise<any> {
    const resolved = this.resolveGroupBy(groupBy, dataSource || 'projects');
    const selectExpr = resolved ? resolved.selectExpr : 'status';
    const groupExpr = resolved ? resolved.groupExpr : 'status';

    const rows = await databaseService.query<any>(
      `SELECT ${selectExpr} as label, COUNT(*) as value FROM ${tableName}${whereClause} GROUP BY ${groupExpr} ORDER BY value DESC`,
      whereParams,
    );
    return {
      chartData: rows.map((r: any) => ({ label: r.label || 'N/A', value: Number(r.value) })),
    };
  }

  /**
   * Generate a compliance audit report for a project.
   */
  async generateComplianceReport(projectId: string, params?: {
    dateRange?: { start: string; end: string };
    actions?: string;
  }): Promise<GeneratedReport> {
    const sections: ReportSection[] = [];

    // Chain verification
    const chainStatus = await auditLedgerService.verifyChain(projectId);
    sections.push({
      title: 'Chain Integrity',
      type: 'kpi',
      data: {
        status: chainStatus.valid ? 'VERIFIED' : 'BROKEN',
        entriesChecked: chainStatus.checkedCount,
        brokenAtId: chainStatus.brokenAtId || null,
      },
    });

    // Audit entries
    const auditResult = await auditLedgerService.getEntries({
      projectId,
      since: params?.dateRange?.start,
      until: params?.dateRange?.end,
      action: params?.actions,
      limit: 1000,
      offset: 0,
    });

    // Activity by actor type
    const actorTypeCounts: Record<string, number> = {};
    const actionCounts: Record<string, number> = {};
    for (const entry of auditResult.entries) {
      actorTypeCounts[entry.actorType] = (actorTypeCounts[entry.actorType] || 0) + 1;
      actionCounts[entry.action] = (actionCounts[entry.action] || 0) + 1;
    }

    sections.push({
      title: 'Activity by Actor Type',
      type: 'pie_chart',
      data: {
        labels: Object.keys(actorTypeCounts),
        datasets: [{ data: Object.values(actorTypeCounts) }],
      },
    });

    sections.push({
      title: 'Actions Summary',
      type: 'bar_chart',
      data: {
        labels: Object.keys(actionCounts),
        datasets: [{ data: Object.values(actionCounts) }],
      },
    });

    // Policy evaluation stats
    const policyStats = await policyEngineService.getEvaluationStats(
      projectId,
      params?.dateRange?.start,
    );
    sections.push({
      title: 'Policy Enforcement Summary',
      type: 'kpi',
      data: {
        totalEvaluations: policyStats.total,
        allowed: policyStats.allowed,
        blocked: policyStats.blocked,
        pendingApproval: policyStats.pendingApproval,
      },
    });

    // Recent audit entries as table
    sections.push({
      title: 'Audit Trail',
      type: 'table',
      data: {
        rows: auditResult.entries.slice(0, 200).map(e => ({
          timestamp: e.createdAt,
          action: e.action,
          actorId: e.actorId,
          actorType: e.actorType,
          entityType: e.entityType,
          entityId: e.entityId,
          source: e.source,
        })),
      },
    });

    return { sections };
  }

  async exportReport(templateId: string, format: 'csv' | 'pdf', params?: {
    dateRange?: { start: string; end: string };
    projectId?: string;
  }): Promise<{ data: string | GeneratedReport; contentType: string }> {
    const report = await this.generateReport(templateId, params);

    if (format === 'csv') {
      const csvString = this.reportToCsv(report);
      return { data: csvString, contentType: 'text/csv' };
    }

    // For PDF, return the report data for client-side rendering
    return { data: report, contentType: 'application/json' };
  }

  private reportToCsv(report: GeneratedReport): string {
    const lines: string[] = [];

    for (const section of report.sections) {
      lines.push(`"${section.title}"`);
      lines.push('');

      if (section.type === 'kpi' || section.type === 'kpi_card') {
        const kpis = section.data.kpis || [];
        for (const kpi of kpis) {
          lines.push(`"${kpi.label}","${kpi.value}"`);
        }
      } else if (section.type === 'table') {
        const table = section.data.table;
        if (table && table.headers?.length > 0) {
          lines.push(table.headers.map((h: string) => `"${h}"`).join(','));
          for (const row of table.rows) {
            lines.push(row.map((v: any) => `"${String(v ?? '')}"`).join(','));
          }
        }
      } else {
        // Chart types
        const chartData = section.data.chartData || [];
        lines.push('"Label","Value"');
        for (const item of chartData) {
          lines.push(`"${item.label}","${item.value ?? 0}"`);
        }
      }

      lines.push('');
    }

    return lines.join('\n');
  }
}

export const reportBuilderService = new ReportBuilderService();
