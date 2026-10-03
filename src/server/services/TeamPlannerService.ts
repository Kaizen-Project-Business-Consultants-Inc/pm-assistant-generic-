import { databaseService } from '../database/connection';
import { resourceRepository } from '../database/ResourceRepository';
import { scheduleService } from './ScheduleService';
import { resourceAvailabilityService } from './ResourceAvailabilityService';
import { resourceReplaceService, type ReplaceUndo } from './ResourceReplaceService';
import { scheduleRecomputeService, restoreTaskDates } from './ScheduleRecomputeService';
import { changeHistoryService } from './ChangeHistoryService';
import { auditLedgerService } from './AuditLedgerService';
import { rateCardService, ratesOn } from './RateCardService';
import { planChanged } from './domainEvents';
import { ResourceValidationError, type ResourceAssignment } from './ResourceService';
import { hoursInWeek, calendarsFor } from './weeklyLoad';
import { followTask } from '../database/bookingDates';
import { checkProjectRoleFor } from '../middleware/requireProjectAccess';
import { readableProjectIds } from '../utils/readableProjects';
import { getRequestContext, getActorSource } from '../middleware/requestContext';
import {
  type IsWorking, mondayOf, mondaysBetween, weekEndOf, addCalendarDays, onOrAfterWorking, finishFor,
  workingDaysBetween, calendarDaysBetween, utcDay, ymdOf,
} from '../utils/workingDays';
import logger from '../utils/logger';

/**
 * Team Planner (2026-10-02): everyone on the PM's projects, week by week, across ALL their work —
 * the way MS Project's Team Planner shows it. A PM drags a task to another person (it becomes
 * theirs) or to another week (the task and the tasks linked after it move). Every drop is checked
 * first (`preview`), then applied as ONE change in Schedule History, undoable like any other.
 *
 * Rules (product owner): only a PM changes anything, and only on their own projects; work on
 * other projects is shown as hours only, and named only when the viewer can open that project.
 * A drop that overloads someone warns but is allowed.
 */

const ph = (n: number) => Array.from({ length: n }, () => '?').join(',');
const DONE = new Set(['completed', 'cancelled']);
const MANAGES_ALL = ['admin', 'pmo'];

export interface Viewer { userId: string; role: string; isGuest?: boolean }

export interface PlannerBlock {
  /** resourceId:taskId ('none:taskId' for a task with no one) */
  key: string;
  taskId: string;
  resourceId: string | null;
  scheduleId: string;
  /** null when the viewer can't open that project */
  projectId: string | null;
  projectName: string | null;
  taskName: string | null;
  startDate: string;
  endDate: string;
  /** this person's hours a week on it (null for a task with no one) */
  hoursPerWeek: number | null;
  /** the viewer manages this project: the block can be dragged */
  editable: boolean;
  /** started or done: it can change hands but its dates stay */
  started: boolean;
}

export interface PlannerPerson {
  id: string;
  name: string;
  role: string | null;
  isGeneric: boolean;
  /** hours they can work, per week of the board */
  capacity: number[];
  /** hours booked, per week, on every project */
  load: number[];
  blocks: PlannerBlock[];
}

export interface PlannerBoard {
  weeks: string[];
  projects: Array<{ id: string; name: string }>;
  people: PlannerPerson[];
  unassigned: PlannerBlock[];
}

export interface MoveInput {
  taskId: string;
  /** whose block was dragged (null: from "No one assigned") */
  fromResourceId: string | null;
  /** who gets it (same as from, or null, for a move in time only) */
  toResourceId: string | null;
  /** weeks later (negative = earlier) */
  weeks: number;
}

export interface LoadChange { weekStart: string; before: number; after: number; capacity: number }

export interface MovePreview {
  taskName: string;
  projectName: string;
  fromName: string | null;
  toName: string | null;
  reassign: boolean;
  dates: { startBefore: string; endBefore: string; startAfter: string; endAfter: string } | null;
  /** the move asked for an earlier start than its predecessors allow: it starts as early as it can */
  heldByPredecessor: boolean;
  /** other tasks that move because they're linked after it */
  linkedMoved: Array<{ taskId: string; name: string; startBefore: string | null; startAfter: string }>;
  projectEndBefore: string | null;
  projectEndAfter: string | null;
  /** working days the project finishes later (negative = earlier) */
  projectEndShift: number;
  /** everyone on the task, when its dates move (the move is for all of them) */
  others: string[];
  load: Array<{ resourceId: string; name: string; weeks: LoadChange[] }>;
  /** weeks someone would be over their hours after the move */
  overloads: Array<{ name: string; weekStart: string; hours: number; capacity: number }>;
  cost: { before: number; after: number } | null;
  /** the person giving it up has logged time on it — that stays theirs */
  loggedStays: boolean;
}

