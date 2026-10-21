/**
 * The tasks a daily deadline email names (U55, approved mock https://claude.ai/artifact/PP6uLZfCCZBPRVrWqwMXNC),
 * worked out again on the schedule the email opens: overdue (due before today, back 60 days) and due soon (today
 * and the next six days), open tasks only, not summary rows. The same rule as the server's
 * services/scheduling/deadlineNotificationJob.ts — change both together.
 */

/** Today and this many days after it count as "due soon" */
const DUE_SOON_DAYS = 7;
/** Overdue counts back this many days (an old plan left open isn't listed whole) */
const OVERDUE_WINDOW_DAYS = 60;

interface DigestTask {
  id: string;
  status: string;
  dueDate?: string | null;
  endDate?: string | null;
  assignedTo?: string | null;
  isSummary?: boolean | null;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** `mine`: only tasks given to these resources (the person's own); otherwise every task (the PM's email) */
export function deadlineTasks(tasks: DigestTask[], today: Date, mine?: Set<string>): { overdue: string[]; soon: string[] } {
  const t0 = ymd(today);
  const end = new Date(today); end.setDate(end.getDate() + DUE_SOON_DAYS - 1);
  const t1 = ymd(end);
  const from = new Date(today); from.setDate(from.getDate() - OVERDUE_WINDOW_DAYS);
  const tFrom = ymd(from);
  const overdue: string[] = [];
  const soon: string[] = [];
  for (const t of tasks) {
    if (t.isSummary || ['completed', 'cancelled', 'done'].includes(String(t.status))) continue;
    if (mine && !(t.assignedTo && mine.has(t.assignedTo))) continue;
    const due = String(t.dueDate || t.endDate || '').slice(0, 10);
    if (!due || due < tFrom) continue;
    if (due < t0) overdue.push(t.id);
    else if (due <= t1) soon.push(t.id);
  }
  return { overdue, soon };
}
