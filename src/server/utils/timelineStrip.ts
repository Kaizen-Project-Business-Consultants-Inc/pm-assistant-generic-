/**
 * The schedule's Timeline strip, for status reports (2026-10-07): the whole project on one line —
 * top-level phases as bars, milestones as diamonds, today. Same layout as the Gantt's strip
 * (client components/schedule/gantt/timelineStrip.ts — layoutTimelineStrip and placeLabels are
 * copies, kept identical by __tests__/utils/timelineStripParity.test.ts), drawn here as a static
 * SVG with fixed light colours: no clicks, no dark mode, safe to put in a report.
 */

/** Calendar date 'YYYY-MM-DD' → a Date at UTC midnight (the server runs in UTC) */
export function toDate(s?: string | null): Date | null {
  if (!s) return null;
  const parts = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!parts) return null;
  const d = new Date(Date.UTC(parseInt(parts[1]), parseInt(parts[2]) - 1, parseInt(parts[3])));
  return isNaN(d.getTime()) ? null : d;
}

/** Rough text width in the strip's drawing units (≈ 0.55 em per character) */
export const textWidth = (text: string, fontSize: number) => text.length * fontSize * 0.55;

/* eslint-disable no-restricted-syntax -- placeLabels and layoutTimelineStrip must stay character-for-character the same as the client copy (a test checks), so no line comments inside them. Small: rowEnds has one entry per label row (2), laneEnds at most 3 lanes; the milestone list in the for-of is built once. */
/**
 * Place labels left to right; a label that would overlap the one before it (on its row) is left
 * for hover. Two rows. Returns the row per label, or null = hover only.
 * `row0Blocked`: spans a label on the first row must not cross — the first row sits level with
 * the diamonds, and a label ran through the next diamond (2026-10-02).
 */
export function placeLabels(
  items: { x: number; width: number; anchorEnd?: boolean }[],
  rows = 2,
  gap = 8,
  row0Blocked: { left: number; right: number }[] = [],
): (number | null)[] {
  const rowEnds = Array<number>(rows).fill(-Infinity);
  return items.map(({ x, width, anchorEnd }) => {
    const left = anchorEnd ? x - width : x;
    const right = left + width;
    const crosses = row0Blocked.some(b => left < b.right && right > b.left);
    const r = rowEnds.findIndex((e, i) => left >= e + gap && !(i === 0 && crosses));
    if (r === -1) return null;
    rowEnds[r] = left + width;
    return r;
  });
}

export interface StripTask {
  id: string;
  name: string;
  startDate?: string;
  endDate?: string;
  parentTaskId?: string | null;
  isMilestone?: boolean;
  taskType?: string;
}

export interface StripPhase { id: string; name: string; start: Date; end: Date; lane: number }
/** Milestones on the same day share one diamond ("3 milestones · 25 Feb"); names on hover */
export interface StripMilestone { id: string; names: string[]; date: Date }
export interface StripLayout {
  start: Date;
  end: Date;
  phases: StripPhase[];
  milestones: StripMilestone[];
  lanes: number;
  /** true when the plan has no top-level summary tasks: one bar for the whole project */
  noPhases: boolean;
}

const isMilestone = (t: StripTask) => !!t.isMilestone || t.taskType === 'milestone';

