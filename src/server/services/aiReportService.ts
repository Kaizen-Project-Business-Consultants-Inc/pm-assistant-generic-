import { randomUUID } from 'crypto';
import { claudeService, promptTemplates } from './claudeService';
import { AIContextBuilder } from './aiContextBuilder';
import { logAIUsage } from './aiUsageLogger';
import { databaseService } from '../database/connection';
import logger from '../utils/logger';

export type ReportType = 'weekly-status' | 'risk-assessment' | 'budget-forecast' | 'resource-utilization';

export interface ReportOptions {
  projectId?: string;
  dateRange?: { start: string; end: string };
}

export interface GeneratedReport {
  id: string;
  reportType: ReportType;
  title: string;
  content: string;
  generatedAt: string;
  aiPowered: boolean;
  metadata: {
    projectId?: string;
    tokenCount?: number;
  };
}

const REPORT_TITLES: Record<ReportType, string> = {
  'weekly-status': 'Weekly Status Report',
  'risk-assessment': 'Risk Assessment Report',
  'budget-forecast': 'Budget Forecast Report',
  'resource-utilization': 'Resource Utilization Report',
};

export class AIReportService {
  private contextBuilder: AIContextBuilder;

  constructor() {
    this.contextBuilder = new AIContextBuilder(null as any);
  }

