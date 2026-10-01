/**
 * Timeline strip (2026-10-01, replaces the minimap): the whole project on one line — top-level
 * phases as bars, milestones as diamonds, today — in the style of Microsoft Project's Timeline.
 * Pure layout; GanttTimelineStrip draws it.
 */
import { toDate, DAY_MS } from './types';

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
export interface StripMilestone { id: string; name: string; date: Date; labelRow: number }
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

  // Milestone labels alternate rows when two are close, so names don't sit on top of each other
  const span = Math.max(DAY_MS, end.getTime() - start.getTime());
  const milestones: StripMilestone[] = [];
  let lastX = -Infinity;
  let row = 0;
  for (const t of dated.filter(isMilestone).sort((a, b) => toDate(a.startDate)!.getTime() - toDate(b.startDate)!.getTime())) {
    const date = toDate(t.endDate) ?? toDate(t.startDate)!;
    const x = (date.getTime() - start.getTime()) / span;
    row = x - lastX < 0.12 ? (row + 1) % 2 : 0;
    lastX = x;
    milestones.push({ id: t.id, name: t.name, date, labelRow: row });
  }
  return { start, end, phases, milestones, lanes: Math.max(1, laneEnds.length), noPhases };
}

/** Months to label along the top, between start and end (first of each month) */
export function monthTicks(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  const d = new Date(start.getFullYear(), start.getMonth() + 1, 1);
  while (d <= end) { out.push(new Date(d)); d.setMonth(d.getMonth() + 1); }
  return out;
}