interface TaskRow {
  id: string; name: string; schedule_id: string; project_id: string; project_name: string; status: string | null;
  start_date: string | null; end_date: string | null; actual_start_date: string | null; actual_end_date: string | null;
  is_milestone: number; is_summary: number; has_children: number; budget_allocated: number | null; assigned_to: string | null;
}

export class TeamPlannerService {
  /** Projects the viewer manages (owner/manager; admin and PMO manage all) */
  async managedProjectIds(viewer: Viewer): Promise<string[]> {
    if (!viewer.isGuest && MANAGES_ALL.includes(viewer.role)) {
      const rows = await databaseService.query<{ id: string }>(
        `SELECT id FROM projects WHERE archived_at IS NULL AND COALESCE(is_demo, 0) = 0`);
      return rows.map(r => r.id);
    }
    const readable = await readableProjectIds(viewer);
    if (readable === 'all') return [];
    const out: string[] = [];
    for (const id of readable) {
      if ((await checkProjectRoleFor(viewer, id, 'manager')).ok) out.push(id);
    }
    if (out.length === 0) return out;
    // live projects only
    const live = await databaseService.query<{ id: string }>(
      `SELECT id FROM projects WHERE id IN (${ph(out.length)}) AND archived_at IS NULL AND COALESCE(is_demo, 0) = 0`, out);
    return live.map(r => r.id);
  }

