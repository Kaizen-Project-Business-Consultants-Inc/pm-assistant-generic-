/**
 * Renders a structured status report to styled HTML for UI and email.
 * DBJ Template Standard — 8 sections.
 */

export interface RAGArea {
  name: string;
  status: 'green' | 'amber' | 'red';
  previousStatus?: 'green' | 'amber' | 'red' | null;
  trend?: 'improving' | 'stable' | 'declining';
  comments: string;
}

export interface MilestoneRow {
  ref: string;
  name: string;
  dueDate: string;
  status: string;
  comments: string;
}

export interface AttentionItem {
  ref: string;
  matter: string;
  raised: string;
  owner: string;
  dateNeeded: string;
  impactIfDelayed: string;
}

export interface ChangeControlRow {
  ref: string;
  description: string;
  status: string;
  scheduleImpact: string;
  costImpact: string;
}

export interface StructuredStatusReport {
  reportNumber: string;
  reportingPeriod: string;
  preparedBy: string;
  executiveSummary: string;
  areas: RAGArea[];
  milestones: MilestoneRow[];
  achievements: string[];
  plannedActivities: string[];
  managementAttention: AttentionItem[];
  changeControl: ChangeControlRow[];
  projectName: string;
  reportDate: string;
  aiPowered: boolean;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATUS_CIRCLES: Record<string, string> = {
  green: '🟢',
  amber: '🟡',
  red: '🔴',
};

const TREND_ARROWS: Record<string, string> = {
  improving: '↑',
  stable: '→',
  declining: '↓',
};

const TREND_COLORS: Record<string, string> = {
  improving: '#166534',
  stable: '#6b7280',
  declining: '#991b1b',
};

export function computeTrend(current: string, previous: string | null | undefined): 'improving' | 'stable' | 'declining' {
  if (!previous) return 'stable';
  const order: Record<string, number> = { green: 0, amber: 1, red: 2 };
  const curr = order[current] ?? 1;
  const prev = order[previous] ?? 1;
  if (curr < prev) return 'improving';
  if (curr > prev) return 'declining';
  return 'stable';
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const TH_STYLE = 'padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; border-bottom: 2px solid #e2e8f0; background: #f1f5f9;';
const TD_STYLE = 'padding: 8px 12px; color: #1f2937; border-bottom: 1px solid #e5e7eb; font-size: 13px;';
const SECTION_TITLE = 'color: #1f2937; font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 12px;';

function sectionHeading(title: string, num: number): string {
  return `<h2 style="${SECTION_TITLE}">${num}. ${escapeHtml(title)}</h2>`;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderStatusReportHtml(report: StructuredStatusReport): string {
  const {
    reportNumber, reportingPeriod, preparedBy, executiveSummary, areas,
    milestones, achievements, plannedActivities, managementAttention,
    changeControl, projectName, reportDate, aiPowered,
  } = report;

  // --- 1. Header Metadata ---
  const headerHtml = `
    <div style="background: linear-gradient(135deg, #4f46e5, #7c3aed); padding: 20px 24px; border-radius: 12px 12px 0 0;">
      <h1 style="color: white; margin: 0; font-size: 18px; font-weight: 700;">Project Status Report</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 13px;">${escapeHtml(projectName)}</p>
    </div>
    <div style="background: #f8fafc; padding: 14px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; display: flex; flex-wrap: wrap; gap: 24px; font-size: 13px; color: #374151;">
      <span><strong>Report No.:</strong> ${escapeHtml(reportNumber)}</span>
      <span><strong>Period:</strong> ${escapeHtml(reportingPeriod)}</span>
      <span><strong>Date Issued:</strong> ${escapeHtml(reportDate)}</span>
      <span><strong>Prepared By:</strong> ${escapeHtml(preparedBy)}</span>
    </div>`;

  // --- 2. Executive Summary ---
  const summaryHtml = `
    <div style="padding: 20px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
      ${sectionHeading('Executive Summary', 2)}
      <p style="color: #374151; line-height: 1.7; margin: 0; font-size: 14px;">${escapeHtml(executiveSummary)}</p>
    </div>`;

  // --- 3. Overall Status (RAG Table) ---
  const ragRows = areas.map(area => {
    const currCircle = STATUS_CIRCLES[area.status] || '🟡';
    const prevCircle = area.previousStatus ? STATUS_CIRCLES[area.previousStatus] || '—' : '—';
    const trend = area.trend || 'stable';
    const trendArrow = TREND_ARROWS[trend];
    const trendColor = TREND_COLORS[trend];
    const isOverall = area.name === 'Overall Status';
    const rowBg = isOverall ? 'background: #f1f5f9; font-weight: 600;' : '';

    return `
      <tr style="${rowBg}">
        <td style="${TD_STYLE} font-weight: ${isOverall ? '700' : '600'};">${escapeHtml(area.name)}</td>
        <td style="${TD_STYLE} text-align: center; font-size: 18px;">${currCircle}</td>
        <td style="${TD_STYLE} text-align: center; font-size: 18px;">${prevCircle}</td>
        <td style="${TD_STYLE} text-align: center; font-size: 16px; font-weight: 700; color: ${trendColor};">${trendArrow}</td>
        <td style="${TD_STYLE}">${escapeHtml(area.comments)}</td>
      </tr>`;
  }).join('');

  const ragHtml = `
    <div style="padding: 20px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
      ${sectionHeading('Overall Status', 3)}
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="${TH_STYLE}">Dimension</th>
            <th style="${TH_STYLE} text-align: center;">This Period</th>
            <th style="${TH_STYLE} text-align: center;">Last Period</th>
            <th style="${TH_STYLE} text-align: center;">Trend</th>
            <th style="${TH_STYLE}">Commentary</th>
          </tr>
        </thead>
        <tbody>${ragRows}</tbody>
      </table>
    </div>`;

  // --- 4. Milestone Status ---
  let milestoneHtml = '';
  if (milestones.length > 0) {
    const milestoneRows = milestones.map(m => `
      <tr>
        <td style="${TD_STYLE}">${escapeHtml(m.ref)}</td>
        <td style="${TD_STYLE}">${escapeHtml(m.name)}</td>
        <td style="${TD_STYLE}">${escapeHtml(m.dueDate)}</td>
        <td style="${TD_STYLE}">${escapeHtml(m.status)}</td>
        <td style="${TD_STYLE}">${escapeHtml(m.comments)}</td>
      </tr>`).join('');

    milestoneHtml = `
      <div style="padding: 20px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
        ${sectionHeading('Milestone Status', 4)}
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="${TH_STYLE}">M#</th>
              <th style="${TH_STYLE}">Milestone</th>
              <th style="${TH_STYLE}">Due Date</th>
              <th style="${TH_STYLE}">Status</th>
              <th style="${TH_STYLE}">Comments</th>
            </tr>
          </thead>
          <tbody>${milestoneRows}</tbody>
        </table>
      </div>`;
  }

  // --- 5. Achievements This Period ---
  let achievementsHtml = '';
  if (achievements.length > 0) {
    const items = achievements.map(a =>
      `<li style="color: #1f2937; margin: 4px 0; line-height: 1.5;">${escapeHtml(a)}</li>`
    ).join('');
    achievementsHtml = `
      <div style="padding: 20px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
        ${sectionHeading('Achievements This Period', 5)}
        <ul style="margin: 0; padding-left: 20px;">${items}</ul>
      </div>`;
  }

  // --- 6. Planned Activities — Next Period ---
  let plannedHtml = '';
  if (plannedActivities.length > 0) {
    const items = plannedActivities.map(a =>
      `<li style="color: #1f2937; margin: 4px 0; line-height: 1.5;">${escapeHtml(a)}</li>`
    ).join('');
    plannedHtml = `
      <div style="padding: 20px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
        ${sectionHeading('Planned Activities — Next Period', 6)}
        <ul style="margin: 0; padding-left: 20px;">${items}</ul>
      </div>`;
  }

  // --- 7. For Management Attention ---
  let mgmtHtml = '';
  if (managementAttention.length > 0) {
    const mgmtRows = managementAttention.map(item => `
      <tr>
        <td style="${TD_STYLE}">${escapeHtml(item.ref)}</td>
        <td style="${TD_STYLE}">${escapeHtml(item.matter)}</td>
        <td style="${TD_STYLE}">${escapeHtml(item.raised)}</td>
        <td style="${TD_STYLE}">${escapeHtml(item.owner)}</td>
        <td style="${TD_STYLE}">${escapeHtml(item.dateNeeded)}</td>
        <td style="${TD_STYLE}">${escapeHtml(item.impactIfDelayed)}</td>
      </tr>`).join('');

    mgmtHtml = `
      <div style="background: #fffbeb; padding: 20px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; border-top: 2px solid #f59e0b;">
        ${sectionHeading('For Management Attention', 7)}
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="${TH_STYLE}">Ref</th>
              <th style="${TH_STYLE}">Matter</th>
              <th style="${TH_STYLE}">Raised</th>
              <th style="${TH_STYLE}">Owner</th>
              <th style="${TH_STYLE}">Date Needed</th>
              <th style="${TH_STYLE}">Impact if Delayed</th>
            </tr>
          </thead>
          <tbody>${mgmtRows}</tbody>
        </table>
      </div>`;
  }

  // --- 8. Change Control ---
  let changeHtml = '';
  if (changeControl.length > 0) {
    const changeRows = changeControl.map(cr => `
      <tr>
        <td style="${TD_STYLE}">${escapeHtml(cr.ref)}</td>
        <td style="${TD_STYLE}">${escapeHtml(cr.description)}</td>
        <td style="${TD_STYLE}">${escapeHtml(cr.status)}</td>
        <td style="${TD_STYLE}">${escapeHtml(cr.scheduleImpact)}</td>
        <td style="${TD_STYLE}">${escapeHtml(cr.costImpact)}</td>
      </tr>`).join('');

    changeHtml = `
      <div style="padding: 20px 24px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
        ${sectionHeading('Change Control', 8)}
        <table style="width: 100%; border-collapse: collapse;">
          <thead>
            <tr>
              <th style="${TH_STYLE}">CR Ref</th>
              <th style="${TH_STYLE}">Description</th>
              <th style="${TH_STYLE}">Status</th>
              <th style="${TH_STYLE}">Schedule Impact</th>
              <th style="${TH_STYLE}">Cost Impact</th>
            </tr>
          </thead>
          <tbody>${changeRows}</tbody>
        </table>
      </div>`;
  }

  // --- Footer ---
  const footerHtml = `
    <div style="padding: 12px 24px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 12px 12px; background: #f8fafc;">
      <p style="color: #9ca3af; font-size: 11px; text-align: center; margin: 0;">
        ${aiPowered ? 'AI-Generated Report' : 'Template Report (AI unavailable)'} — Kovarti PM Assistant
      </p>
    </div>`;

  return `
    <div style="font-family: ${FONT}; max-width: 800px; margin: 0 auto;">
      ${headerHtml}
      ${summaryHtml}
      ${ragHtml}
      ${milestoneHtml}
      ${achievementsHtml}
      ${plannedHtml}
      ${mgmtHtml}
      ${changeHtml}
      ${footerHtml}
    </div>`;
}
