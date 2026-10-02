/**
 * Timeline strip (2026-10-01, replaces the minimap): the whole project on one line — top-level
 * phases as bars, milestones as diamonds, today — in the style of Microsoft Project's Timeline.
 * Pure layout; GanttTimelineStrip draws it.
 */
import { toDate } from './types';

/** Rough text width in the strip's drawing units (≈ 0.55 em per character) */
export const textWidth = (text: string, fontSize: number) => text.length * fontSize * 0.55;

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

/** Months to label along the top, between start and end (first of each month) */
export function monthTicks(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const d = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  while (d <= end) { out.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
  return out;
}