  async board(viewer: Viewer, from: string, weekCount = 8): Promise<PlannerBoard> {
    const count = Math.min(Math.max(Math.round(weekCount) || 8, 1), 26);
    const first = mondayOf(from);
    const weeks = mondaysBetween(first, addCalendarDays(first, (count - 1) * 7));
    const lastDay = weekEndOf(weeks[weeks.length - 1]);
    const empty: PlannerBoard = { weeks, projects: [], people: [], unassigned: [] };

    const managed = await this.managedProjectIds(viewer);
    if (managed.length === 0) return empty;
    const projects = await databaseService.query<{ id: string; name: string }>(
      `SELECT id, name FROM projects WHERE id IN (${ph(managed.length)}) ORDER BY name`, managed);
    const mySchedules = (await databaseService.query<{ id: string }>(
      `SELECT id FROM schedules WHERE project_id IN (${ph(managed.length)})`, managed)).map(r => r.id);
    if (mySchedules.length === 0) return { ...empty, projects };
    const mine = new Set(mySchedules);

    const onMine = await resourceRepository.findEffectiveAssignments({ scheduleIds: mySchedules, from: first, to: lastDay });
    const unassigned = await this.unassignedTasks(mySchedules, first, lastDay);
    // Everyone in the company who can take work (so a task can go to someone with nothing yet),
    // plus the generic roles holding work on these projects
    const pool = await databaseService.query<{ id: string }>(
      `SELECT id FROM resources WHERE COALESCE(is_active, 1) = 1 AND COALESCE(is_generic, 0) = 0 LIMIT 500`);
    const resourceIds = [...new Set([...onMine.map(a => a.resourceId), ...pool.map(r => r.id)])];
    const resources = resourceIds.length ? await resourceRepository.findByIds(resourceIds) : [];
    const realPeople = new Set(resources.filter(r => !r.isGeneric).map(r => r.id));
    // The same people's work everywhere else in these weeks (generic roles are this company's demand on these projects only)
    const elsewhere = realPeople.size === 0 ? [] : (await resourceRepository.findEffectiveAssignments({ from: first, to: lastDay }))
      .filter(a => realPeople.has(a.resourceId) && !mine.has(a.scheduleId));
    const all = [...onMine, ...elsewhere];

    const scheduleIds = [...new Set([...all.map(a => a.scheduleId), ...unassigned.map(u => u.schedule_id)])];
    const where = scheduleIds.length ? await databaseService.query<{ id: string; project_id: string; project_name: string }>(
      `SELECT s.id, s.project_id, p.name AS project_name FROM schedules s JOIN projects p ON p.id = s.project_id WHERE s.id IN (${ph(scheduleIds.length)})`,
      scheduleIds) : [];
    const projectOf = new Map(where.map(w => [w.id, w]));
    const readable = await readableProjectIds(viewer);
    const canRead = (pid: string) => readable === 'all' || readable.has(pid) || managed.includes(pid);

    const taskIds = [...new Set(all.map(a => a.taskId).filter(Boolean))];
    const tasks = taskIds.length ? await databaseService.query<any>(
      `SELECT id, name, status, actual_start_date, actual_end_date FROM tasks WHERE id IN (${ph(taskIds.length)})`, taskIds) : [];
    const taskById = new Map(tasks.map((t: any) => [t.id, t]));
    const calOf = await calendarsFor(all.map(a => a.scheduleId), id => scheduleService.workingDayTest(id));
    const capacityMap = await resourceAvailabilityService.getEffectiveCapacityBatch(
      resources.map(r => ({ id: r.id, capacityHoursPerWeek: r.capacityHoursPerWeek, calendarTemplateId: r.calendarTemplateId })),
      weeks.map(w => new Date(`${w}T00:00:00Z`)),
    );

    const people: PlannerPerson[] = resources.map(r => {
      const rows = all.filter(a => a.resourceId === r.id);
      // One block per person and task (a booking over two date ranges shows as one)
      const merged = new Map<string, PlannerBlock>();
      for (const a of rows) {
        const key = `${r.id}:${a.taskId}`;
        const w = projectOf.get(a.scheduleId);
        const named = !!w && canRead(w.project_id);
        const t = taskById.get(a.taskId);
        const prev = merged.get(key);
        if (prev) {
          // effective bookings already give one per person and task (hours booking > % > Assigned to): never add them
          prev.hoursPerWeek = Math.max(prev.hoursPerWeek ?? 0, Math.round(a.hoursPerWeek * 100) / 100);
          if (a.startDate < prev.startDate) prev.startDate = a.startDate.slice(0, 10);
          if (a.endDate > prev.endDate) prev.endDate = a.endDate.slice(0, 10);
          continue;
        }
        merged.set(key, {
          key,
          taskId: a.taskId,
          resourceId: r.id,
          scheduleId: a.scheduleId,
          projectId: named ? w!.project_id : null,
          projectName: named ? w!.project_name : null,
          taskName: named ? (t?.name ?? null) : null,
          startDate: a.startDate.slice(0, 10),
          endDate: a.endDate.slice(0, 10),
          hoursPerWeek: Math.round(a.hoursPerWeek * 100) / 100,
          editable: mine.has(a.scheduleId),
          started: !!t && (DONE.has(t.status) || !!t.actual_start_date || !!t.actual_end_date),
        });
      }
      const load = weeks.map(wk => Math.round(rows.reduce((s, a) => s + hoursInWeek(a, wk, calOf(a.scheduleId)), 0) * 10) / 10);
      const capacity = weeks.map(wk => capacityMap.get(r.id)?.get(wk) ?? r.capacityHoursPerWeek);
      return {
        id: r.id, name: r.name, role: r.role ?? null, isGeneric: !!r.isGeneric, capacity, load,
        blocks: [...merged.values()].sort((a, b) => a.startDate.localeCompare(b.startDate)),
      };
    })
      // people with work on your projects first, then the rest of the team, generic roles last
      .sort((a, b) => Number(a.isGeneric) - Number(b.isGeneric)
        || Number(!a.blocks.some(x => x.editable)) - Number(!b.blocks.some(x => x.editable))
        || a.name.localeCompare(b.name));

    return {
      weeks,
      projects,
      people,
      unassigned: unassigned.map(u => ({
        key: `none:${u.id}`, taskId: u.id, resourceId: null, scheduleId: u.schedule_id,
        projectId: projectOf.get(u.schedule_id)?.project_id ?? null, projectName: projectOf.get(u.schedule_id)?.project_name ?? null,
        taskName: u.name, startDate: u.start_date, endDate: u.end_date, hoursPerWeek: null, editable: true,
        started: !!u.actual_start_date,
      })),
    };
  }

