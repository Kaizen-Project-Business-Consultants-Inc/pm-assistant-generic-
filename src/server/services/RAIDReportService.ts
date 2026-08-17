import { randomUUID } from 'crypto';
import { riskRepository, type ProjectRisk } from '../database/RiskRepository';
import { projectMemberRepository } from '../database/ProjectMemberRepository';
import { emailService } from './EmailService';
import { databaseService } from '../database/connection';
import {
  renderRAIDReportHtml,
  type RAIDReportData,
  type RAIDReportItem,
  type RAIDReportFilters,
  type SeverityBreakdown,
} from '../utils/raidReportRenderer';
import logger from '../utils/logger';

export interface RAIDReportOptions {
  filters?: RAIDReportFilters;
  recipients?: string[];
  sendEmail?: boolean;
}

export interface RAIDReportResult {
  id: string;
  projectId: string;
  html: string;
  generatedAt: string;
  emailSent: boolean;
  itemCount: number;
}

const OPEN_STATUSES = new Set([
  'open', 'monitoring', 'mitigating', 'in_progress', 'pending_decision',
]);

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export class RAIDReportService {
  async generate(
    projectId: string,
    userId: string,
    options: RAIDReportOptions = {},
  ): Promise<RAIDReportResult> {
    const reportId = randomUUID();
    const generatedAt = new Date().toISOString();
    const reportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    // Fetch all items for this project (no filter — we filter in memory for multi-value support)
    const allItems = await riskRepository.findByProject(projectId);
    const members = await projectMemberRepository.findByProjectId(projectId);

    // Build member lookup
    const memberMap: Record<string, string> = {};
    for (const m of members) {
      memberMap[m.userId] = m.userName || m.email;
      memberMap[m.id] = m.userName || m.email;
    }

    // Get project name
    let projectName = 'Project';
    try {
      const rows = await databaseService.query<{ name: string }>(
        'SELECT name FROM projects WHERE id = ?', [projectId],
      );
      if (rows.length) projectName = rows[0].name;
    } catch { /* use default */ }

    // Filter items
    const filters = options.filters || {};
    const now = new Date();

    let filtered = allItems.filter(item => {
      // Default: only open items unless filters override
      if (!OPEN_STATUSES.has(item.status)) return false;
      if (filters.types?.length && !filters.types.includes(item.type)) return false;
      if (filters.severities?.length && !filters.severities.includes(item.severity)) return false;
      if (filters.owners?.length && !filters.owners.includes(item.ownerId || '')) return false;
      if (filters.categories?.length && !filters.categories.includes(item.category)) return false;
      return true;
    });

    // Sort: severity (critical first), then days open desc
    filtered.sort((a, b) => {
      const sevDiff = (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99);
      if (sevDiff !== 0) return sevDiff;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); // older first = more days open
    });

    // Map to report items
    const reportItems: RAIDReportItem[] = filtered.map(item => ({
      recordId: item.recordId || item.id.slice(0, 8),
      type: item.type,
      title: item.title,
      severity: item.severity,
      status: item.status,
      ownerName: item.ownerId ? (memberMap[item.ownerId] || 'Unassigned') : 'Unassigned',
      dueDate: item.dueDate,
      daysOpen: Math.max(0, Math.floor((now.getTime() - new Date(item.createdAt).getTime()) / 86400000)),
      mitigationPlan: item.mitigationPlan,
      category: item.category,
    }));

    // Build summary
    const summary = {
      openRisks: this.breakdownBySeverity(filtered.filter(i => i.type === 'risk')),
      openIssues: this.breakdownBySeverity(filtered.filter(i => i.type === 'issue')),
      openActions: this.breakdownBySeverity(filtered.filter(i => i.type === 'action')),
      pendingDecisions: this.breakdownBySeverity(filtered.filter(i => i.type === 'decision')),
    };

    // Overdue actions
    const overdueActions = reportItems.filter(
      item => item.type === 'action' && item.dueDate && new Date(item.dueDate) < now && !['completed', 'closed'].includes(item.status),
    );

    // Critical/high risks with mitigation plans
    const criticalMitigations = reportItems.filter(
      item => item.type === 'risk' && (item.severity === 'critical' || item.severity === 'high'),
    );

    // Filters summary text
    const filterParts: string[] = [];
    if (filters.types?.length) filterParts.push(`Types: ${filters.types.join(', ')}`);
    if (filters.severities?.length) filterParts.push(`Severities: ${filters.severities.join(', ')}`);
    if (filters.owners?.length) filterParts.push(`Owners: ${filters.owners.map(id => memberMap[id] || id).join(', ')}`);
    if (filters.categories?.length) filterParts.push(`Categories: ${filters.categories.join(', ')}`);

    const reportData: RAIDReportData = {
      projectName,
      reportDate,
      items: reportItems,
      summary,
      overdueActions,
      criticalMitigations,
      filtersApplied: filterParts.length ? filterParts.join(' | ') : null,
    };

    const html = renderRAIDReportHtml(reportData);

    // Store report (non-critical)
    this.storeReport(reportId, projectId, reportData, generatedAt, userId).catch(err => {
      logger.warn(`Failed to store RAID report (non-critical): ${err instanceof Error ? err.message : String(err)}`);
    });

    // Email if requested
    let emailSent = false;
    if (options.sendEmail && options.recipients?.length) {
      try {
        await emailService.sendRAIDReportEmail(options.recipients, projectName, html);
        emailSent = true;
      } catch (err) {
        logger.error(`Failed to email RAID report: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { id: reportId, projectId, html, generatedAt, emailSent, itemCount: reportItems.length };
  }

  generateSample(projectId: string): RAIDReportResult {
    const reportDate = new Date().toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });

    const sampleItems: RAIDReportItem[] = [
      { recordId: 'R-001', type: 'risk', title: 'Key vendor may not deliver on time', severity: 'critical', status: 'open', ownerName: 'Jane Smith', dueDate: null, daysOpen: 14, mitigationPlan: 'Identify alternative vendor; weekly check-ins', category: 'Vendor' },
      { recordId: 'R-002', type: 'risk', title: 'Budget overrun risk on Phase 2', severity: 'high', status: 'mitigating', ownerName: 'John Doe', dueDate: null, daysOpen: 21, mitigationPlan: 'Reduce scope for non-essential items', category: 'Budget' },
      { recordId: 'I-001', type: 'issue', title: 'Staging environment outage', severity: 'high', status: 'in_progress', ownerName: 'DevOps Team', dueDate: null, daysOpen: 3, mitigationPlan: null, category: 'Technical' },
      { recordId: 'A-001', type: 'action', title: 'Complete security review', severity: 'high', status: 'open', ownerName: 'Jane Smith', dueDate: '2026-08-10', daysOpen: 10, mitigationPlan: null, category: 'Compliance' },
      { recordId: 'A-002', type: 'action', title: 'Update project charter', severity: 'medium', status: 'in_progress', ownerName: 'John Doe', dueDate: '2026-08-20', daysOpen: 5, mitigationPlan: null, category: 'Governance' },
      { recordId: 'D-001', type: 'decision', title: 'Select cloud provider for production', severity: 'high', status: 'pending_decision', ownerName: 'Steering Committee', dueDate: null, daysOpen: 7, mitigationPlan: null, category: 'Architecture' },
    ];

    const reportData: RAIDReportData = {
      projectName: 'Sample Project',
      reportDate,
      items: sampleItems,
      summary: {
        openRisks: { critical: 1, high: 1, medium: 0, low: 0 },
        openIssues: { critical: 0, high: 1, medium: 0, low: 0 },
        openActions: { critical: 0, high: 1, medium: 1, low: 0 },
        pendingDecisions: { critical: 0, high: 1, medium: 0, low: 0 },
      },
      overdueActions: [sampleItems[3]], // A-001 is overdue
      criticalMitigations: [sampleItems[0], sampleItems[1]],
      filtersApplied: null,
    };

    const html = renderRAIDReportHtml(reportData);

    return {
      id: 'sample',
      projectId,
      html,
      generatedAt: new Date().toISOString(),
      emailSent: false,
      itemCount: sampleItems.length,
    };
  }

  private breakdownBySeverity(items: ProjectRisk[]): SeverityBreakdown {
    const b: SeverityBreakdown = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const item of items) {
      const s = item.severity as keyof SeverityBreakdown;
      if (s in b) b[s]++;
    }
    return b;
  }

  private async storeReport(
    id: string, projectId: string, data: RAIDReportData,
    generatedAt: string, userId: string,
  ): Promise<void> {
    const messages = [
      {
        role: 'system',
        content: JSON.stringify({
          reportType: 'raid-report',
          itemCount: data.items.length,
          summary: data.summary,
          filtersApplied: data.filtersApplied,
        }),
        timestamp: generatedAt,
      },
    ];

    await databaseService.queryControlPlane(
      `INSERT INTO ai_conversations (id, user_id, project_id, context_type, title, messages, token_count)
       VALUES (?, ?, ?, 'raid-report', ?, ?, 0)`,
      [id, userId, projectId, 'RAID Report', JSON.stringify(messages)],
    );
  }
}

export const raidReportService = new RAIDReportService();
