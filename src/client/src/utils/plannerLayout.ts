/**
 * Team Planner layout helpers (pure): where a block sits on the week grid, and which lane, so
 * blocks that overlap in time stack instead of covering each other. Dates are calendar days
 * ('YYYY-MM-DD') and compare as strings; weeks are the board's Mondays.
 */

/** `ymd` moved by `days` calendar days — never through the viewer's time zone */
export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Index of the week a day falls in (-1 before the first week) */
export function weekIndexOf(weeks: string[], day: string): number {
  let idx = -1;
  for (let i = 0; i < weeks.length; i++) if (weeks[i] <= day) idx = i;
  return idx;
}

/** The weeks a block covers on this board, clipped to it; null when it's off the board */
export function blockSpan(weeks: string[], start: string, end: string): { first: number; last: number } | null {
  if (weeks.length === 0) return null;
  const boardEnd = shiftYmd(weeks[weeks.length - 1], 6);
  if (end < weeks[0] || start > boardEnd) return null;
  const first = Math.max(0, weekIndexOf(weeks, start));
  const last = Math.max(first, weekIndexOf(weeks, end > boardEnd ? boardEnd : end));
  return { first, last };
}

export interface Placed<T> { block: T; first: number; last: number; lane: number }

/** Put each block in the first lane where it doesn't overlap another (by week) */
export function packLanes<T extends { startDate: string; endDate: string }>(blocks: T[], weeks: string[]): { placed: Placed<T>[]; lanes: number } {
  const laneEnds: number[] = [];
  const placed: Placed<T>[] = [];
  const spans = blocks
    .map(block => ({ block, span: blockSpan(weeks, block.startDate, block.endDate) }))
    .filter((x): x is { block: T; span: { first: number; last: number } } => !!x.span)
    .sort((a, b) => a.span.first - b.span.first || b.span.last - a.span.last);
  for (const { block, span } of spans) {
    // eslint-disable-next-line no-restricted-syntax -- small: the lanes are as many as one person's bookings that overlap at once
    let lane = laneEnds.findIndex(end => end < span.first);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(span.last); } else laneEnds[lane] = span.last;
    placed.push({ block, first: span.first, last: span.last, lane });
  }
  return { placed, lanes: laneEnds.length };
}

/** The Monday of the week `ymd` falls in */
export function mondayOfYmd(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return shiftYmd(ymd, -((dow + 6) % 7));
}

/** Where on a block the pointer grabbed it: which of its weeks (for "dropped 2 weeks later") */
export function grabbedWeek(first: number, last: number, offsetX: number, width: number): number {
  const span = last - first + 1;
  if (width <= 0) return first;
  return Math.min(last, Math.max(first, first + Math.floor((offsetX / width) * span)));
}
