/**
 * Renders a StrategicRiskAnalysisResult to styled HTML.
 * Follows the statusReportRenderer.ts pattern (same colour scheme, inline CSS).
 */

import type { StrategicRiskAnalysisResult, StructuralRisk } from '../services/StrategicRiskAnalysisService';

// ---------------------------------------------------------------------------
// DBJ Template colours (same as statusReportRenderer)
// ---------------------------------------------------------------------------
const NAVY = '#283480';
const WHITE = '#FFFFFF';
const LABEL_BG = '#EAECF6';
const BODY_TEXT = '#1f2937';
const FONT = "Calibri, 'Segoe UI', Arial, sans-serif";

const SEVERITY_COLORS: Record<string, { bg: string; text: string }> = {
  critical: { bg: '#DC2626', text: WHITE },
  high:     { bg: '#F59E0B', text: '#1f2937' },
  medium:   { bg: '#FFD966', text: '#1f2937' },
  low:      { bg: '#A8D5A2', text: '#1f2937' },
};

const TH = `padding: 8px 10px; background: ${NAVY}; color: ${WHITE}; font-size: 11px; font-weight: 700; text-align: left; border: 1px solid ${NAVY};`;
const TD = `padding: 8px 10px; font-size: 12px; color: ${BODY_TEXT}; border: 1px solid #d1d5db; vertical-align: top;`;
const SECTION_TITLE = `color: ${NAVY}; font-size: 14px; font-weight: 700; margin: 24px 0 8px; padding: 0;`;

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function severityBadge(severity: string): string {
  const c = SEVERITY_COLORS[severity] || SEVERITY_COLORS.medium;
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase;background:${c.bg};color:${c.text};">${escapeHtml(severity)}</span>`;
}

function severityCell(severity: string): string {
  const c = SEVERITY_COLORS[severity] || SEVERITY_COLORS.medium;
  return `<td style="${TD} text-align:center;background:${c.bg};color:${c.text};font-weight:700;width:80px;">${escapeHtml(severity.toUpperCase())}</td>`;
}

const CATEGORY_LABELS: Record<string, string> = {
  schedule: 'Schedule Risks',
  resource: 'Resource Risks',
  dependency: 'Dependency Risks',
  milestone: 'Milestone Risks',
  budget: 'Budget Risks',
};

const CATEGORY_ICONS: Record<string, string> = {
  schedule: '&#128197;',   // calendar
  resource: '&#128101;',   // people
  dependency: '&#128279;', // link
  milestone: '&#127937;',  // flag
  budget: '&#128176;',     // money
};

