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
    if (options.projectId) {
      try {
        const ctx = await this.contextBuilder.buildProjectContext(options.projectId);
        projectData = this.contextBuilder.toPromptString(ctx);
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
    const generatedAt = new Date().toISOString();
    const title = REPORT_TITLES[reportType];

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

  async getReportHistory(userId?: string, limit: number = 20): Promise<Array<{
    id: string;
    title: string;
    reportType: string;
    generatedAt: string;
    projectId: string | null;
    aiPowered: boolean;
    content: string;
  }>> {
    try {
      const query = userId
        ? `SELECT id, title, context_type, project_id, messages, token_count, created_at
           FROM ai_conversations
           WHERE context_type = 'report' AND user_id = ? AND is_active = TRUE
           ORDER BY created_at DESC
           LIMIT ?`
        : `SELECT id, title, context_type, project_id, messages, token_count, created_at
           FROM ai_conversations
           WHERE context_type = 'report' AND is_active = TRUE
           ORDER BY created_at DESC
           LIMIT ?`;

      const params = userId ? [userId, limit] : [limit];
      const rows = await databaseService.queryControlPlane(query, params);

      return (rows as any[]).map((row: any) => {
        let reportData: any = {};
        try {
          const messages = typeof row.messages === 'string' ? JSON.parse(row.messages) : row.messages;
          if (messages && messages.length > 0) {
            reportData = typeof messages[0].content === 'string'
              ? (() => { try { return JSON.parse(messages[0].content); } catch { return {}; } })()
              : messages[0].content;
          }
        } catch { /* ignore parse errors */ }

        return {
          id: row.id,
          title: row.title,
          reportType: reportData.reportType || 'unknown',
          generatedAt: row.created_at,
          projectId: row.project_id,
          aiPowered: reportData.aiPowered ?? true,
          content: reportData.content || '',
        };
      });
    } catch (err) {
      logger.warn(`Failed to fetch report history: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
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
