import { randomUUID } from 'crypto';
import { claudeService, promptTemplates } from './claudeService';
import { AIContextBuilder, type StatusReportContext } from './aiContextBuilder';
import { emailService } from './EmailService';
import { logAIUsage } from './aiUsageLogger';
import { databaseService } from '../database/connection';
import {
  renderStatusReportHtml,
  computeTrend,
  type StructuredStatusReport,
  type RAGArea,
  type MilestoneRow,
  type AttentionItem,
  type ChangeControlRow,
} from '../utils/statusReportRenderer';
import { userService } from './UserService';
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
// AI response shape (what Claude returns)
// ---------------------------------------------------------------------------

interface AIStatusReportResponse {
  executiveSummary: string;
  overallStatus: { status: string; comments: string };
  areas: Array<{ name: string; status: string; comments: string }>;
  achievements: string[];
  plannedActivities: string[];
  managementAttention: Array<{
    ref: string;
    matter: string;
    raised: string;
    owner: string;
    dateNeeded: string;
    impactIfDelayed: string;
  }>;
}

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
    // Build enriched context
    let srContext: StatusReportContext | null = null;
    let projectName = 'Unknown Project';
    let projectData = '';
    try {
      srContext = await this.contextBuilder.buildStatusReportContext(projectId);
      projectData = srContext.promptString;
      projectName = srContext.projectContext.project.name;
    } catch {
      projectData = `Project ID: ${projectId} (context unavailable)`;
    }

    // Get previous report RAG values
    const previousAreas = await this.getPreviousRAG(projectId);

    // Report number
    const reportNumber = await this.getNextReportNumber(projectId);

    // Reporting period
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 14);
    const reportingPeriod = `${this.formatShortDate(periodStart)} – ${this.formatShortDate(periodEnd)}`;

    // Prepared by
    let preparedBy = 'System';
    try {
      const user = await userService.findById(userId);
      if (user) preparedBy = user.fullName || user.username;
    } catch { /* fallback to 'System' */ }

    const reportId = randomUUID();
    const generatedAt = new Date().toISOString();
    const reportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    let aiResponse: AIStatusReportResponse;
    let aiPowered = false;

    if (claudeService.isAvailable()) {
      try {
        const thresholdsText = this.formatThresholds(DEFAULT_RAG_THRESHOLDS);
        const previousText = previousAreas
          ? JSON.stringify(previousAreas.map(a => ({ name: a.name, status: a.status })))
          : 'No previous report available.';

        // Build enriched context blocks
        const milestonesText = srContext?.milestones.length
          ? srContext.milestones.map(m =>
            `- ${m.name} | Due: ${m.dueDate || 'N/A'} | Status: ${m.status} | Progress: ${m.progressPercentage ?? 0}%`
          ).join('\n')
          : 'No milestones defined.';

        const completedText = srContext?.completedTasks.length
          ? srContext.completedTasks.map(t =>
            `- ${t.name} (completed, updated ${t.updatedAt})`
          ).join('\n')
          : 'No tasks completed in this period.';

        const upcomingText = srContext?.upcomingTasks.length
          ? srContext.upcomingTasks.map(t =>
            `- ${t.name} | Due: ${t.dueDate || t.endDate || 'N/A'} | Status: ${t.status} | Assigned: ${t.assignedTo || 'Unassigned'}`
          ).join('\n')
          : 'No upcoming tasks in next 14 days.';

        const raidText = srContext?.criticalHighItems.length
          ? srContext.criticalHighItems.map(r =>
            `- [${r.type.toUpperCase()}] ${r.title} | Severity: ${r.severity} | Status: ${r.status} | Owner: ${r.ownerId || 'Unassigned'}`
          ).join('\n')
          : 'No critical/high RAID items.';

        const systemPrompt = promptTemplates.statusReport.render({
          projectData,
          milestones: milestonesText,
          completedTasks: completedText,
          upcomingTasks: upcomingText,
          raidItems: raidText,
          ragThresholds: thresholdsText,
          previousReport: previousText,
        });

        const result = await claudeService.complete({
          systemPrompt,
          userMessage: 'Analyze the project data and generate the comprehensive executive status report JSON.',
          responseFormat: 'json',
          temperature: 0.3,
          maxTokens: 3000,
        });

        // Strip markdown code fences if Claude wraps JSON in them
        let jsonStr = result.content.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
        }
        aiResponse = JSON.parse(jsonStr);
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

        aiResponse = this.generateFallbackAIResponse();
      }
    } else {
      aiResponse = this.generateFallbackAIResponse();
    }

    // Build areas with Overall Status row + 7 dimensions + previous status and trend
    const overallArea: RAGArea = {
      name: 'Overall Status',
      status: aiResponse.overallStatus.status as 'green' | 'amber' | 'red',
      previousStatus: previousAreas?.find(p => p.name === 'Overall Status')?.status as 'green' | 'amber' | 'red' || null,
      trend: 'stable',
      comments: aiResponse.overallStatus.comments,
    };
    overallArea.trend = computeTrend(overallArea.status, overallArea.previousStatus);

    const dimensionAreas: RAGArea[] = aiResponse.areas.map(area => {
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

    const areas: RAGArea[] = [overallArea, ...dimensionAreas];

    // Milestones from data (not AI)
    const milestones: MilestoneRow[] = (srContext?.milestones || []).map((m, i) => ({
      ref: `M${String(i + 1).padStart(2, '0')}`,
      name: m.name,
      dueDate: m.dueDate ? this.formatShortDate(new Date(m.dueDate)) : (m.endDate ? this.formatShortDate(new Date(m.endDate)) : 'TBD'),
      status: m.status === 'completed' ? 'Complete' : m.status === 'in_progress' ? 'In Progress' : 'Pending',
      comments: m.progressPercentage ? `${m.progressPercentage}% complete` : '',
    }));

    // Management attention from AI
    const managementAttention: AttentionItem[] = (aiResponse.managementAttention || []).map(item => ({
      ref: item.ref,
      matter: item.matter,
      raised: item.raised,
      owner: item.owner,
      dateNeeded: item.dateNeeded,
      impactIfDelayed: item.impactIfDelayed,
    }));

    // Change control from data (not AI)
    const changeControl: ChangeControlRow[] = (srContext?.changeRequests || []).map(cr => ({
      ref: cr.id.substring(0, 8).toUpperCase(),
      description: cr.title,
      status: cr.status,
      scheduleImpact: cr.impactSummary || 'To be assessed',
      costImpact: 'To be assessed',
    }));

    const report: StructuredStatusReport = {
      reportNumber,
      reportingPeriod,
      preparedBy,
      executiveSummary: aiResponse.executiveSummary,
      areas,
      milestones,
      achievements: aiResponse.achievements || [],
      plannedActivities: aiResponse.plannedActivities || [],
      managementAttention,
      changeControl,
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

  private async getNextReportNumber(projectId: string): Promise<string> {
    try {
      const rows = await databaseService.queryControlPlane(
        `SELECT COUNT(*) AS cnt FROM ai_conversations
         WHERE project_id = ? AND context_type = 'status-report'`,
        [projectId],
      );
      const count = Number((rows[0] as any)?.cnt || 0);
      return `SR-${String(count + 1).padStart(3, '0')}`;
    } catch {
      return 'SR-001';
    }
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
            reportNumber: report.reportNumber,
            executiveSummary: report.executiveSummary,
            areas: report.areas.map(a => ({ name: a.name, status: a.status, comments: a.comments })),
            milestones: report.milestones,
            achievements: report.achievements,
            plannedActivities: report.plannedActivities,
            managementAttention: report.managementAttention,
            changeControl: report.changeControl,
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

  private formatShortDate(d: Date): string {
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  generateSample(projectId: string): StatusReportResult {
    const reportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
    const periodEnd = new Date();
    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 14);

    const areas: RAGArea[] = [
      { name: 'Overall Status', status: 'amber', previousStatus: 'green', trend: 'declining', comments: 'Budget pressure driving overall status to amber.' },
      { name: 'Schedule', status: 'green', previousStatus: 'green', trend: 'stable', comments: 'Project is tracking on schedule with 78% of milestones completed on time.' },
      { name: 'Budget', status: 'amber', previousStatus: 'green', trend: 'declining', comments: 'Spending is at 92% of allocated budget with 15% of deliverables remaining.' },
      { name: 'Resources', status: 'green', previousStatus: 'amber', trend: 'improving', comments: 'Resource gaps addressed — two new team members onboarded this sprint.' },
      { name: 'Risks', status: 'amber', previousStatus: 'amber', trend: 'stable', comments: '3 medium-severity risks open. Key dependency on third-party API delivery.' },
      { name: 'Scope', status: 'green', previousStatus: 'green', trend: 'stable', comments: 'No change requests pending. Scope baseline is intact.' },
      { name: 'Quality', status: 'green', previousStatus: 'amber', trend: 'improving', comments: 'Defect rate decreased 40% after additional code review process.' },
      { name: 'Governance & Stakeholders', status: 'green', previousStatus: 'green', trend: 'stable', comments: 'Steering committee meeting held on schedule. No escalations.' },
    ];

    const report: StructuredStatusReport = {
      reportNumber: 'SR-001',
      reportingPeriod: `${this.formatShortDate(periodStart)} – ${this.formatShortDate(periodEnd)}`,
      preparedBy: 'Sample User',
      executiveSummary: 'This is a sample status report demonstrating the AI-powered reporting feature. With a paid plan, this report will be generated using your actual project data — including real task progress, budget metrics, risk assessments, milestone tracking, and trend analysis powered by AI.',
      areas,
      milestones: [
        { ref: 'M01', name: 'Requirements Sign-off', dueDate: 'Jul 15, 2026', status: 'Complete', comments: 'Approved by steering committee' },
        { ref: 'M02', name: 'Design Review', dueDate: 'Aug 1, 2026', status: 'In Progress', comments: '75% complete' },
        { ref: 'M03', name: 'UAT Start', dueDate: 'Sep 1, 2026', status: 'Pending', comments: '' },
      ],
      achievements: [
        'Completed API integration with third-party payment gateway',
        'Onboarded 2 new developers to address resource gap',
        'Delivered Phase 2 design documents ahead of schedule',
      ],
      plannedActivities: [
        'Begin UAT preparation — QA Lead — Aug 25',
        'Finalize infrastructure provisioning — DevOps — Aug 20',
        'Complete design review milestone — Architect — Aug 1',
      ],
      managementAttention: [
        { ref: 'MA-001', matter: 'Budget overrun risk on cloud infrastructure', raised: '2026-08-10', owner: 'Finance Officer', dateNeeded: '2026-08-20', impactIfDelayed: 'May exceed approved budget by 12%' },
        { ref: 'MA-002', matter: 'Third-party API delivery dependency', raised: '2026-07-28', owner: 'Project Manager', dateNeeded: '2026-08-15', impactIfDelayed: '2-week schedule slip on integration milestone' },
      ],
      changeControl: [],
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

  private generateFallbackAIResponse(): AIStatusReportResponse {
    return {
      executiveSummary: 'AI-powered analysis is currently unavailable. This is a template report based on available project data. Enable AI features for comprehensive executive analysis.',
      overallStatus: { status: 'amber', comments: 'AI unavailable — manual review recommended' },
      areas: [
        { name: 'Schedule', status: 'amber', comments: 'Review project dashboard for schedule status' },
        { name: 'Budget', status: 'amber', comments: 'Review budget dashboard for financial status' },
        { name: 'Resources', status: 'amber', comments: 'Review resource allocation' },
        { name: 'Risks', status: 'amber', comments: 'Review RAID log for current risks' },
        { name: 'Scope', status: 'amber', comments: 'Review change requests' },
        { name: 'Quality', status: 'amber', comments: 'Review task data completeness' },
        { name: 'Governance & Stakeholders', status: 'amber', comments: 'Review governance activities' },
      ],
      achievements: ['Enable AI features for comprehensive project analysis'],
      plannedActivities: ['Review and update task statuses', 'Address any overdue items'],
      managementAttention: [
        {
          ref: 'MA-001',
          matter: 'Enable AI features for comprehensive project analysis',
          raised: new Date().toISOString().split('T')[0],
          owner: 'Admin',
          dateNeeded: 'ASAP',
          impactIfDelayed: 'Reports will lack AI-driven insights and trend analysis',
        },
      ],
    };
  }
}

export const projectStatusReportService = new ProjectStatusReportService();