  async generateReport(
    reportType: ReportType,
    options: ReportOptions = {},
    userId: string = 'anonymous',
  ): Promise<GeneratedReport> {
    // Build context
    let projectData = '';
    let projectName = '';
    if (options.projectId) {
      try {
        const ctx = await this.contextBuilder.buildProjectContext(options.projectId);
        projectData = this.contextBuilder.toPromptString(ctx);
        projectName = ctx.project.name;
      } catch {
        projectData = `Project ID: ${options.projectId} (context unavailable)`;
      }
    } else {
      try {
        const ctx = await this.contextBuilder.buildPortfolioContext();
        projectData = this.contextBuilder.portfolioToPromptString(ctx);
      } catch {
        projectData = 'Portfolio context unavailable.';
      }
    }

    const reportId = randomUUID();
    const now = new Date();
    const generatedAt = now.toISOString();
    const dateSuffix = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const title = projectName
      ? `${REPORT_TITLES[reportType]} — ${projectName} — ${dateSuffix}`
      : `${REPORT_TITLES[reportType]} — Portfolio — ${dateSuffix}`;

    if (!claudeService.isAvailable()) {
      const content = this.generateFallbackReport(reportType, projectData);
      const report: GeneratedReport = {
        id: reportId,
        reportType,
        title,
        content,
        generatedAt,
        aiPowered: false,
        metadata: { projectId: options.projectId },
      };
      await this.storeReport(report, userId);
      return report;
    }

    try {
      const systemPrompt = promptTemplates.reportGeneration.render({
        reportType,
        projectData,
      });

      const result = await claudeService.complete({
        systemPrompt,
        userMessage: `Generate a comprehensive ${title} based on the provided data. Format the report in markdown.`,
        temperature: 0.3,
        maxTokens: 4096,
      });

      const report: GeneratedReport = {
        id: reportId,
        reportType,
        title,
        content: result.content,
        generatedAt,
        aiPowered: true,
        metadata: {
          projectId: options.projectId,
          tokenCount: result.usage.inputTokens + result.usage.outputTokens,
        },
      };

      logAIUsage({
        userId,
        feature: `report-${reportType}`,
        model: 'claude',
        usage: result.usage,
        latencyMs: result.latencyMs,
        success: true,
        requestContext: { reportType, projectId: options.projectId },
      });

      await this.storeReport(report, userId);
      return report;
    } catch (error) {
      logger.error(`AI report generation failed, using fallback: ${error instanceof Error ? error.message : String(error)}`);

      logAIUsage({
        userId,
        feature: `report-${reportType}`,
        model: 'claude',
        usage: { inputTokens: 0, outputTokens: 0 },
        latencyMs: 0,
        success: false,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      const content = this.generateFallbackReport(reportType, projectData);
      const report: GeneratedReport = {
        id: reportId,
        reportType,
        title,
        content,
        generatedAt,
        aiPowered: false,
        metadata: { projectId: options.projectId },
      };
      await this.storeReport(report, userId);
      return report;
    }
  }

  async getReportHistory(options: {
    userId?: string;
    type?: string;
    subType?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
    page?: number;
    limit?: number;
  } = {}): Promise<{
    reports: Array<{
      id: string;
      title: string;
      reportType: string;
      generatedAt: string;
      projectId: string | null;
      aiPowered: boolean;
      content: string;
      contextType: string;
    }>;
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    typeCounts: Record<string, number>;
  }> {
    const { userId, type, subType, search, dateFrom, dateTo, sortBy = 'created_at', sortOrder = 'desc', page = 1, limit = 20 } = options;
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const offset = (safePage - 1) * safeLimit;

    // Allowlist sort columns to prevent SQL injection
    const SORT_COLUMNS: Record<string, string> = {
      date: 'created_at',
      created_at: 'created_at',
      title: 'title',
      type: 'context_type',
    };
    const sortCol = SORT_COLUMNS[sortBy] || 'created_at';
    const sortDir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    try {
      // Build WHERE conditions
      const conditions: string[] = [
        `context_type IN ('report', 'raid-report', 'status-report')`,
        `is_active = TRUE`,
      ];
      const params: any[] = [];

      if (userId) {
        conditions.push('user_id = ?');
        params.push(userId);
      }

      if (type) {
        // Validate against allowed context_type values
        const validTypes = ['report', 'raid-report', 'status-report'];
        if (validTypes.includes(type)) {
          conditions.push('context_type = ?');
          params.push(type);
        }
      }

      if (subType) {
        // Sub-type filtering for AI reports (context_type='report')
        // Titles start with the base name: "Weekly Status Report — Aug 17, 2026"
        const subTypeTitleMap: Record<string, string> = {
          'weekly-status': 'Weekly Status Report',
          'risk-assessment': 'Risk Assessment Report',
          'budget-forecast': 'Budget Forecast Report',
          'resource-utilization': 'Resource Utilization Report',
        };
        const subTitle = subTypeTitleMap[subType];
        if (subTitle) {
          conditions.push('title LIKE ?');
          params.push(`${subTitle}%`);
        }
      }

      if (search) {
        conditions.push('title LIKE ?');
        params.push(`%${search}%`);
      }

      if (dateFrom) {
        conditions.push('created_at >= ?');
        params.push(dateFrom);
      }

      if (dateTo) {
        conditions.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)');
        params.push(dateTo);
      }

      const whereClause = conditions.join(' AND ');

      // Get type counts (unfiltered except userId + is_active)
      const countConditions = [
        `context_type IN ('report', 'raid-report', 'status-report')`,
        `is_active = TRUE`,
      ];
      const countParams: any[] = [];
      if (userId) {
        countConditions.push('user_id = ?');
        countParams.push(userId);
      }
      const countRows = await databaseService.queryControlPlane(
        `SELECT context_type, COUNT(*) as cnt FROM ai_conversations WHERE ${countConditions.join(' AND ')} GROUP BY context_type`,
        countParams,
      );
      const typeCounts: Record<string, number> = {};
      for (const row of countRows as any[]) {
        typeCounts[row.context_type] = Number(row.cnt);
      }

      // Get total for current filter
      const totalRows = await databaseService.queryControlPlane(
        `SELECT COUNT(*) as total FROM ai_conversations WHERE ${whereClause}`,
        params,
      );
      const total = Number((totalRows as any[])[0]?.total || 0);

      // Get page of results
      const rows = await databaseService.queryControlPlane(
        `SELECT id, title, context_type, project_id, messages, token_count, created_at
         FROM ai_conversations
         WHERE ${whereClause}
         ORDER BY ${sortCol} ${sortDir}
         LIMIT ? OFFSET ?`,
        [...params, safeLimit, offset],
      );

      const reports = (rows as any[]).map((row: any) => {
        let reportData: any = {};
        try {
          const messages = typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages;
          if (messages && messages.length > 0) {
            reportData = typeof messages[0].content === 'string'
              ? (() => { try { return JSON.parse(messages[0].content); } catch { return {}; } })()
              : messages[0].content;
          }
        } catch { /* ignore parse errors */ }

        const contextType = row.context_type as string;
        let reportType = reportData.reportType || 'unknown';
        if (contextType === 'raid-report') reportType = 'raid-report';
        if (contextType === 'status-report') reportType = 'status-report';

        return {
          id: row.id,
          title: row.title,
          reportType,
          generatedAt: row.created_at,
          projectId: row.project_id,
          aiPowered: reportData.aiPowered ?? (contextType !== 'raid-report'),
          content: reportData.content || '',
          contextType,
        };
      });

      return {
        reports,
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
        typeCounts,
      };
    } catch (err) {
      logger.warn(`Failed to fetch report history: ${err instanceof Error ? err.message : String(err)}`);
      return { reports: [], total: 0, page: 1, limit: safeLimit, totalPages: 0, typeCounts: {} };
    }
  }

  async deleteReport(reportId: string, userId: string): Promise<void> {
    await databaseService.queryControlPlane(
      `UPDATE ai_conversations SET is_active = FALSE WHERE id = ? AND user_id = ? AND context_type IN ('report', 'raid-report', 'status-report')`,
      [reportId, userId],
    );
  }

  private async storeReport(report: GeneratedReport, userId: string): Promise<void> {
    try {
      const messages = [
        {
          role: 'system',
          content: JSON.stringify({
            reportType: report.reportType,
            content: report.content,
            aiPowered: report.aiPowered,
            metadata: report.metadata,
          }),
          timestamp: report.generatedAt,
        },
      ];

      await databaseService.queryControlPlane(
        `INSERT INTO ai_conversations (id, user_id, project_id, context_type, title, messages, token_count)
         VALUES (?, ?, ?, 'report', ?, ?, ?)`,
        [
          report.id,
          userId,
          report.metadata.projectId || null,
          report.title,
          JSON.stringify(messages),
          report.metadata.tokenCount || 0,
        ],
      );
    } catch (err) {
      logger.warn(`Failed to store report (non-critical): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private generateFallbackReport(reportType: ReportType, projectData: string): string {
    const now = new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });

    switch (reportType) {
      case 'weekly-status':
        return `# Weekly Status Report\n\n**Generated:** ${now}\n**Mode:** Template (AI unavailable)\n\n## Executive Summary\nThis is an auto-generated status report based on available project data.\n\n## Project Data\n${projectData}\n\n## Recommendations\n- Enable AI features for comprehensive analysis\n- Review project timelines and milestones\n- Address any overdue tasks`;
      case 'risk-assessment':
        return `# Risk Assessment Report\n\n**Generated:** ${now}\n**Mode:** Template (AI unavailable)\n\n## Executive Summary\nThis is an auto-generated risk report based on available project data.\n\n## Project Data\n${projectData}\n\n## Key Risk Areas\n- Schedule delays\n- Budget overruns\n- Resource constraints\n\n## Recommendations\n- Enable AI features for detailed risk scoring\n- Review high-priority project risks\n- Update risk mitigation plans`;
      case 'budget-forecast':
        return `# Budget Forecast Report\n\n**Generated:** ${now}\n**Mode:** Template (AI unavailable)\n\n## Executive Summary\nThis is an auto-generated budget report based on available project data.\n\n## Project Data\n${projectData}\n\n## Recommendations\n- Enable AI features for earned value analysis\n- Review budget utilization trends\n- Monitor cost variance indicators`;
      case 'resource-utilization':
        return `# Resource Utilization Report\n\n**Generated:** ${now}\n**Mode:** Template (AI unavailable)\n\n## Executive Summary\nThis is an auto-generated resource report based on available project data.\n\n## Project Data\n${projectData}\n\n## Recommendations\n- Enable AI features for workload analysis\n- Review team capacity and assignments\n- Identify resource rebalancing opportunities`;
    }
  }
}
