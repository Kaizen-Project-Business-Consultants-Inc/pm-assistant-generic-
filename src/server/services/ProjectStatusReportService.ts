import { randomUUID } from 'crypto';
import { claudeService, promptTemplates } from './claudeService';
import { AIContextBuilder } from './aiContextBuilder';
import { emailService } from './EmailService';
import { logAIUsage } from './aiUsageLogger';
import { databaseService } from '../database/connection';
import {
  renderStatusReportHtml,
  computeTrend,
  type StructuredStatusReport,
  type RAGArea,
} from '../utils/statusReportRenderer';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatusReportOptions {
  recipients?: string[];
  sendEmail?: boolean;
}

export interface StatusReportResult {
  id: string;
  projectId: string;
  html: string;
  data: StructuredStatusReport;
  generatedAt: string;
  aiPowered: boolean;
  emailSent: boolean;
}

export interface RAGThresholds {
  schedule: { amberPct: number; redPct: number };
  budget: { amberPct: number; redPct: number };
  resources: { amberCount: number; redCount: number };
  risks: { amberCount: number; redCount: number };
  scope: { amberCount: number; redCount: number };
  quality: { amberPct: number; redPct: number };
}

const DEFAULT_RAG_THRESHOLDS: RAGThresholds = {
  schedule: { amberPct: 5, redPct: 15 },
  budget: { amberPct: 90, redPct: 100 },
  resources: { amberCount: 1, redCount: 3 },
  risks: { amberCount: 1, redCount: 3 },
  scope: { amberCount: 1, redCount: 3 },
  quality: { amberPct: 5, redPct: 15 },
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ProjectStatusReportService {
  private contextBuilder: AIContextBuilder;

  constructor() {
    this.contextBuilder = new AIContextBuilder(null as any);
  }

  async generate(
    projectId: string,
    userId: string,
    options: StatusReportOptions = {},
  ): Promise<StatusReportResult> {
    // Build project context
    let projectData = '';
    let projectName = 'Unknown Project';
    try {
      const ctx = await this.contextBuilder.buildProjectContext(projectId);
      projectData = this.contextBuilder.toPromptString(ctx);
      projectName = ctx.project.name;
    } catch {
      projectData = `Project ID: ${projectId} (context unavailable)`;
    }

    // Get previous report RAG values
    const previousAreas = await this.getPreviousRAG(projectId);

    const reportId = randomUUID();
    const generatedAt = new Date().toISOString();
    const reportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    let structuredData: { executiveSummary: string; areas: Array<{ name: string; status: string; comments: string }>; managementActions: string[] };
    let aiPowered = false;

    if (claudeService.isAvailable()) {
      try {
        const thresholdsText = this.formatThresholds(DEFAULT_RAG_THRESHOLDS);
        const previousText = previousAreas
          ? JSON.stringify(previousAreas.map(a => ({ name: a.name, status: a.status })))
          : 'No previous report available.';

        const systemPrompt = promptTemplates.statusReport.render({
          projectData,
          ragThresholds: thresholdsText,
          previousReport: previousText,
        });

        const result = await claudeService.complete({
          systemPrompt,
          userMessage: 'Analyze the project data and generate the executive status report JSON.',
          responseFormat: 'json',
          temperature: 0.3,
          maxTokens: 2048,
        });

        // Strip markdown code fences if Claude wraps JSON in them
        let jsonStr = result.content.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        structuredData = JSON.parse(jsonStr);
        aiPowered = true;

        logAIUsage({
          userId,
          feature: 'status-report',
          model: 'claude',
          usage: result.usage,
          latencyMs: result.latencyMs,
          success: true,
          requestContext: { projectId },
        });
      } catch (error) {
        logger.error(`AI status report generation failed, using fallback: ${error instanceof Error ? error.message : String(error)}`);

        logAIUsage({
          userId,
          feature: 'status-report',
          model: 'claude',
          usage: { inputTokens: 0, outputTokens: 0 },
          latencyMs: 0,
          success: false,
          errorMessage: error instanceof Error ? error.message : String(error),
        });

        structuredData = this.generateFallbackData();
      }
    } else {
      structuredData = this.generateFallbackData();
    }

    // Build areas with previous status and trend
    const areas: RAGArea[] = structuredData.areas.map(area => {
      const prev = previousAreas?.find(p => p.name === area.name);
      const status = area.status as 'green' | 'amber' | 'red';
      const previousStatus = (prev?.status as 'green' | 'amber' | 'red') || null;
      return {
        name: area.name,
        status,
        previousStatus,
        trend: computeTrend(status, previousStatus),
        comments: area.comments,
      };
    });

    const report: StructuredStatusReport = {
      executiveSummary: structuredData.executiveSummary,
      areas,
      managementActions: structuredData.managementActions,
      projectName,
      reportDate,
      aiPowered,
    };

    const html = renderStatusReportHtml(report);

    // Store report
    await this.storeReport(reportId, projectId, projectName, report, generatedAt, userId);

    // Email if requested
    let emailSent = false;
    if (options.sendEmail && options.recipients?.length) {
      try {
        await emailService.sendStatusReportEmail(options.recipients, projectName, html);
        emailSent = true;
      } catch (err) {
        logger.error(`Failed to email status report: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { id: reportId, projectId, html, data: report, generatedAt, aiPowered, emailSent };
  }

  private async getPreviousRAG(projectId: string): Promise<Array<{ name: string; status: string }> | null> {
    try {
      const rows = await databaseService.queryControlPlane(
        `SELECT messages FROM ai_conversations
         WHERE project_id = ? AND context_type = 'status-report'
         ORDER BY created_at DESC LIMIT 1`,
        [projectId],
      );
      if (!rows.length) return null;

      const messages = typeof (rows[0] as any).messages === 'string'
        ? JSON.parse((rows[0] as any).messages)
        : (rows[0] as any).messages;

      if (messages?.[0]?.content) {
        const data = typeof messages[0].content === 'string'
          ? JSON.parse(messages[0].content)
          : messages[0].content;
        return data.areas || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async storeReport(
    id: string, projectId: string, projectName: string, report: StructuredStatusReport,
    generatedAt: string, userId: string,
  ): Promise<void> {
    try {
      const messages = [
        {
          role: 'system',
          content: JSON.stringify({
            reportType: 'status-report',
            executiveSummary: report.executiveSummary,
            areas: report.areas.map(a => ({ name: a.name, status: a.status, comments: a.comments })),
            managementActions: report.managementActions,
            aiPowered: report.aiPowered,
          }),
          timestamp: generatedAt,
        },
      ];

      await databaseService.queryControlPlane(
        `INSERT INTO ai_conversations (id, user_id, project_id, context_type, title, messages, token_count)
         VALUES (?, ?, ?, 'status-report', ?, ?, 0)`,
        [id, userId, projectId, `Status Report — ${projectName} — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`, JSON.stringify(messages)],
      );
    } catch (err) {
      logger.warn(`Failed to store status report (non-critical): ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private formatThresholds(t: RAGThresholds): string {
    return [
      `Schedule: Green = <${t.schedule.amberPct}% tasks overdue, Amber = ${t.schedule.amberPct}-${t.schedule.redPct}% overdue, Red = >${t.schedule.redPct}% overdue`,
      `Budget: Green = <${t.budget.amberPct}% spent vs progress, Amber = ${t.budget.amberPct}-${t.budget.redPct}%, Red = >${t.budget.redPct}% (over budget)`,
      `Resources: Green = 0 overallocated, Amber = ${t.resources.amberCount}-${t.resources.redCount - 1} overallocated, Red = ${t.resources.redCount}+ overallocated`,
      `Risks: Green = 0 high/critical risks, Amber = ${t.risks.amberCount}-${t.risks.redCount - 1} high, Red = ${t.risks.redCount}+ high or any critical`,
      `Scope: Green = 0 change requests, Amber = ${t.scope.amberCount}-${t.scope.redCount - 1} pending, Red = ${t.scope.redCount}+ or unapproved growth`,
      `Quality: Green = <${t.quality.amberPct}% tasks missing data, Amber = ${t.quality.amberPct}-${t.quality.redPct}%, Red = >${t.quality.redPct}% missing estimates/dates`,
    ].join('\n');
  }

  generateSample(projectId: string): StatusReportResult {
    const reportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    const areas: RAGArea[] = [
      { name: 'Schedule', status: 'green', previousStatus: 'green', trend: 'stable', comments: 'Project is tracking on schedule with 78% of milestones completed on time.' },
      { name: 'Budget', status: 'amber', previousStatus: 'green', trend: 'declining', comments: 'Spending is at 92% of allocated budget with 15% of deliverables remaining.' },
      { name: 'Resources', status: 'green', previousStatus: 'amber', trend: 'improving', comments: 'Resource gaps addressed — two new team members onboarded this sprint.' },
      { name: 'Risks', status: 'amber', previousStatus: 'amber', trend: 'stable', comments: '3 medium-severity risks open. Key dependency on third-party API delivery.' },
      { name: 'Scope', status: 'green', previousStatus: 'green', trend: 'stable', comments: 'No change requests pending. Scope baseline is intact.' },
      { name: 'Quality', status: 'green', previousStatus: 'amber', trend: 'improving', comments: 'Defect rate decreased 40% after additional code review process.' },
    ];

    const report: StructuredStatusReport = {
      executiveSummary: 'This is a sample status report demonstrating the AI-powered reporting feature. With a paid plan, this report will be generated using your actual project data — including real task progress, budget metrics, risk assessments, and trend analysis powered by AI.',
      areas,
      managementActions: [
        'Review budget allocation for remaining deliverables',
        'Monitor third-party API dependency timeline',
        'Continue enhanced code review process to sustain quality gains',
      ],
      projectName: 'Sample Project Report',
      reportDate,
      aiPowered: false,
    };

    const html = renderStatusReportHtml(report);

    return {
      id: 'sample',
      projectId,
      html,
      data: report,
      generatedAt: new Date().toISOString(),
      aiPowered: false,
      emailSent: false,
    };
  }

  private generateFallbackData() {
    return {
      executiveSummary: 'AI-powered analysis is currently unavailable. This is a template report based on available project data. Enable AI features for comprehensive executive analysis.',
      areas: [
        { name: 'Schedule', status: 'amber', comments: 'Review project dashboard for schedule status' },
        { name: 'Budget', status: 'amber', comments: 'Review budget dashboard for financial status' },
        { name: 'Resources', status: 'amber', comments: 'Review resource allocation' },
        { name: 'Risks', status: 'amber', comments: 'Review RAID log for current risks' },
        { name: 'Scope', status: 'amber', comments: 'Review change requests' },
        { name: 'Quality', status: 'amber', comments: 'Review task data completeness' },
      ],
      managementActions: [
        'Enable AI features for comprehensive project analysis',
        'Review and update task statuses',
        'Address any overdue items',
      ],
    };
  }
}

export const projectStatusReportService = new ProjectStatusReportService();
