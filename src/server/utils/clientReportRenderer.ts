import type { ClientReport } from '../services/ClientService';
import { timelineSvg } from './timelineStrip';
import { TIMELINE_START, TIMELINE_END } from './reportTimelineImage';

/**
 * The client report (2026-10-07) as email-safe, inline-styled HTML — the same look as the project
 * status report (DBJ template colours). One report across all of a client's projects: summary,
 * projects at a glance, a timeline per project, what needs the client's decision, change requests.
 * Each timeline SVG sits between markers so email swaps it for a picture.
 */
const NAVY = '#283480';
const LABEL_BG = '#eaecf6';
const RAG_BG: Record<string, string> = { green: '#A8D5A2', amber: '#FFD966', red: '#FF9B9B', none: '#f3f4f6' };
const RAG_TEXT: Record<string, string> = { green: 'Green', amber: 'Amber', red: 'Red', none: 'Not started' };
const FONT = "Calibri, 'Segoe UI', Arial, sans-serif";
const TH = `padding: 7px 8px; border: 1px solid #c7cbe0; background: ${LABEL_BG}; text-align: left; font-size: 12px;`;
const TD = 'padding: 7px 8px; border: 1px solid #e5e7eb; font-size: 12px; vertical-align: top;';
const H = `color: ${NAVY}; font-size: 14px; font-weight: 700; margin: 22px 0 8px;`;

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money = (n: number | null) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const date = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const label = (p: { name: string; code: string | null }) => `${p.code ? `${esc(p.code)} ` : ''}${esc(p.name)}`;

export function renderClientReportHtml(r: ClientReport): string {
  const title = `
    <table style="width: 100%; border-collapse: collapse;"><tr>
      <td style="background: ${NAVY}; padding: 18px 20px; border-radius: 6px 6px 0 0;">
        <p style="color: #ffffff; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: 0.5px;">CLIENT STATUS REPORT</p>
        <p style="color: rgba(255,255,255,0.9); margin: 4px 0 0; font-size: 12px;">${esc(r.client.name)} · ${r.projects.length} project${r.projects.length === 1 ? '' : 's'} · period ${esc(r.period)}</p>
      </td></tr></table>`;

  const summary = `<p style="${H}">1. SUMMARY ACROSS ALL PROJECTS</p>
    <p style="margin: 0; font-size: 13px; line-height: 1.5;">${esc(r.summary)}</p>`;

  const rows = r.projects.map(p => `
    <tr>
      <td style="${TD}">${label(p)}</td>
      <td style="${TD} background: ${RAG_BG[p.rag]};">${RAG_TEXT[p.rag]}${p.lateTasks ? ` · ${p.lateTasks} late task${p.lateTasks === 1 ? '' : 's'}` : ''}</td>
      <td style="${TD}">${p.nextMilestone ? `${esc(p.nextMilestone.name)} · ${date(p.nextMilestone.date)}` : '—'}</td>
      <td style="${TD}">${p.budgetAllocated ? `${money(p.budgetSpent)} of ${money(p.budgetAllocated)}` : '—'}</td>
    </tr>`).join('');
  const glance = `<p style="${H}">2. PROJECTS AT A GLANCE</p>
    ${r.projects.length ? `<table style="width: 100%; border-collapse: collapse;">
      <thead><tr><th style="${TH}">Project</th><th style="${TH}">Status</th><th style="${TH}">Next milestone</th><th style="${TH}">Spent / budget</th></tr></thead>
      <tbody>${rows}</tbody></table>`
      : '<p style="margin: 0; font-size: 13px; color: #6b7280;">No live projects for this client yet.</p>'}`;

  const withTimeline = r.projects.filter(p => p.timeline);
  const timelines = withTimeline.length ? `<p style="${H}">3. SCHEDULE TIMELINES</p>
    ${withTimeline.map(p => {
      const svg = timelineSvg(p.timeline!, r.today).svg;
      return svg ? `<p style="margin: 10px 0 4px; font-size: 12px; font-weight: 600; color: #374151;">${label(p)}</p>
        <div style="border: 1px solid #e5e7eb; border-radius: 4px; padding: 6px 8px; background: #ffffff;">${TIMELINE_START}${svg}${TIMELINE_END}</div>` : '';
    }).join('')}` : '';

  const attention = `<p style="${H}">4. FOR CLIENT ATTENTION</p>
    ${r.attention.length ? `<table style="width: 100%; border-collapse: collapse;">
      <thead><tr><th style="${TH}">Project</th><th style="${TH}">Item</th><th style="${TH}">Severity</th><th style="${TH}">Owner</th><th style="${TH}">Needed by</th></tr></thead>
      <tbody>${r.attention.map(a => `<tr>
        <td style="${TD}">${label({ name: a.projectName, code: a.projectCode })}</td>
        <td style="${TD}">${esc(a.type.charAt(0).toUpperCase() + a.type.slice(1))}${a.recordId ? ` ${esc(a.recordId)}` : ''}: ${esc(a.title)}</td>
        <td style="${TD}">${esc(a.severity)}</td>
        <td style="${TD}">${esc(a.ownerName ?? '—')}</td>
        <td style="${TD}${a.overdue ? ' color: #b91c1c; font-weight: 600;' : ''}">${date(a.dueDate)}${a.overdue ? ' (overdue)' : ''}</td>
      </tr>`).join('')}</tbody></table>`
      : '<p style="margin: 0; font-size: 13px; color: #6b7280;">Nothing needs the client\'s decision right now.</p>'}`;

  const changes = `<p style="${H}">5. CHANGE REQUESTS</p>
    ${r.changes.length ? `<table style="width: 100%; border-collapse: collapse;">
      <thead><tr><th style="${TH}">Project</th><th style="${TH}">Change</th><th style="${TH}">Status</th><th style="${TH}">Impact</th></tr></thead>
      <tbody>${r.changes.map(c => `<tr>
        <td style="${TD}">${label({ name: c.projectName, code: c.projectCode })}</td>
        <td style="${TD}">${esc(c.title)}</td><td style="${TD}">${esc(c.status)}</td><td style="${TD}">${esc(c.impact ?? '—')}</td>
      </tr>`).join('')}</tbody></table>`
      : '<p style="margin: 0; font-size: 13px; color: #6b7280;">No open change requests.</p>'}`;

  return `
    <div style="font-family: ${FONT}; max-width: 800px; margin: 0 auto; color: #111827;">
      ${title}
      <div style="padding: 4px 4px 0;">${summary}${glance}${timelines}${attention}${changes}</div>
      <p style="color: #9ca3af; font-size: 10px; text-align: center; margin-top: 20px;">Kovarti PM Assistant</p>
    </div>`;
}
