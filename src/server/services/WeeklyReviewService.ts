import { randomUUID } from 'crypto';
import { projectService } from './ProjectService';
import { scheduleService } from './ScheduleService';
import { autoRescheduleService } from './AutoRescheduleService';
import { resourceService } from './ResourceService';
import { evmForecastService } from './EVMForecastService';
import { scheduleReviewService } from './ScheduleReviewService';
import { weeklyTimesheetService } from './WeeklyTimesheetService';
import { statusDateFor } from './StatusDateService';
import { riskRepository } from '../database/RiskRepository';
import { approvalWorkflowRepository } from '../database/ApprovalWorkflowRepository';
import { weeklyReviewRepository, type WeeklyReviewRow, type WeeklyResponseRow } from '../database/WeeklyReviewRepository';
import { pickWeekly, DISMISS_QUIET_DAYS, type WeeklyFacts } from './weeklyReview/picker';
import { mondayOf, addCalendarDays, calendarDaysBetween } from '../utils/workingDays';
import logger from '../utils/logger';

export interface WeeklyReview extends WeeklyReviewRow {
  projectName: string;
  /** What the PM already did with this run's items */
  responses: WeeklyResponseRow[];
}

export const DISMISS_REASONS = ['not_a_problem', 'already_handled', 'facts_wrong'] as const;
export type DismissReason = typeof DISMISS_REASONS[number];

export class WeeklyReviewNotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'WeeklyReviewNotFoundError';
  }
}

const CLOSED_RAID = ['closed', 'resolved', 'mitigated', 'cancelled', 'reversed', 'completed'];
const SERIOUS = ['critical', 'high'];

/** 'YYYY-MM-DD' of a DB date/timestamp (string or Date) */
const dayOf = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? '')).slice(0, 10);

/** A part of the check that fails is left out (and logged), never the whole review */
async function safe<T>(what: string, projectId: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try { return await fn(); } catch (err: any) {
    logger.warn(`[WeeklyReview] ${what} skipped`, { projectId, error: err?.message });
    return fallback;
  }
}

export class WeeklyReviewService {
  /** Gather the week's facts about one project — Kovarti's own numbers, no AI */
  async gatherFacts(projectId: string): Promise<{ facts: WeeklyFacts; projectName: string }> {
    const project = await projectService.findById(projectId);
    if (!project) throw new WeeklyReviewNotFoundError('Project not found');
    const asOf = await statusDateFor(projectId);
    const schedules = (await scheduleService.findByProjectId(projectId)).filter(s => !s.isScenario);

    const [delays, overloads, evm, plans, risks, crs, pending, taskCount] = await Promise.all([
      safe('delays', projectId, async () => {
        const per = await Promise.all(schedules.map(async s =>
          (await autoRescheduleService.detectDelays(s.id)).map(d => ({
            taskId: d.taskId, taskName: d.taskName, scheduleId: s.id, delayDays: d.delayDays,
            isOnCriticalPath: d.isOnCriticalPath, currentProgress: d.currentProgress,
          }))));
        return per.flat();
      }, []),
      safe('workload', projectId, async () => {
        const from = mondayOf(asOf);
        const until = addCalendarDays(from, 14);
        const rows = await resourceService.computeWorkload(projectId);
        return rows.map(r => ({
          resourceId: r.resourceId,
          resourceName: r.resourceName,
          weeks: r.weeks
            .filter(w => w.weekStart >= from && w.weekStart < until && w.capacity > 0 && w.allocated > w.capacity + 0.5
              && (w.thisProject ?? 1) > 0)
            .map(w => ({ weekStart: w.weekStart, allocated: w.allocated, capacity: w.capacity })),
        })).filter(r => r.weeks.length > 0);
      }, []),
      safe('budget', projectId, async () => {
        if (!(Number(project.budgetAllocated) > 0)) return null;
        const m = (await evmForecastService.generateMetricsOnly(projectId)).currentMetrics;
        // Nothing earned or spent yet = nothing to judge
        if (!(m.EV > 0) && !(m.AC > 0)) return null;
        return { CPI: m.CPI, SPI: m.SPI, BAC: m.BAC, EAC: m.EAC, VAC: m.VAC };
      }, null),
      safe('plan quality', projectId, async () => {
        const out: WeeklyFacts['plans'] = [];
        for (const s of schedules) {
          const [latest, history] = await Promise.all([scheduleReviewService.latest(s.id), scheduleReviewService.history(s.id, 8)]);
          if (!latest || latest.leafTaskCount === 0) continue;
          // The score a week ago: the newest run at least 6 days older than the latest
          const weekAgo = history.find(h => dayOf(h.createdAt) <= addCalendarDays(dayOf(latest.createdAt), -6));
          out.push({
            scheduleId: s.id, name: s.name, score: latest.score, previousScore: weekAgo ? weekAgo.score : null,
            critical: latest.counts.critical,
            staleTasks: latest.findings.filter(f => f.ruleId === 'R24').reduce((n, f) => n + f.taskIds.length, 0),
          });
        }
        return out;
      }, []),
      safe('RAID', projectId, () => riskRepository.findByProject(projectId), []),
      safe('change requests', projectId, () => approvalWorkflowRepository.findChangeRequests(projectId), []),
      safe('timesheets', projectId, () => weeklyTimesheetService.projectPending(projectId), []),
      safe('tasks', projectId, async () => {
        const tasks = await scheduleService.findTasksByScheduleIds(schedules.map(s => s.id));
        return tasks.filter(t => !t.isSummary).length;
      }, 0),
    ]);

    const open = risks.filter(r => !CLOSED_RAID.includes(String(r.status).toLowerCase()));
    const unhandled = open
      .filter(r => r.type === 'risk' && SERIOUS.includes(String(r.severity).toLowerCase()))
      .map(r => {
        const noOwner = !r.ownerId && !r.ownerResourceId;
        const noResponse = !r.responseStrategy && !r.mitigationPlan && !r.responsePlan;
        return noOwner || noResponse ? { id: r.id, title: r.title, why: noOwner && noResponse ? 'no owner and no response' : noOwner ? 'no owner' : 'no response chosen' } : null;
      })
      .filter((r): r is { id: string; title: string; why: string } => r !== null);
    const overdue = open
      .filter(r => r.dueDate && String(r.dueDate).slice(0, 10) < asOf)
      .map(r => ({ id: r.id, title: r.title, dueDate: String(r.dueDate).slice(0, 10) }));

    const changeRequests = crs
      .filter(c => c.status === 'pending' || c.status === 'in_review')
      .map(c => ({ id: c.id, title: c.title, waitingDays: Math.max(0, calendarDaysBetween(dayOf(c.createdAt), asOf)) }));

    return {
      projectName: project.name,
      facts: {
        asOf,
        delays,
        overloads,
        evm,
        currency: project.currency || 'USD',
        plans,
        raid: { open: open.length, unhandled, overdue },
        changeRequests,
        timesheetsWaiting: pending.map(p => ({ userName: p.userName, weekStart: p.weekStart })),
        taskCount,
      },
    };
  }

