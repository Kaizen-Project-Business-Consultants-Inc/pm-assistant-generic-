/**
 * A project's actual cost over time, for earned value (2026-10-03): what was really spent by each
 * day — approved hours on the day worked, expenses on their date, older undated "other costs"
 * from the start. Built by ApprovedTimeService.costTimeline; read with costUpTo. Pure, no imports.
 */
/** A project's actual cost over time, for earned value */
export interface CostTimeline {
  /** spending with no date (older "other costs" typed in) — counted from the start */
  undated: number;
  /** labour (approved hours, on the day worked) and expenses (on their date), by day, in date order */
  byDay: Array<{ date: string; amount: number }>;
}

/** What was spent on or before `day` ('YYYY-MM-DD') */
export function costUpTo(t: CostTimeline, day: string): number {
  let sum = t.undated;
  for (const d of t.byDay) { if (d.date > day) break; sum += d.amount; }
  return Math.round(sum * 100) / 100;
}

