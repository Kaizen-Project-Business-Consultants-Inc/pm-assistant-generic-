/**
 * Renders AI report markdown to styled HTML matching the status report theme.
 * Navy headers, Calibri font, LABEL_BG tables — same palette as statusReportRenderer.ts.
 */

import { marked } from 'marked';

// Shared colour constants (same as statusReportRenderer.ts)
const NAVY = '#283480';
const LABEL_BG = '#EAECF6';
const BODY_TEXT = '#1f2937';
const FONT = "Calibri, 'Segoe UI', Arial, sans-serif";

export function renderAIReportHtml(title: string, markdown: string, reportType: string): string {
  const html = marked.parse(markdown, { async: false }) as string;

  const reportTypeLabel = reportType
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return `<div style="font-family:${FONT};color:${BODY_TEXT};max-width:900px;margin:0 auto;line-height:1.6;">
  <!-- Header -->
  <div style="background:${NAVY};color:#fff;padding:18px 24px;border-radius:6px 6px 0 0;">
    <div style="font-size:20px;font-weight:700;">${escapeHtml(title)}</div>
    <div style="font-size:12px;margin-top:4px;opacity:0.85;">${escapeHtml(reportTypeLabel)} &bull; Generated ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>
  </div>

  <!-- Body -->
  <div style="padding:24px;border:1px solid #d1d5db;border-top:none;border-radius:0 0 6px 6px;">
    <style>
      .ai-report h1 { color:${NAVY};font-size:22px;font-weight:700;margin:24px 0 12px;border-bottom:2px solid ${NAVY};padding-bottom:6px; }
      .ai-report h2 { color:${NAVY};font-size:17px;font-weight:700;margin:20px 0 10px;border-bottom:1px solid ${LABEL_BG};padding-bottom:4px; }
      .ai-report h3 { color:${NAVY};font-size:15px;font-weight:600;margin:16px 0 8px; }
      .ai-report p { margin:0 0 12px;font-size:14px; }
      .ai-report ul, .ai-report ol { margin:0 0 12px;padding-left:24px;font-size:14px; }
      .ai-report li { margin-bottom:4px; }
      .ai-report table { width:100%;border-collapse:collapse;margin:12px 0 16px;font-size:13px; }
      .ai-report th { background:${NAVY};color:#fff;padding:8px 12px;text-align:left;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.5px; }
      .ai-report td { padding:8px 12px;border-bottom:1px solid #e5e7eb; }
      .ai-report tr:nth-child(even) td { background:${LABEL_BG}; }
      .ai-report strong { color:${NAVY}; }
      .ai-report blockquote { border-left:4px solid ${NAVY};padding:8px 16px;margin:12px 0;background:${LABEL_BG};font-style:italic;font-size:14px; }
      .ai-report code { background:#f3f4f6;padding:2px 6px;border-radius:3px;font-size:13px; }
      .ai-report pre { background:#f3f4f6;padding:12px;border-radius:4px;overflow-x:auto;font-size:13px;margin:0 0 12px; }
      .ai-report hr { border:none;border-top:1px solid #d1d5db;margin:20px 0; }
    </style>
    <div class="ai-report">${html}</div>
  </div>
</div>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
