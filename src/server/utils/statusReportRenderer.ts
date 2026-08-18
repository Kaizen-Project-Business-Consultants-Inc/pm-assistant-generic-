/**
 * Renders a structured status report to styled HTML for UI and email.
 * Matches DBJ_LMS_Status_Report.docx template exactly.
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
// DBJ Template colours
// ---------------------------------------------------------------------------
const NAVY = '#283480';
const LABEL_BG = '#EAECF6';
const GREEN_BG = '#C6EFCE';
const AMBER_BG = '#FFEB9C';
const RED_BG = '#FFC7CE';
const WHITE = '#FFFFFF';
const BODY_TEXT = '#1f2937';
const FONT = "Calibri, 'Segoe UI', Arial, sans-serif";

const RAG_CELL: Record<string, { bg: string; letter: string }> = {
  green: { bg: GREEN_BG, letter: 'G' },
  amber: { bg: AMBER_BG, letter: 'A' },
  red:   { bg: RED_BG,   letter: 'R' },
};

const TREND_ARROWS: Record<string, string> = {
  improving: '\u2191',
  stable: '\u2192',
  declining: '\u2193',
};

// Shared cell styles
const TH = `padding: 8px 10px; background: ${NAVY}; color: ${WHITE}; font-size: 11px; font-weight: 700; text-align: left; border: 1px solid ${NAVY};`;
const TD = `padding: 8px 10px; font-size: 12px; color: ${BODY_TEXT}; border: 1px solid #d1d5db; vertical-align: top;`;
const SECTION_TITLE = `color: ${NAVY}; font-size: 14px; font-weight: 700; margin: 24px 0 8px; padding: 0;`;

function sectionHeading(num: number, title: string): string {
  return `<p style="${SECTION_TITLE}">${num}. ${escapeHtml(title)}</p>`;
}

function ragCell(status: string): string {
  const rag = RAG_CELL[status] || RAG_CELL.amber;
  return `<td style="${TD} text-align: center; background: ${rag.bg}; font-weight: 700; width: 70px;">${rag.letter}</td>`;
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

  // --- Title banner ---
  const titleHtml = `
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 0;">
      <tr>
        <td style="background: ${NAVY}; padding: 18px 20px; border-radius: 6px 6px 0 0;">
          <p style="color: ${WHITE}; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: 0.5px;">PROJECT STATUS REPORT</p>
          <p style="color: rgba(255,255,255,0.85); margin: 4px 0 0; font-size: 11px;">${escapeHtml(projectName)}</p>
        </td>
      </tr>
    </table>`;

  // --- Metadata grid (4 rows × 4 cols) ---
  const metaRow = (label1: string, val1: string, label2: string, val2: string) => `
    <tr>
      <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 18%;">${escapeHtml(label1)}</td>
      <td style="${TD} width: 32%;">${escapeHtml(val1)}</td>
      <td style="${TD} background: ${LABEL_BG}; font-weight: 600; width: 18%;">${escapeHtml(label2)}</td>
      <td style="${TD} width: 32%;">${escapeHtml(val2)}</td>
    </tr>`;

  const metadataHtml = `
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 16px;">
      ${metaRow('Report No.', reportNumber, 'Reporting Period', reportingPeriod)}
      ${metaRow('Date Issued', reportDate, 'Prepared By', preparedBy)}
    </table>`;

  // --- 1. Executive Summary ---
  const summaryHtml = `
    ${sectionHeading(1, 'EXECUTIVE SUMMARY')}
    <p style="font-size: 13px; color: ${BODY_TEXT}; line-height: 1.65; margin: 0 0 8px;">${escapeHtml(executiveSummary)}</p>`;

  // --- 2. Overall Status (RAG Table) ---
  const ragRows = areas.map(area => {
    const trend = area.trend || 'stable';
    const trendArrow = TREND_ARROWS[trend];
    const isOverall = area.name === 'Overall Status';
    const nameBg = isOverall ? ` background: ${LABEL_BG}; font-weight: 700;` : '';
    const prevCell = area.previousStatus ? ragCell(area.previousStatus) : `<td style="${TD} text-align: center;">—</td>`;

    return `
      <tr>
        <td style="${TD}${nameBg}">${escapeHtml(area.name)}</td>
        ${ragCell(area.status)}
        ${prevCell}
        <td style="${TD} text-align: center; font-weight: 600;">${trendArrow}</td>
        <td style="${TD} font-size: 12px;">${escapeHtml(area.comments)}</td>
      </tr>`;
  }).join('');

  const ragLegend = `
    <table style="width: auto; border-collapse: collapse; margin-top: 6px;">
      <tr>
        <td style="padding: 4px 10px; background: ${GREEN_BG}; font-weight: 700; font-size: 11px; border: 1px solid #d1d5db;">G</td>
        <td style="padding: 4px 10px; font-size: 11px; border: 1px solid #d1d5db;">On track — no intervention required</td>
        <td style="padding: 4px 10px; background: ${AMBER_BG}; font-weight: 700; font-size: 11px; border: 1px solid #d1d5db;">A</td>
        <td style="padding: 4px 10px; font-size: 11px; border: 1px solid #d1d5db;">At risk — recoverable within the team</td>
        <td style="padding: 4px 10px; background: ${RED_BG}; font-weight: 700; font-size: 11px; border: 1px solid #d1d5db;">R</td>
        <td style="padding: 4px 10px; font-size: 11px; border: 1px solid #d1d5db;">Off track — management action needed</td>
      </tr>
    </table>`;

  const ragHtml = `
    ${sectionHeading(2, 'OVERALL STATUS')}
    <table style="width: 100%; border-collapse: collapse;">
      <thead>
        <tr>
          <th style="${TH}">Dimension</th>
          <th style="${TH} text-align: center; width: 70px;">This Period</th>
          <th style="${TH} text-align: center; width: 70px;">Last Period</th>
          <th style="${TH} text-align: center; width: 50px;">Trend</th>
          <th style="${TH}">Commentary</th>
        </tr>
      </thead>
      <tbody>${ragRows}</tbody>
    </table>
    ${ragLegend}`;

  // --- 3. Milestone Status ---
  let milestoneHtml = '';
  if (milestones.length > 0) {
    const milestoneRows = milestones.map(m => `
      <tr>
        <td style="${TD} text-align: center; width: 40px;">${escapeHtml(m.ref)}</td>
        <td style="${TD}">${escapeHtml(m.name)}</td>
        <td style="${TD} width: 90px;">${escapeHtml(m.dueDate)}</td>
        <td style="${TD} width: 100px;">${escapeHtml(m.status)}</td>
        <td style="${TD}">${escapeHtml(m.comments)}</td>
      </tr>`).join('');

    milestoneHtml = `
      ${sectionHeading(3, 'MILESTONE STATUS')}
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="${TH} text-align: center; width: 40px;">M#</th>
            <th style="${TH}">Milestone Deliverable</th>
            <th style="${TH} width: 90px;">Due Date</th>
            <th style="${TH} width: 100px;">Status</th>
            <th style="${TH}">Comments</th>
          </tr>
        </thead>
        <tbody>${milestoneRows}</tbody>
      </table>`;
  }

  // --- 5. Achievements This Period (numbering matches template — no section 4) ---
  let achievementsHtml = '';
  if (achievements.length > 0) {
    const items = achievements.map(a =>
      `<li style="color: ${BODY_TEXT}; margin: 3px 0; line-height: 1.5; font-size: 12px;">${escapeHtml(a)}</li>`
    ).join('');
    achievementsHtml = `
      ${sectionHeading(5, 'ACHIEVEMENTS THIS PERIOD')}
      <ul style="margin: 0; padding-left: 20px;">${items}</ul>`;
  }

  // --- 6. Planned Activities — Next Period ---
  let plannedHtml = '';
  if (plannedActivities.length > 0) {
    const items = plannedActivities.map(a =>
      `<li style="color: ${BODY_TEXT}; margin: 3px 0; line-height: 1.5; font-size: 12px;">${escapeHtml(a)}</li>`
    ).join('');
    plannedHtml = `
      ${sectionHeading(6, 'PLANNED ACTIVITIES \u2014 NEXT PERIOD')}
      <ul style="margin: 0; padding-left: 20px;">${items}</ul>`;
  }

  // --- 7. For Management Attention ---
  let mgmtHtml = '';
  if (managementAttention.length > 0) {
    const mgmtRows = managementAttention.map(item => `
      <tr>
        <td style="${TD} width: 55px;">${escapeHtml(item.ref)}</td>
        <td style="${TD}">${escapeHtml(item.matter)}</td>
        <td style="${TD} width: 75px;">${escapeHtml(item.raised)}</td>
        <td style="${TD} width: 90px;">${escapeHtml(item.owner)}</td>
        <td style="${TD} width: 75px;">${escapeHtml(item.dateNeeded)}</td>
        <td style="${TD}">${escapeHtml(item.impactIfDelayed)}</td>
      </tr>`).join('');

    mgmtHtml = `
      ${sectionHeading(7, 'FOR MANAGEMENT ATTENTION')}
      <p style="font-size: 12px; color: #6b7280; margin: 0 0 8px;">Matters requiring a management decision or intervention. Each carries a named owner, a date needed, and the stated consequence of delay.</p>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="${TH} width: 55px;">Ref</th>
            <th style="${TH}">Matter Requiring Attention</th>
            <th style="${TH} width: 75px;">Raised</th>
            <th style="${TH} width: 90px;">Owner</th>
            <th style="${TH} width: 75px;">Date Needed</th>
            <th style="${TH}">Impact if Delayed</th>
          </tr>
        </thead>
        <tbody>${mgmtRows}</tbody>
      </table>`;
  }

  // --- 8. Change Control ---
  let changeHtml = '';
  if (changeControl.length > 0) {
    const changeRows = changeControl.map(cr => `
      <tr>
        <td style="${TD} width: 65px;">${escapeHtml(cr.ref)}</td>
        <td style="${TD}">${escapeHtml(cr.description)}</td>
        <td style="${TD} width: 100px;">${escapeHtml(cr.status)}</td>
        <td style="${TD} width: 85px;">${escapeHtml(cr.scheduleImpact)}</td>
        <td style="${TD} width: 85px;">${escapeHtml(cr.costImpact)}</td>
      </tr>`).join('');

    changeHtml = `
      ${sectionHeading(8, 'CHANGE CONTROL')}
      <p style="font-size: 12px; color: #6b7280; margin: 0 0 8px;">Requests that alter scope, schedule, or cost.</p>
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th style="${TH} width: 65px;">CR Ref</th>
            <th style="${TH}">Description</th>
            <th style="${TH} width: 100px;">Status</th>
            <th style="${TH} width: 85px;">Schedule Impact</th>
            <th style="${TH} width: 85px;">Cost Impact</th>
          </tr>
        </thead>
        <tbody>${changeRows}</tbody>
      </table>`;
  }

  // --- Footer ---
  const footerHtml = `
    <p style="color: #9ca3af; font-size: 10px; text-align: center; margin-top: 20px;">
      ${aiPowered ? 'AI-Generated Report' : 'Template Report (AI unavailable)'} — Kovarti PM Assistant
    </p>`;

  return `
    <div style="font-family: ${FONT}; max-width: 800px; margin: 0 auto; color: ${BODY_TEXT};">
      ${titleHtml}
      ${metadataHtml}
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