  /** Open, dated tasks on these plans that no one is on */
  private async unassignedTasks(scheduleIds: string[], from: string, to: string) {
    return databaseService.query<{ id: string; name: string; schedule_id: string; start_date: string; end_date: string; actual_start_date: string | null }>(
      `SELECT t.id, t.name, t.schedule_id, DATE_FORMAT(t.start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(t.end_date, '%Y-%m-%d') AS end_date,
              DATE_FORMAT(t.actual_start_date, '%Y-%m-%d') AS actual_start_date
         FROM tasks t
        WHERE t.schedule_id IN (${ph(scheduleIds.length)})
          AND t.start_date IS NOT NULL AND t.end_date IS NOT NULL AND t.start_date <= ? AND t.end_date >= ?
          AND COALESCE(t.is_milestone, 0) = 0 AND COALESCE(t.is_summary, 0) = 0
          AND NOT EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.id)
          AND COALESCE(t.status, '') NOT IN ('completed', 'cancelled')
          AND (t.assigned_to IS NULL OR t.assigned_to = '')
          AND NOT EXISTS (SELECT 1 FROM task_assignments ta WHERE ta.task_id = t.id)
          AND NOT EXISTS (SELECT 1 FROM resource_assignments ra WHERE ra.task_id = t.id)
        ORDER BY t.start_date
        LIMIT 200`,
      [...scheduleIds, to, from]);
  }

  private async taskRow(taskId: string): Promise<TaskRow | null> {
    const [t] = await databaseService.query<TaskRow>(
      `SELECT t.id, t.name, t.schedule_id, s.project_id, p.name AS project_name, t.status, t.assigned_to, t.budget_allocated,
              DATE_FORMAT(t.start_date, '%Y-%m-%d') AS start_date, DATE_FORMAT(t.end_date, '%Y-%m-%d') AS end_date,
              DATE_FORMAT(t.actual_start_date, '%Y-%m-%d') AS actual_start_date, DATE_FORMAT(t.actual_end_date, '%Y-%m-%d') AS actual_end_date,
              COALESCE(t.is_milestone, 0) AS is_milestone, COALESCE(t.is_summary, 0) AS is_summary,
              EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = t.id) AS has_children
         FROM tasks t JOIN schedules s ON s.id = t.schedule_id JOIN projects p ON p.id = s.project_id
        WHERE t.id = ?`, [taskId]);
    return t ?? null;
  }

  /** The project a task belongs to (route permission check) */
  async projectOfTask(taskId: string): Promise<string | null> {
    const [r] = await databaseService.query<{ project_id: string }>(
      `SELECT s.project_id FROM tasks t JOIN schedules s ON s.id = t.schedule_id WHERE t.id = ?`, [taskId]);
    return r?.project_id ?? null;
  }

  /** Validate a drop and work out what it does; nothing is written */
  async preview(input: MoveInput): Promise<MovePreview> {
    return (await this.plan(input)).preview;
  }