function renderCategorySection(category: string, risks: StructuralRisk[], sectionNum: number): string {
  const label = CATEGORY_LABELS[category] || category;
  const icon = CATEGORY_ICONS[category] || '';
  const countBadge = risks.length > 0
    ? ` <span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;background:${LABEL_BG};color:${NAVY};margin-left:6px;">${risks.length}</span>`
    : '';

  if (risks.length === 0) {
    return `
      <p style="${SECTION_TITLE}">${sectionNum}. ${icon} ${escapeHtml(label)}${countBadge}</p>
      <p style="font-size:12px;color:#6b7280;font-style:italic;margin:0 0 16px;">No structural risks detected in this category.</p>
    `;
  }

  const rows = risks.map(r => `
    <tr>
      ${severityCell(r.severity)}
      <td style="${TD}">${escapeHtml(r.riskStatement)}</td>
      <td style="${TD}">${escapeHtml(r.impactedElement)}</td>
      <td style="${TD}"><ul style="margin:0;padding-left:16px;">${r.earlyWarningIndicators.map(i => `<li style="font-size:11px;margin:2px 0;">${escapeHtml(i)}</li>`).join('')}</ul></td>
      <td style="${TD}">${escapeHtml(r.suggestedMitigation)}</td>
    </tr>
  `).join('');

  return `
    <p style="${SECTION_TITLE}">${sectionNum}. ${icon} ${escapeHtml(label)}${countBadge}</p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <thead>
        <tr>
          <th style="${TH} width:80px;">Severity</th>
          <th style="${TH}">Risk Statement</th>
          <th style="${TH} width:140px;">Impacted Element</th>
          <th style="${TH} width:160px;">Early Warning Indicators</th>
          <th style="${TH} width:180px;">Suggested Mitigation</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

// ---------------------------------------------------------------------------
// Main renderer
// ---------------------------------------------------------------------------

export function renderStrategicRiskHtml(result: StrategicRiskAnalysisResult): string {
  const { projectName, scanDate, summary, categories, crossCategoryInsights } = result;
  const scanDateFmt = new Date(scanDate).toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  // --- Title banner ---
  const titleHtml = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:0;">
      <tr>
        <td style="background:${NAVY};padding:18px 20px;border-radius:6px 6px 0 0;">
          <p style="color:${WHITE};margin:0;font-size:18px;font-weight:700;letter-spacing:0.5px;">STRATEGIC RISK ANALYSIS</p>
          <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:11px;">${escapeHtml(projectName)}</p>
        </td>
      </tr>
    </table>`;

  // --- Metadata ---
  const metaHtml = `
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr>
        <td style="${TD} background:${LABEL_BG};font-weight:600;width:18%;">Scan Date</td>
        <td style="${TD} width:32%;">${escapeHtml(scanDateFmt)}</td>
        <td style="${TD} background:${LABEL_BG};font-weight:600;width:18%;">Total Risks</td>
        <td style="${TD} width:32%;">${summary.totalRisks}</td>
      </tr>
      <tr>
        <td style="${TD} background:${LABEL_BG};font-weight:600;">Analysis Mode</td>
        <td style="${TD}">${summary.aiEnhanced ? 'AI-Enhanced' : 'Algorithmic'}</td>
        <td style="${TD} background:${LABEL_BG};font-weight:600;">Severity Breakdown</td>
        <td style="${TD}">
          ${Object.entries(summary.bySeverity).map(([sev, count]) => `${severityBadge(sev)} ${count}`).join('&nbsp;&nbsp;') || '<span style="color:#6b7280;">None</span>'}
        </td>
      </tr>
    </table>`;

  // --- Category sections ---
  const categoryOrder: Array<keyof typeof categories> = ['schedule', 'resource', 'dependency', 'milestone', 'budget'];
  const categorySections = categoryOrder.map((cat, i) => renderCategorySection(cat, categories[cat], i + 1)).join('');

  // --- Cross-category insights (AI-only) ---
  let insightsHtml = '';
  if (crossCategoryInsights && crossCategoryInsights.length > 0) {
    const items = crossCategoryInsights.map(insight =>
      `<li style="font-size:12px;margin:6px 0;line-height:1.5;">${escapeHtml(insight)}</li>`
    ).join('');
    insightsHtml = `
      <p style="${SECTION_TITLE}">6. Cross-Category Insights</p>
      <ul style="margin:0 0 16px;padding-left:20px;">${items}</ul>
    `;
  }

  // --- Footer ---
  const footerHtml = `
    <table style="width:100%;border-collapse:collapse;margin-top:24px;">
      <tr>
        <td style="background:${LABEL_BG};padding:10px 16px;border-radius:0 0 6px 6px;font-size:10px;color:#6b7280;text-align:center;">
          Generated by Kovarti PM &mdash; ${summary.aiEnhanced ? 'AI-Enhanced Analysis' : 'Algorithmic Analysis'} &mdash; ${escapeHtml(scanDateFmt)}
        </td>
      </tr>
    </table>`;

  return `
    <div style="font-family:${FONT};max-width:900px;margin:0 auto;background:${WHITE};padding:0;">
      ${titleHtml}
      ${metaHtml}
      ${summary.totalRisks === 0
        ? `<p style="font-size:14px;color:#059669;font-weight:600;text-align:center;padding:40px 0;">No structural risks detected. Your project plan looks healthy.</p>`
        : `${categorySections}${insightsHtml}`
      }
      ${footerHtml}
    </div>
  `;
}