export function layoutTimelineStrip(tasks: StripTask[], projectName = 'Project'): StripLayout | null {
  const dated = tasks.filter(t => toDate(t.startDate) && toDate(t.endDate));
  if (dated.length === 0) return null;
  const start = new Date(Math.min(...dated.map(t => toDate(t.startDate)!.getTime())));
  const end = new Date(Math.max(...dated.map(t => toDate(t.endDate)!.getTime())));

  const ids = new Set(tasks.map(t => t.id));
  const hasChildren = new Set(tasks.filter(t => t.parentTaskId && ids.has(t.parentTaskId)).map(t => t.parentTaskId!));
  const topLevel = dated.filter(t => !(t.parentTaskId && ids.has(t.parentTaskId)));
  let phases = topLevel.filter(t => hasChildren.has(t.id))
    .map(t => ({ id: t.id, name: t.name, start: toDate(t.startDate)!, end: toDate(t.endDate)!, lane: 0 }))
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const noPhases = phases.length === 0;
  if (noPhases) phases = [{ id: '__project', name: projectName, start, end, lane: 0 }];

  // Overlapping phases go on the next lane down (greedy, at most 3 lanes)
  const laneEnds: number[] = [];
  for (const p of phases) {
    let lane = laneEnds.findIndex(e => e <= p.start.getTime());
    if (lane === -1) lane = laneEnds.length < 3 ? laneEnds.length : laneEnds.indexOf(Math.min(...laneEnds));
    laneEnds[lane] = p.end.getTime();
    p.lane = lane;
  }

  // One diamond per day; same-day milestones are grouped
  const byDay = new Map<number, StripMilestone>();
  for (const t of dated.filter(isMilestone)) {
    const date = toDate(t.endDate) ?? toDate(t.startDate)!;
    const g = byDay.get(date.getTime());
    if (g) g.names.push(t.name);
    else byDay.set(date.getTime(), { id: t.id, names: [t.name], date });
  }
  const milestones = [...byDay.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  return { start, end, phases, milestones, lanes: Math.max(1, laneEnds.length), noPhases };
}
/* eslint-enable no-restricted-syntax */

// ---------------------------------------------------------------------------
// The strip as it travels inside a stored status report (dates as 'YYYY-MM-DD')
// ---------------------------------------------------------------------------

export interface ReportTimeline {
  start: string;
  end: string;
  phases: { name: string; start: string; end: string; lane: number }[];
  milestones: { names: string[]; date: string }[];
  lanes: number;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/** The plan's tasks → the small timeline a report keeps (null if nothing is dated) */
export function reportTimeline(tasks: StripTask[], projectName: string): ReportTimeline | null {
  const layout = layoutTimelineStrip(tasks, projectName);
  if (!layout) return null;
  return {
    start: ymd(layout.start),
    end: ymd(layout.end),
    phases: layout.phases.map(p => ({ name: p.name, start: ymd(p.start), end: ymd(p.end), lane: p.lane })),
    milestones: layout.milestones.map(m => ({ names: m.names, date: ymd(m.date) })),
    lanes: layout.lanes,
  };
}

// ---------------------------------------------------------------------------
// Static SVG
// ---------------------------------------------------------------------------

const W = 1000;
const PAD = 12;
const LANE_H = 20;
const PHASE_COLORS = ['#64748b', '#0d9488', '#7c3aed', '#d97706', '#2563eb', '#db2777'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmt = (d: Date, withYear = false) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''}`;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Months to label along the top, between start and end (first of each month, UTC) */
function monthTicks(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  while (d <= end) { out.push(new Date(d)); d.setUTCMonth(d.getUTCMonth() + 1); }
  return out;
}

/**
 * The timeline as a self-contained SVG string (fixed light colours, no scripts, no ids that could
 * clash): for the on-screen report, its PDF/HTML downloads, and — as a PNG — email and Word.
 * `today` is a 'YYYY-MM-DD' calendar date (the project's status date or today).
 */
export function timelineSvg(t: ReportTimeline, today?: string | null): { svg: string; width: number; height: number } {
  const start = toDate(t.start);
  const end = toDate(t.end);
  // a report posted back for re-rendering could carry anything: no dates, no strip
  if (!start || !end || !Array.isArray(t.phases) || !Array.isArray(t.milestones)) return { svg: '', width: W, height: 0 };
  const lanes = Math.min(3, Math.max(1, Number(t.lanes) || 1));
  const span = Math.max(1, end.getTime() - start.getTime());
  const x = (d: Date) => PAD + ((d.getTime() - start.getTime()) / span) * (W - 2 * PAD);
  const phasesTop = 22;
  const msTop = phasesTop + lanes * (LANE_H + 4) + 4;
  const H = msTop + 42;
  const parts: string[] = [];

  parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`);
  parts.push(`<text x="${PAD}" y="11" font-size="10" fill="#6b7280">${fmt(start)}</text>`);
  parts.push(`<text x="${W - PAD}" y="11" font-size="10" text-anchor="end" fill="#6b7280">${fmt(end, true)}</text>`);
  const ticks = monthTicks(start, end).filter(m => x(m) > PAD + 50 && x(m) < W - PAD - 90);
  for (const m of ticks) {
    parts.push(`<line x1="${x(m)}" x2="${x(m)}" y1="14" y2="${H}" stroke="#e5e7eb" stroke-width="1"/>`);
    parts.push(`<text x="${x(m) + 3}" y="11" font-size="10" fill="#6b7280">${MONTHS[m.getUTCMonth()]}${m.getUTCMonth() === 0 ? ` ${m.getUTCFullYear()}` : ''}</text>`);
  }

  t.phases.forEach((p, i) => {
    const ps = toDate(p.start); const pe = toDate(p.end);
    if (!ps || !pe) return;
    const px1 = x(ps);
    const pw = Math.max(4, x(pe) - px1);
    const y = phasesTop + Math.min(lanes - 1, Math.max(0, Number(p.lane) || 0)) * (LANE_H + 4);
    const name = String(p.name ?? '');
    parts.push(`<rect x="${px1}" y="${y}" width="${pw}" height="${LANE_H}" rx="4" fill="${PHASE_COLORS[i % PHASE_COLORS.length]}"><title>${esc(`${name}: ${fmt(ps, true)} – ${fmt(pe, true)}`)}</title></rect>`);
    const full = `${name} · ${fmt(ps)} – ${fmt(pe)}`;
    const label = textWidth(full, 11) < pw - 12 ? full : textWidth(name, 11) < pw - 8 ? name : '';
    if (label) parts.push(`<text x="${px1 + 6}" y="${y + 14}" font-size="11" font-weight="600" fill="#ffffff">${esc(label)}</text>`);
  });

  const labels = t.milestones.filter(m => toDate(m.date) && Array.isArray(m.names) && m.names.length).map(m => {
    const d = toDate(m.date)!;
    m = { ...m, names: m.names.map(n => String(n)) };
    const text = m.names.length > 1 ? `${m.names.length} milestones · ${fmt(d)}` : `${m.names[0].length > 28 ? `${m.names[0].slice(0, 27)}…` : m.names[0]} · ${fmt(d)}`;
    const mx = x(d);
    return { m, d, mx, text, anchorEnd: mx > W - 160, width: textWidth(text, 10.5) };
  });
  const rows = placeLabels(
    labels.map(l => ({ x: l.anchorEnd ? l.mx - 9 : l.mx + 9, width: l.width, anchorEnd: l.anchorEnd })),
    2, 8,
    labels.map(l => ({ left: l.mx - 8, right: l.mx + 8 })),
  );
  labels.forEach(({ m, d, mx, text, anchorEnd }, i) => {
    parts.push(`<path d="M${mx} ${msTop} l6 6 -6 6 -6 -6z" fill="#2563eb"><title>${esc(`${fmt(d, true)}: ${m.names.join(', ')}`)}</title></path>`);
    if (rows[i] !== null) {
      parts.push(`<text x="${anchorEnd ? mx - 9 : mx + 9}" y="${msTop + 10 + (rows[i] as number) * 15}" font-size="10.5" text-anchor="${anchorEnd ? 'end' : 'start'}" fill="#1f2937">${esc(text)}</text>`);
    }
  });

  const td = toDate(today ?? null);
  if (td && td >= start && td <= end) {
    parts.push(`<line x1="${x(td)}" x2="${x(td)}" y1="14" y2="${H}" stroke="#dc2626" stroke-width="2"><title>Today</title></line>`);
  }

  const label = `Project timeline from ${fmt(start, true)} to ${fmt(end, true)}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)}" font-family="Arial, Helvetica, sans-serif">${parts.join('')}</svg>`;
  return { svg, width: W, height: H };
}
