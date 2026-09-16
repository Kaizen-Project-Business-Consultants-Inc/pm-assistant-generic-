/**
 * Small pure heuristics for schedule imports: filtering legend/artefact rows,
 * cleaning spreadsheet cell references out of assignee names, and deciding
 * whether a "duration" column holds hours or days. No DB/service access, so
 * each function is unit-testable in isolation.
 */

/** Lone label/status words that mark a legend or artefact row, not a real task. */
const LABEL_WORDS = new Set([
  'completed', 'complete', 'done', 'in progress', 'in-progress', 'not started',
  'legend', 'key', 'notes', 'note', 'tbd', 'n/a', 'na', 'status', 'total', 'totals',
]);

/** Whole value is a spreadsheet cell or range reference, e.g. "D9" or "D9:D27". */
const WHOLE_CELL_REF = /^[A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?$/i;

/** A trailing cell/range reference glued onto a name, e.g. "DBJ & JV+D9:D27". */
const TRAILING_CELL_REF = /\s*[+&]?\s*[A-Z]{1,3}\d+(?::[A-Z]{1,3}\d+)?\s*$/i;

/**
 * True when a row is a legend/artefact rather than a task: its name is a lone
 * label word and every other mapped cell is empty.
 */
export function isLegendRow(name: string, otherValues: Array<string | null | undefined>): boolean {
  const n = (name || '').trim().toLowerCase();
  if (!n) return false;
  if (!LABEL_WORDS.has(n)) return false;
  return otherValues.every(v => v == null || String(v).trim() === '');
}

/** True when the entire value is just a spreadsheet cell/range reference. */
export function isCellRef(value: string | null | undefined): boolean {
  if (!value) return false;
  return WHOLE_CELL_REF.test(value.trim());
}

/**
 * Clean an assignee value: drop it entirely if it is only a cell reference,
 * otherwise strip a trailing cell reference (e.g. "DBJ & JV+D9:D27" → "DBJ & JV").
 * Returns null when nothing usable remains.
 */
export function cleanAssignee(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isCellRef(trimmed)) return null;
  const stripped = trimmed.replace(TRAILING_CELL_REF, '').trim();
  return stripped.length > 0 ? stripped : null;
}

/** Inclusive count of working days (Mon–Fri) between two ISO dates. */
export function workingDaySpan(startIso: string, endIso: string): number {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getUTCDay();
    if (day !== 0 && day !== 6) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return count;
}

export interface DurationSample {
  /** Working-day span implied by the row's start and end dates, or null. */
  span: number | null;
  /** The raw value from the duration column, or null. */
  value: number | null;
}

/**
 * Decide, per schedule, whether a duration column was expressed in hours or days.
 * If the column value tracks the working-day span for most rows it was days; if
 * it tracks roughly span × 8 it was hours. Conservative: defaults to 'hours'
 * (the existing behaviour) unless days clearly wins.
 */
export function decideDurationUnit(samples: DurationSample[]): 'hours' | 'days' | 'unknown' {
  const usable = samples.filter(
    s => s.span != null && s.span > 0 && s.value != null && s.value > 0,
  ) as Array<{ span: number; value: number }>;

  if (usable.length === 0) return 'unknown';

  let daysVotes = 0;
  let hoursVotes = 0;
  for (const s of usable) {
    const ratio = s.value / s.span;
    if (ratio >= 0.5 && ratio <= 2) daysVotes++;
    else if (ratio >= 4) hoursVotes++;
  }

  const majority = Math.ceil(usable.length / 2);
  if (daysVotes >= majority && daysVotes > hoursVotes) return 'days';
  if (hoursVotes >= majority && hoursVotes > daysVotes) return 'hours';
  return 'unknown';
}
