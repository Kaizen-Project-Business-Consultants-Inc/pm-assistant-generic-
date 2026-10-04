import { databaseService } from '../../database/connection';
import { notificationService } from '../NotificationService';
import { organizationTimezone } from '../StatusDateService';
import { weeklyReviewService } from '../WeeklyReviewService';
import logger from '../../utils/logger';

/**
 * Weekly PM review — Friday run (user decision 2026-10-04). The timer fires every hour from
 * Thursday to Saturday UTC; each company's run happens in the hour when it is Friday
 * RUN_HOUR in the company's own time zone. Each live project gets one review (a project
 * already reviewed by the Friday run this week is skipped, so a repeat firing does nothing),
 * then each PM gets ONE notification covering all their projects.
 */
export const RUN_HOUR = 7;

/** Is it Friday RUN_HOUR in this zone right now? */
export function isRunHour(now: Date, timeZone: string): boolean {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  }
  const weekday = parts.find(p => p.type === 'weekday')?.value;
  const hour = Number(parts.find(p => p.type === 'hour')?.value);
  return weekday === 'Fri' && hour === RUN_HOUR;
}

/** "DBJ-Loans: 2 decisions · NSWMA: 1 decision · DBJ-LMS: all fine" */
export function summaryLine(rows: Array<{ name: string; open: number }>): string {
  const sorted = [...rows].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
  return sorted.map(r => `${r.name}: ${r.open > 0 ? `${r.open} decision${r.open === 1 ? '' : 's'}` : 'all fine'}`).join(' · ');
}

/**
 * Run for the current company (call inside its tenant context). `force` skips the clock
 * check (manual runs from the cron runner). Returns the number of PMs notified.
 */
export async function runPmWeeklyReviews(opts: { orgId?: string | null; now?: Date; force?: boolean } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  if (!opts.force) {
    const zone = await organizationTimezone(opts.orgId ?? undefined);
    if (!isRunHour(now, zone)) return 0;
  }

  const projects = await databaseService.query<{ id: string; name: string }>(
    `SELECT p.id, p.name FROM projects p
      WHERE p.status IN ('active', 'planning') AND COALESCE(p.is_demo, 0) = 0 AND p.archived_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM weekly_reviews w
           WHERE w.project_id = p.id AND w.\`trigger\` = 'friday' AND w.created_at >= NOW() - INTERVAL 3 DAY)
      LIMIT 500`,
  );
  if (projects.length === 0) return 0;

  // Run each project's review; remember how many decisions it left open
  const done = new Map<string, { name: string; open: number }>();
  for (const p of projects) {
    try {
      const review = await weeklyReviewService.run(p.id, 'friday', null);
      done.set(p.id, { name: p.name, open: review.items.length }); // a fresh run has no responses yet
    } catch (err: any) {
      logger.error('[PmWeeklyReview] review failed', { projectId: p.id, error: err?.message });
    }
  }
  if (done.size === 0) return 0;

  // One notification per PM (the project's Manager/Owner members)
  const ids = [...done.keys()];
  const members = await databaseService.query<{ project_id: string; user_id: string }>(
    `SELECT project_id, user_id FROM project_members
      WHERE role IN ('owner', 'manager') AND project_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  );
  const byPm = new Map<string, string[]>();
  for (const m of members) {
    if (!done.has(m.project_id)) continue;
    const list = byPm.get(m.user_id) ?? [];
    if (!list.includes(m.project_id)) list.push(m.project_id);
    byPm.set(m.user_id, list);
  }

  let notified = 0;
  for (const [userId, projectIds] of byPm) {
    const rows = projectIds.map(id => done.get(id)!);
    const needs = rows.filter(r => r.open > 0).length;
    try {
      await notificationService.create({
        userId,
        type: 'weekly_pm_review',
        severity: needs > 0 ? 'medium' : 'low',
        title: needs > 0 ? 'Your weekly review is ready' : 'Your weekly review: all fine',
        message: summaryLine(rows),
        // One project: straight to its review; several: the dashboard list
        projectId: projectIds.length === 1 ? projectIds[0] : undefined,
        linkType: 'weekly_pm_review',
      });
      notified++;
    } catch (err: any) {
      logger.error('[PmWeeklyReview] notify failed', { userId, error: err?.message });
    }
  }
  logger.info(`[PmWeeklyReview] ${done.size} project(s) reviewed, ${notified} PM(s) notified`);
  return notified;
}