  private async plan(input: MoveInput) {
    const weeks = Math.round(Number(input.weeks) || 0);
    if (Math.abs(weeks) > 52) throw new ResourceValidationError('Move a task by up to a year at a time.');
    const task = await this.taskRow(input.taskId);
    if (!task) throw new ResourceValidationError('That task no longer exists. Refresh the planner.');
    if (task.is_summary || task.has_children || task.is_milestone) throw new ResourceValidationError('Only tasks with work can be moved here — not headings or milestones.');
    if (!task.start_date || !task.end_date) throw new ResourceValidationError('This task has no dates yet. Give it dates in the schedule first.');
    if (DONE.has(task.status ?? '')) throw new ResourceValidationError('This task is finished, so it stays as it is.');

    const fromId = input.fromResourceId || null;
    const toId = input.toResourceId || fromId;
    const reassign = !!toId && toId !== fromId;
    if (!reassign && weeks === 0) throw new ResourceValidationError('Drop it on another person or another week to change it.');

    const scheduleBookings = await resourceRepository.findEffectiveAssignments({ scheduleIds: [task.schedule_id] });
    const onTask = scheduleBookings.filter(a => a.taskId === task.id);
    const ids = [...new Set([fromId, toId, ...onTask.map(a => a.resourceId)].filter(Boolean))] as string[];
    const resources = ids.length ? await resourceRepository.findByIds(ids) : [];
    const res = new Map(resources.map(r => [r.id, r]));
    const from = fromId ? res.get(fromId) : null;
    const to = toId ? res.get(toId) : null;
    if (fromId && !from) throw new ResourceValidationError('That person no longer exists. Refresh the planner.');
    if (fromId && !onTask.some(a => a.resourceId === fromId)) throw new ResourceValidationError(`${from!.name} is no longer on this task. Refresh the planner.`);
    if (!fromId && onTask.length > 0) throw new ResourceValidationError('Someone was put on this task meanwhile. Refresh the planner.');
    if (reassign) {
      if (!to) throw new ResourceValidationError('That person no longer exists. Refresh the planner.');
      if (to.isGeneric) throw new ResourceValidationError('Give work to a real person. A generic role only holds work nobody has yet.');
      if (to.isActive === false) throw new ResourceValidationError(`${to.name} is no longer active, so they can't take on work.`);
      if (onTask.some(a => a.resourceId === toId)) throw new ResourceValidationError(`${to.name} is already on this task.`);
    }

    // Dates: the same working-day length, starting N weeks later (on a working day)
    const isWorking: IsWorking = await scheduleService.workingDayTest(task.schedule_id);
    let dates: MovePreview['dates'] = null;
    let linkedMoved: MovePreview['linkedMoved'] = [];
    let heldByPredecessor = false;
    let moves: Array<{ taskId: string; oldStart: string | null; oldEnd: string | null; newStart: string; newEnd: string }> = [];
    let projectEndBefore: string | null = null; let projectEndAfter: string | null = null; let projectEndShift = 0;
    if (weeks !== 0) {
      if (task.actual_start_date || task.actual_end_date) throw new ResourceValidationError('This task has started, so its dates stay. You can still give it to someone else.');
      const length = Math.max(1, workingDaysBetween(task.start_date, task.end_date, isWorking));
      const wantStart = onOrAfterWorking(utcDay(addCalendarDays(task.start_date, weeks * 7)), isWorking);
      const wantEnd = finishFor(wantStart, length, isWorking);
      const result = await scheduleRecomputeService.recompute(task.schedule_id, {
        onlyFrom: [task.id], dryRun: true, moves: { [task.id]: { startDate: ymdOf(wantStart), endDate: ymdOf(wantEnd) } },
      });
      const self = result.deltas.find(d => d.taskId === task.id);
      if (!self) throw new ResourceValidationError("It can't move earlier: the task it waits for doesn't finish in time.");
      heldByPredecessor = self.newStart !== ymdOf(wantStart);
      dates = { startBefore: task.start_date, endBefore: task.end_date, startAfter: self.newStart, endAfter: self.newEnd };
      linkedMoved = result.deltas.filter(d => d.taskId !== task.id).map(d => ({ taskId: d.taskId, name: d.name, startBefore: d.oldStart, startAfter: d.newStart }));
      moves = result.deltas.map(d => ({ taskId: d.taskId, oldStart: d.oldStart, oldEnd: d.oldEnd, newStart: d.newStart, newEnd: d.newEnd }));
      projectEndBefore = result.projectEndBefore; projectEndAfter = result.projectEndAfter;
      if (projectEndBefore && projectEndAfter && projectEndAfter !== projectEndBefore) {
        const later = projectEndAfter > projectEndBefore;
        const [a, b] = later ? [projectEndBefore, projectEndAfter] : [projectEndAfter, projectEndBefore];
        projectEndShift = (later ? 1 : -1) * Math.max(1, workingDaysBetween(a, b, isWorking) - 1);
      }
    }

    // Before/after weekly hours of everyone it touches
    const movedById = new Map(moves.map(m => [m.taskId, m]));
    const affected = new Set<string>([...(reassign && fromId ? [fromId] : []), ...(reassign && toId ? [toId] : [])]);
    if (moves.length) for (const a of scheduleBookings) if (movedById.has(a.taskId)) affected.add(a.resourceId);
    const allDates = [task.start_date, task.end_date, ...moves.flatMap(m => [m.oldStart, m.oldEnd, m.newStart, m.newEnd])].filter(Boolean) as string[];
    const spanFrom = allDates.reduce((a, b) => (a < b ? a : b));
    const spanTo = allDates.reduce((a, b) => (a > b ? a : b));
    const affectedIds = [...affected];
    const extra = affectedIds.filter(id => !res.has(id));
    if (extra.length) for (const r of await resourceRepository.findByIds(extra)) res.set(r.id, r);
    const before = (await resourceRepository.findEffectiveAssignments({ from: spanFrom, to: spanTo }))
      .filter(a => affected.has(a.resourceId));
    const after: ResourceAssignment[] = before.map(a => {
      let b = a;
      const m = movedById.get(a.taskId);
      if (m) {
        // A task-based booking takes the task's new dates; an hours booking moves by the same days
        const t = { start: m.oldStart, end: m.oldEnd };
        b = a.source === 'manual'
          ? (() => { const f = followTask({ start: a.startDate.slice(0, 10), end: a.endDate.slice(0, 10) }, t, { start: m.newStart, end: m.newEnd }); return { ...b, startDate: f.start, endDate: f.end }; })()
          : { ...b, startDate: m.newStart, endDate: m.newEnd };
      }
      if (reassign && a.taskId === task.id && a.resourceId === fromId) b = { ...b, resourceId: toId! };
      return b;
    });
    if (reassign && !fromId && to) {
      const d = movedById.get(task.id);
      after.push({ id: 'new', resourceId: to.id, taskId: task.id, scheduleId: task.schedule_id, hoursPerWeek: to.capacityHoursPerWeek,
        startDate: d?.newStart ?? task.start_date, endDate: d?.newEnd ?? task.end_date, source: 'owner' });
    }
    const weekList = mondaysBetween(spanFrom, spanTo).slice(0, 26);
    const calOf = await calendarsFor([...before, ...after].map(a => a.scheduleId), id => scheduleService.workingDayTest(id));
    const capacityMap = await resourceAvailabilityService.getEffectiveCapacityBatch(
      affectedIds.map(id => res.get(id)!).filter(Boolean).map(r => ({ id: r.id, capacityHoursPerWeek: r.capacityHoursPerWeek, calendarTemplateId: r.calendarTemplateId })),
      weekList.map(w => new Date(`${w}T00:00:00Z`)),
    );
    const sum = (list: ResourceAssignment[], rid: string, wk: string) =>
      Math.round(list.filter(a => a.resourceId === rid).reduce((s, a) => s + hoursInWeek(a, wk, calOf(a.scheduleId)), 0) * 10) / 10;
    const load: MovePreview['load'] = [];
    const overloads: MovePreview['overloads'] = [];
    for (const rid of affectedIds) {
      const r = res.get(rid);
      if (!r || r.isGeneric) continue;
      const wks: LoadChange[] = [];
      for (const wk of weekList) {
        const b = sum(before, rid, wk); const a = sum(after, rid, wk);
        const capacity = capacityMap.get(rid)?.get(wk) ?? r.capacityHoursPerWeek;
        if (b === a) continue;
        wks.push({ weekStart: wk, before: b, after: a, capacity });
        if (a > capacity && a > b) overloads.push({ name: r.name, weekStart: wk, hours: a, capacity });
      }
      if (wks.length) load.push({ resourceId: rid, name: r.name, weeks: wks });
    }

    // Planned cost: the hours change hands at the new person's rate
    let cost: MovePreview['cost'] = null;
    if (reassign && to) {
      const card = await rateCardService.listSafe();
      const priced = (r: any) => ({ role: r.role, costRateHourly: r.costRateHourly ?? null, overtimeRateHourly: r.overtimeRateHourly ?? null, useRateCard: !!r.useRateCard || !!r.isGeneric });
      const rows = fromId ? onTask.filter(a => a.resourceId === fromId) : [{ hoursPerWeek: to.capacityHoursPerWeek, startDate: task.start_date, endDate: task.end_date } as ResourceAssignment];
      const value = (r: any) => rows.reduce((s, a) => s + (a.hoursPerWeek / 5) * workingDaysBetween(a.startDate, a.endDate, isWorking) * (ratesOn(priced(r), a.startDate.slice(0, 10), card).standard ?? 0), 0);
      const now = task.budget_allocated != null ? Number(task.budget_allocated) : 0;
      const next = Math.round((now - (from ? value(from) : 0) + value(to)) * 100) / 100;
      if (now || next) cost = { before: Math.round(now * 100) / 100, after: Math.max(0, next) };
    }

    let loggedStays = false;
    if (reassign && from?.userId) {
      const [row] = await databaseService.query<{ n: number }>(`SELECT COUNT(*) AS n FROM time_entries WHERE task_id = ? AND user_id = ?`, [task.id, from.userId]);
      loggedStays = Number(row?.n ?? 0) > 0;
    }

    const preview: MovePreview = {
      taskName: task.name,
      projectName: task.project_name,
      fromName: from?.name ?? null,
      toName: to?.name ?? null,
      reassign,
      dates,
      heldByPredecessor,
      linkedMoved,
      projectEndBefore, projectEndAfter, projectEndShift,
      others: weeks !== 0 ? [...new Set(onTask.map(a => res.get(a.resourceId)?.name).filter(Boolean) as string[])] : [],
      load,
      overloads,
      cost,
      loggedStays,
    };
    return { preview, task, fromId, toId, reassign, moves };
  }

