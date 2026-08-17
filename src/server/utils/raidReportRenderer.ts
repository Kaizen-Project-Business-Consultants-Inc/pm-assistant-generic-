/**
 * Renders a RAID report to styled, email-compatible HTML.
 */

export interface RAIDReportItem {
  recordId: string;
  type: 'risk' | 'issue' | 'action' | 'decision';
  title: string;
  severity: string;
  status: string;
  ownerName: string;
  dueDate: string | null;
  daysOpen: number;
  mitigationPlan: string | null;
  category: string;
}

export interface RAIDReportFilters {
  types?: string[];
  severities?: string[];
  owners?: string[];
  categories?: string[];
}

export interface SeverityBreakdown {
  critical: number;
  high: number;
  medium: number;
  low: number;
}

export interface RAIDReportData {
  projectName: string;
  reportDate: string;
  items: RAIDReportItem[];
  summary: {
    openRisks: SeverityBreakdown;
    openIssues: SeverityBreakdown;
    openActions: SeverityBreakdown;
    pendingDecisions: SeverityBreakdown;
  };
  overdueActions: RAIDReportItem[];
  criticalMitigations: RAIDReportItem[];
  filtersApplied: string | null;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  critical: { bg: '#fecaca', text: '#991b1b' },
  high: { bg: '#fed7aa', text: '#9a3412' },
  medium: { bg: '#fef3c7', text: '#92400e' },
  low: { bg: '#dcfce7', text: '#166534' },
};

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  risk: { bg: '#fecaca', text: '#991b1b' },
  issue: { bg: '#fed7aa', text: '#9a3412' },
  action: { bg: '#dbeafe', text: '#1e40af' },
  decision: { bg: '#e9d5ff', text: '#6b21a8' },
};

function severityBadge(severity: string): string {
  const c = SEVERITY_COLORS[severity] || SEVERITY_COLORS.medium;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;background:${c.bg};color:${c.text};text-transform:capitalize;">${escapeHtml(severity)}</span>`;
}

function typeBadge(type: string): string {
  const c = TYPE_COLORS[type] || TYPE_COLORS.risk;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;background:${c.bg};color:${c.text};text-transform:capitalize;">${escapeHtml(type)}</span>`;
}

function summaryCard(label: string, breakdown: SeverityBreakdown, color: string): string {
  const total = breakdown.critical + breakdown.high + breakdown.medium + breakdown.low;
  const details: string[] = [];
  if (breakdown.critical > 0) details.push(`<span style="color:#991b1b;font-weight:600;">${breakdown.critical} critical</span>`);
  if (breakdown.high > 0) details.push(`<span style="color:#9a3412;font-weight:600;">${breakdown.high} high</span>`);
  if (breakdown.medium > 0) details.push(`<span style="color:#92400e;">${breakdown.medium} med</span>`);
  if (breakdown.low > 0) details.push(`<span style="color:#166534;">${breakdown.low} low</span>`);

  return `
    <td style="width:25%;padding:12px;text-align:center;border:1px solid #e5e7eb;border-radius:8px;">
      <div style="font-size:28px;font-weight:700;color:${color};">${total}</div>
      <div style="font-size:12px;font-weight:600;color:#374151;margin-top:2px;">${escapeHtml(label)}</div>
      <div style="font-size:10px;color:#6b7280;margin-top:4px;">${details.length ? details.join(' &middot; ') : 'None'}</div>
    </td>`;
}