  /** Run the review now, store it, return it */
  async run(projectId: string, trigger: 'manual' | 'friday', userId?: string | null): Promise<WeeklyReview> {
    const { facts, projectName } = await this.gatherFacts(projectId);
    const dismissals = await weeklyReviewRepository.dismissalsSince(projectId, addCalendarDays(facts.asOf, -DISMISS_QUIET_DAYS));
    const pick = pickWeekly(facts, dismissals);
    const row: Omit<WeeklyReviewRow, 'createdAt'> = {
      id: randomUUID(),
      projectId,
      weekStart: mondayOf(facts.asOf),
      asOf: facts.asOf,
      rag: pick.rag,
      ragReason: pick.ragReason,
      items: pick.items,
      fine: pick.fine,
      uncertainty: pick.uncertainty,
      moreFound: pick.moreFound,
      quietened: pick.quietened,
      trigger,
      createdBy: userId ?? null,
    };
    await weeklyReviewRepository.insert(row);
    weeklyReviewRepository.prune(projectId).catch(err =>
      logger.warn('[WeeklyReview] prune failed', { projectId, error: err?.message }),
    );
    const stored = await weeklyReviewRepository.findById(row.id);
    return { ...(stored ?? { ...row, createdAt: new Date().toISOString() }), projectName, responses: [] };
  }

  async latest(projectId: string): Promise<WeeklyReview | null> {
    const row = await weeklyReviewRepository.findLatest(projectId);
    if (!row) return null;
    const [project, responses] = await Promise.all([
      projectService.findById(projectId),
      weeklyReviewRepository.responsesFor(row.id),
    ]);
    return { ...row, projectName: project?.name ?? '', responses };
  }

  /** The PM says an item isn't useful — it stays quiet in later weeks unless it gets worse */
  async dismiss(projectId: string, reviewId: string, itemKey: string, reason: DismissReason, userId: string): Promise<WeeklyResponseRow[]> {
    const review = await weeklyReviewRepository.findById(reviewId);
    if (!review || review.projectId !== projectId) throw new WeeklyReviewNotFoundError('Review not found');
    const item = review.items.find(i => i.key === itemKey);
    if (!item) throw new WeeklyReviewNotFoundError('That item is not in this review');
    await weeklyReviewRepository.saveResponse({
      id: randomUUID(), projectId, reviewId, itemKey, response: 'dismissed', reason, measure: item.measure, createdBy: userId,
    });
    return weeklyReviewRepository.responsesFor(reviewId);
  }
}

export const weeklyReviewService = new WeeklyReviewService();