  /** Apply a drop: one Schedule History change, undoable */
  async apply(input: MoveInput): Promise<{ changeId: string | null; summary: string; preview: MovePreview }> {
    const { preview, task, fromId, toId, reassign, moves } = await this.plan(input);
    const undo: PlannerUndo = { moved: [], bookings: [] };
    if (reassign && toId) {
      undo.reassign = fromId
        ? await resourceReplaceService.swap(task.schedule_id, fromId, toId, [task.id])
        : await resourceReplaceService.assign(task.schedule_id, task.id, toId);
    }
    if (moves.length) {
      undo.moved = moves.map(m => ({ taskId: m.taskId, startDate: m.oldStart, endDate: m.oldEnd }));
      await scheduleRecomputeService.recompute(task.schedule_id, {
        onlyFrom: [task.id], reason: 'team_planner',
        moves: { [task.id]: { startDate: moves.find(m => m.taskId === task.id)!.newStart, endDate: moves.find(m => m.taskId === task.id)!.newEnd } },
      });
      // (hours bookings move with their tasks inside the date write — database/bookingDates.ts)
      await databaseService.query(`UPDATE tasks SET updated_at = NOW() WHERE id IN (${ph(moves.length)})`, moves.map(m => m.taskId));
    }

    const parts: string[] = [];
    if (reassign) parts.push(`Gave "${task.name}" to ${preview.toName}${preview.fromName ? ` (was ${preview.fromName})` : ''}`);
    if (preview.dates) {
      const n = Math.abs(Math.round(Number(input.weeks)));
      parts.push(`${reassign ? 'moved it' : `Moved "${task.name}"`} ${n} week${n === 1 ? '' : 's'} ${Number(input.weeks) > 0 ? 'later' : 'earlier'}${preview.linkedMoved.length ? ` (${preview.linkedMoved.length} linked task${preview.linkedMoved.length === 1 ? '' : 's'} moved too)` : ''}`);
    }
    const summary = `${parts.join(', and ')} — Team Planner`;
    const changeId = await changeHistoryService.record({
      projectId: task.project_id,
      scheduleId: task.schedule_id,
      kind: 'planner_move',
      summary,
      taskIds: [...new Set([task.id, ...moves.map(m => m.taskId)])],
      undo,
    });
    planChanged(task.schedule_id);
    const ctx = getRequestContext();
    auditLedgerService.append({
      actorId: ctx?.userId ?? 'system',
      actorType: ctx?.userId ? 'user' : 'system',
      action: 'resource.planner_move',
      entityType: 'task',
      entityId: task.id,
      projectId: task.project_id,
      payload: { fromId, toId: reassign ? toId : null, weeks: Number(input.weeks) || 0, moved: moves.length },
      source: getActorSource(),
    }).catch(err => logger.warn('[TeamPlanner] audit append failed', { error: err?.message }));
    return { changeId, summary, preview };
  }

  /** History's Undo for a 'planner_move' change */
  async undo(scheduleId: string, u: PlannerUndo): Promise<number> {
    let restored = 0;
    // entries recorded before bookings moved with their task (2026-10-02) carry them; newer ones don't
    for (const b of u.bookings ?? []) {
      await databaseService.query('UPDATE resource_assignments SET start_date = ?, end_date = ? WHERE id = ? AND schedule_id = ?', [b.startDate, b.endDate, b.id, scheduleId]);
    }
    if (u.moved?.length) restored += await restoreTaskDates(scheduleId, u.moved);
    if (u.reassign) restored = Math.max(restored, await resourceReplaceService.undo(scheduleId, u.reassign));
    return restored;
  }
}

export interface PlannerUndo {
  reassign?: ReplaceUndo;
  moved: Array<{ taskId: string; startDate: string | null; endDate: string | null }>;
  bookings: Array<{ id: string; startDate: string; endDate: string }>;
}

export const teamPlannerService = new TeamPlannerService();
