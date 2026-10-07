import {
  Document, Packer, Paragraph, Table, TableRow, TextRun, WidthType, ImageRun, convertInchesToTwip,
} from 'docx';
import type { ClientReport } from '../services/ClientService';
import { headerCell, dataCell, sectionHeading } from './statusReportDocxBuilder';
import { timelineSvg } from './timelineStrip';
import { svgToPng } from './reportTimelineImage';

/**
 * The client report as Word (2026-10-07): same sections and colours as the on-screen report
 * (utils/clientReportRenderer.ts), timelines as pictures.
 */
const NAVY = '283480';
const RAG_BG: Record<string, string> = { green: 'A8D5A2', amber: 'FFD966', red: 'FF9B9B', none: 'F3F4F6' };
const RAG_TEXT: Record<string, string> = { green: 'Green', amber: 'Amber', red: 'Red', none: 'Not started' };
const money = (n: number | null) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));
const date = (d: string | null | undefined) => {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};
const label = (p: { name: string; code: string | null }) => `${p.code ? `${p.code} ` : ''}${p.name}`;
const para = (text: string, opts: { italic?: boolean; color?: string } = {}) =>
  new Paragraph({ children: [new TextRun({ text, size: 22, font: 'Calibri', italics: opts.italic, color: opts.color })], spacing: { after: 80 } });
const table = (header: string[], rows: string[][], bg?: (r: number, c: number) => string | undefined) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  rows: [
    new TableRow({ tableHeader: true, children: header.map(h => headerCell(h)) }),
    ...rows.map((row, r) => new TableRow({ children: row.map((cell, c) => dataCell(cell, { bg: bg?.(r, c) })) })),
  ],
});

export async function buildClientReportDocx(r: ClientReport): Promise<Buffer> {
  const children: (Paragraph | Table)[] = [];
  children.push(new Paragraph({ children: [new TextRun({ text: 'CLIENT STATUS REPORT', bold: true, size: 36, color: NAVY, font: 'Calibri' })] }));
  children.push(para(`${r.client.name} · ${r.projects.length} project${r.projects.length === 1 ? '' : 's'} · period ${r.period}`, { color: '6B7280' }));

  children.push(sectionHeading(1, 'SUMMARY ACROSS ALL PROJECTS'));
  children.push(para(r.summary));

  children.push(sectionHeading(2, 'PROJECTS AT A GLANCE'));
  if (r.projects.length) {
    children.push(table(['Project', 'Status', 'Next milestone', 'Spent / budget'], r.projects.map(p => [
      label(p),
      `${RAG_TEXT[p.rag]}${p.lateTasks ? ` · ${p.lateTasks} late` : ''}`,
      p.nextMilestone ? `${p.nextMilestone.name} · ${date(p.nextMilestone.date)}` : '—',
      p.budgetAllocated ? `${money(p.budgetSpent)} of ${money(p.budgetAllocated)}` : '—',
    ]), (row, col) => (col === 1 ? RAG_BG[r.projects[row].rag] : undefined)));
  } else children.push(para('No live projects for this client yet.', { italic: true }));

  const withTimeline = r.projects.filter(p => p.timeline);
  if (withTimeline.length) {
    children.push(sectionHeading(3, 'SCHEDULE TIMELINES'));
    for (const p of withTimeline) {
      const { svg, width, height } = timelineSvg(p.timeline!, r.today);
      const png = svg ? await svgToPng(svg, width) : null;
      if (!png) continue;
      children.push(new Paragraph({ children: [new TextRun({ text: label(p), bold: true, size: 20, font: 'Calibri' })], spacing: { before: 120, after: 40 } }));
      const w = 620;
      children.push(new Paragraph({ children: [new ImageRun({ type: 'png', data: png, transformation: { width: w, height: Math.round(w * height / width) }, altText: { title: 'Schedule timeline', description: `${p.name} phases and milestones`, name: 'timeline' } })] }));
    }
  }

  children.push(sectionHeading(4, 'FOR CLIENT ATTENTION'));
  if (r.attention.length) {
    children.push(table(['Project', 'Item', 'Severity', 'Owner', 'Needed by'], r.attention.map(a => [
      label({ name: a.projectName, code: a.projectCode }),
      `${a.type.charAt(0).toUpperCase() + a.type.slice(1)}${a.recordId ? ` ${a.recordId}` : ''}: ${a.title}`,
      a.severity, a.ownerName ?? '—', `${date(a.dueDate)}${a.overdue ? ' (overdue)' : ''}`,
    ])));
  } else children.push(para("Nothing needs the client's decision right now.", { italic: true }));

  children.push(sectionHeading(5, 'CHANGE REQUESTS'));
  if (r.changes.length) {
    children.push(table(['Project', 'Change', 'Status', 'Impact'], r.changes.map(c => [
      label({ name: c.projectName, code: c.projectCode }), c.title, c.status, c.impact ?? '—',
    ])));
  } else children.push(para('No open change requests.', { italic: true }));

  const doc = new Document({
    sections: [{
      properties: { page: { margin: { top: convertInchesToTwip(0.75), bottom: convertInchesToTwip(0.75), left: convertInchesToTwip(0.75), right: convertInchesToTwip(0.75) } } },
      children,
    }],
    styles: { default: { document: { run: { font: 'Calibri', size: 22, color: '1F2937' } } } },
  });
  return Buffer.from(await Packer.toBuffer(doc));
}
