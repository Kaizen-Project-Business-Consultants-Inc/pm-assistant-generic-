/**
 * Gantt "Conflicts": which tasks book a person who is over 100% that week. Uses the same weekly
 * numbers as the Workload Heatmap (GET /resources/workload — every project, every way of
 * assigning someone), so the two never disagree.
 */

export interface WorkloadWeek { weekStart: string; utilization: number }
export interface WorkloadRow { resourceId: string; resourceName: string; weeks: WorkloadWeek[] }

export interface ConflictTask {
  id: string;
  startDate?: string | null;
  endDate?: string | null;
  isMilestone?: boolean | null;
  status?: string | null;
  assignedTo?: string | null;
  assignments?: Array<{ resourceId: string }>;
}

const DAY_MS = 86_400_000;
const day = (s: string) => s.slice(0, 10);
const addDays = (s: string, n: number) => new Date(Date.parse(`${day(s)}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const weekLabel = (s: string) =>
  new Date(`${day(s)}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * taskId → one line per overloaded person, e.g. "Anna Lee 140% (week of 12 Oct)" — the worst
 * week the task touches, plus how many other over-100% weeks it touches. Headings, milestones and
 * finished or cancelled tasks are never flagged.
 */
export function findResourceConflicts(
  tasks: ConflictTask[],
  workload: WorkloadRow[],
  headingIds: Set<string>,
): Map<string, string[]> {
  const over = new Map<string, { name: string; weeks: WorkloadWeek[] }>();
  for (const w of workload) {
    // eslint-disable-next-line no-restricted-syntax -- small: each person filters only their own weeks
    const weeks = w.weeks.filter(x => x.utilization > 100);
    if (weeks.length) over.set(w.resourceId, { name: w.resourceName, weeks });
  }
  const out = new Map<string, string[]>();
  if (over.size === 0) return out;

  for (const t of tasks) {
    if (!t.startDate || !t.endDate || t.isMilestone || headingIds.has(t.id)) continue;
    // Finished and cancelled work takes nobody's time any more
    if (t.status === 'completed' || t.status === 'cancelled') continue;
    const people = new Set((t.assignments ?? []).map(a => a.resourceId));
    if (t.assignedTo) people.add(t.assignedTo);
    const start = day(t.startDate);
    const end = day(t.endDate);
    const lines: string[] = [];
    for (const pid of people) {
      const o = over.get(pid);
      if (!o) continue;
      // eslint-disable-next-line no-restricted-syntax -- small: one person's over-100% weeks in the loaded range, for each of the task's few people
      const hit = o.weeks.filter(w => day(w.weekStart) <= end && addDays(w.weekStart, 6) >= start);
      if (!hit.length) continue;
      const worst = hit.reduce((a, b) => (b.utilization > a.utilization ? b : a));
      const more = hit.length > 1 ? ` +${hit.length - 1} more week${hit.length > 2 ? 's' : ''}` : '';
      lines.push(`${o.name} ${worst.utilization}% (week of ${weekLabel(worst.weekStart)})${more}`);
    }
    if (lines.length) out.set(t.id, lines);
  }
  return out;
}