export function renderRAIDReportHtml(data: RAIDReportData): string {
  const { projectName, reportDate, items, summary, overdueActions, criticalMitigations, filtersApplied } = data;

  // Summary dashboard
  const summaryRow = `
    <table style="width:100%;border-collapse:separate;border-spacing:8px;margin:0 -8px;">
      <tr>
        ${summaryCard('Open Risks', summary.openRisks, '#dc2626')}
        ${summaryCard('Open Issues', summary.openIssues, '#ea580c')}
        ${summaryCard('Open Actions', summary.openActions, '#2563eb')}
        ${summaryCard('Pending Decisions', summary.pendingDecisions, '#7c3aed')}
      </tr>
    </table>`;

  // Items table
  const headerStyle = 'padding:8px 10px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#64748b;border-bottom:2px solid #e2e8f0;';
  const cellStyle = 'padding:8px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#1f2937;';

  const tableRows = items.map(item => {
    const dueDateStr = item.dueDate
      ? new Date(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    const isOverdue = item.type === 'action' && item.dueDate && new Date(item.dueDate) < new Date() && !['completed', 'closed'].includes(item.status);

    return `
      <tr${isOverdue ? ' style="background:#fef2f2;"' : ''}>
        <td style="${cellStyle}font-weight:600;color:#6366f1;white-space:nowrap;">${escapeHtml(item.recordId)}</td>
        <td style="${cellStyle}">${typeBadge(item.type)}</td>
        <td style="${cellStyle}max-width:200px;">${escapeHtml(item.title)}</td>
        <td style="${cellStyle}">${severityBadge(item.severity)}</td>
        <td style="${cellStyle}">${escapeHtml(item.ownerName)}</td>
        <td style="${cellStyle}white-space:nowrap;">${dueDateStr}</td>
        <td style="${cellStyle}text-transform:capitalize;">${escapeHtml(item.status.replace(/_/g, ' '))}</td>
        <td style="${cellStyle}text-align:right;">${item.daysOpen}d</td>
      </tr>`;
  }).join('');

  // Overdue actions section
  let overdueSection = '';
  if (overdueActions.length > 0) {
    const overdueRows = overdueActions.map(item => {
      const dueDateStr = item.dueDate
        ? new Date(item.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        : '—';
      return `
        <tr>
          <td style="${cellStyle}font-weight:600;color:#dc2626;">${escapeHtml(item.recordId)}</td>
          <td style="${cellStyle}">${escapeHtml(item.title)}</td>
          <td style="${cellStyle}">${escapeHtml(item.ownerName)}</td>
          <td style="${cellStyle}white-space:nowrap;color:#dc2626;font-weight:600;">${dueDateStr}</td>
          <td style="${cellStyle}text-align:right;color:#dc2626;font-weight:600;">${item.daysOpen}d overdue</td>
        </tr>`;
    }).join('');

    overdueSection = `
      <div style="margin-top:20px;border:2px solid #fca5a5;border-radius:8px;overflow:hidden;">
        <div style="background:#fef2f2;padding:12px 16px;border-bottom:1px solid #fca5a5;">
          <h2 style="color:#991b1b;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;margin:0;">Overdue Actions (${overdueActions.length})</h2>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#fef2f2;">
            <th style="${headerStyle}">ID</th>
            <th style="${headerStyle}">Title</th>
            <th style="${headerStyle}">Owner</th>
            <th style="${headerStyle}">Due Date</th>
            <th style="${headerStyle}text-align:right;">Overdue</th>
          </tr></thead>
          <tbody>${overdueRows}</tbody>
        </table>
      </div>`;
  }

  // Key mitigations section
  let mitigationsSection = '';
  if (criticalMitigations.length > 0) {
    const mitigationRows = criticalMitigations.map(item => `
      <tr>
        <td style="${cellStyle}font-weight:600;color:#6366f1;white-space:nowrap;vertical-align:top;">${escapeHtml(item.recordId)}</td>
        <td style="${cellStyle}vertical-align:top;">${escapeHtml(item.title)}</td>
        <td style="${cellStyle}">${severityBadge(item.severity)}</td>
        <td style="${cellStyle}font-size:11px;color:#4b5563;vertical-align:top;">${escapeHtml(item.mitigationPlan || 'No mitigation plan documented')}</td>
      </tr>`).join('');

    mitigationsSection = `
      <div style="margin-top:20px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
        <div style="background:#f8fafc;padding:12px 16px;border-bottom:1px solid #e5e7eb;">
          <h2 style="color:#1f2937;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;margin:0;">Key Mitigations — Critical &amp; High Risks</h2>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#f1f5f9;">
            <th style="${headerStyle}">ID</th>
            <th style="${headerStyle}">Risk</th>
            <th style="${headerStyle}">Severity</th>
            <th style="${headerStyle}">Mitigation Plan</th>
          </tr></thead>
          <tbody>${mitigationRows}</tbody>
        </table>
      </div>`;
  }

  const filtersNote = filtersApplied
    ? `<p style="color:#6b7280;font-size:11px;margin:8px 0 0;font-style:italic;">Filters: ${escapeHtml(filtersApplied)}</p>`
    : '';

  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:750px;margin:0 auto;">
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:20px 24px;border-radius:12px 12px 0 0;">
        <h1 style="color:white;margin:0;font-size:18px;font-weight:700;">RAID Report</h1>
        <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px;">${escapeHtml(projectName)} — ${escapeHtml(reportDate)}</p>
      </div>

      <!-- Summary Dashboard -->
      <div style="background:#f8fafc;padding:16px 24px;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
        <h2 style="color:#1f2937;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;margin:0 0 8px;">Summary</h2>
        ${summaryRow}
        ${filtersNote}
      </div>

      <!-- All Open Items Table -->
      <div style="padding:0;border-left:1px solid #e5e7eb;border-right:1px solid #e5e7eb;">
        <div style="padding:12px 24px;background:#f8fafc;border-top:1px solid #e5e7eb;">
          <h2 style="color:#1f2937;font-size:14px;text-transform:uppercase;letter-spacing:0.05em;margin:0;">All Items (${items.length})</h2>
        </div>
        ${items.length > 0 ? `
        <table style="width:100%;border-collapse:collapse;">
          <thead><tr style="background:#f1f5f9;">
            <th style="${headerStyle}">ID</th>
            <th style="${headerStyle}">Type</th>
            <th style="${headerStyle}">Title</th>
            <th style="${headerStyle}">Severity</th>
            <th style="${headerStyle}">Owner</th>
            <th style="${headerStyle}">Due Date</th>
            <th style="${headerStyle}">Status</th>
            <th style="${headerStyle}text-align:right;">Days Open</th>
          </tr></thead>
          <tbody>${tableRows}</tbody>
        </table>` : `
        <div style="padding:24px;text-align:center;color:#9ca3af;font-size:13px;">No items match the selected filters.</div>`}
      </div>

      ${overdueSection}
      ${mitigationsSection}

      <!-- Footer -->
      <div style="padding:16px 24px;border:1px solid #e5e7eb;border-top:2px solid #e5e7eb;border-radius:0 0 12px 12px;background:#f8fafc;">
        <p style="color:#9ca3af;font-size:11px;text-align:center;margin:0;">
          Generated ${escapeHtml(new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' }))} — Kovarti PM Assistant
        </p>
      </div>
    </div>`;
}
