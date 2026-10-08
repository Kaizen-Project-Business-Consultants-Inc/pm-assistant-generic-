import { resourceRepository } from '../database/ResourceRepository';
import { planChanged, personRatesChanged } from './domainEvents';
import { scheduleService } from './ScheduleService';
import { auditLedgerService } from './AuditLedgerService';
import { resourceAvailabilityService } from './ResourceAvailabilityService';
import { deadLetterService } from './DeadLetterService';
import { timeEntryRepository } from '../database/TimeEntryRepository';
import { rateCardService, ratesOn } from './RateCardService';
import { databaseService } from '../database/connection';
import { getRequestContext, getActorSource } from '../middleware/requestContext';
import { hoursInWeek, calendarsFor, bookedHoursByWeek } from './weeklyLoad';
import { type IsWorking, weekdaysOnly, mondayOf } from '../utils/workingDays';

export interface SkillWithProficiency {
  name: string;
  level: number; // 1=Junior, 2=Intermediate, 3=Mid, 4=Senior, 5=Expert
}

export function normalizeSkills(input: (string | SkillWithProficiency)[]): SkillWithProficiency[] {
  return input.map(s => typeof s === 'string' ? { name: s, level: 3 } : s);
}

export interface Resource {
  id: string;
  name: string;
  role: string;
  email: string;
  capacityHoursPerWeek: number;
  skills: SkillWithProficiency[];
  isActive: boolean;
  costRateHourly: number | null;
  overtimeRateHourly: number | null;
  /** Costed from the company rate card for this resource's role (dated rates), not its own rate */
  useRateCard?: boolean;
  resourceGroup: string | null;
  userId: string | null;
  calendarTemplateId: string | null;
  /** A stand-in role ("Generic Developer"): no email, no login, never on a Team list, not
   *  counted as over-booked — the PM swaps in a real person later. Set when created only. */
  isGeneric?: boolean;
  /** The user who approves this person's weekly timesheet (any user with a login, a PM too).
   *  Every person has one; generic roles never do. */
  lineManagerUserId?: string | null;
  /** Given the company owner automatically — the Resources page asks someone to check it */
  lineManagerIsDefault?: boolean;
}

/** A resource the rules refuse (a person without an email) — the caller's mistake, a 400 */
export class ResourceValidationError extends Error {}

export const EMAIL_REQUIRED_MESSAGE = 'Add an email. If this is a stand-in for someone not yet known, use a generic role instead.';
export const LINE_MANAGER_REQUIRED_MESSAGE = 'Choose a line manager — the person who approves their timesheets.';

export interface ResourceAssignment {
  id: string;
  resourceId: string;
  taskId: string;
  scheduleId: string;
  hoursPerWeek: number;
  startDate: string;
  endDate: string;
  /** Where it came from (effective reads only): an hours-per-week booking on the Resources
   *  page, a person + % on the task, or the task's "Assigned to" person (100%) */
  source?: 'manual' | 'task' | 'owner';
}

export interface WeeklyUtilization {
  weekStart: string;
  /** All the person's booked hours that week — this project and every other live one */
  allocated: number;
  /** Project workload only: the part on this project, and the part on other projects */
  thisProject?: number;
  otherProjects?: number;
  actual: number;
  capacity: number;
  utilization: number;
  cost: number;
}

export interface ResourceWorkload {
  resourceId: string;
  resourceName: string;
  role: string;
  costRateHourly: number | null;
  totalCost: number;
  weeks: WeeklyUtilization[];
  averageUtilization: number;
  /** Project workload only: the average share of the person's week that is this project's */
  projectAverageUtilization?: number;
  /** Project workload: over 100% (all projects counted) in a week they work on THIS project */
  isOverAllocated: boolean;
}

export interface UnfilledDemand {
  resourceId: string;
  resourceName: string;
  role: string;
  weeks: Array<{ weekStart: string; hours: number; people: number }>;
}

/** How many full-time people a week's hours need (40 h of a 40 h week = 1, 41 h = 2) */
export function peopleNeeded(hours: number, capacityPerPerson: number): number {
  if (hours <= 0) return 0;
  return Math.ceil(hours / (capacityPerPerson > 0 ? capacityPerPerson : 40) - 1e-9);
}

export class ResourceService {
  // --- Auto-link resource to user by email ---

  private async autoLinkUser(resourceId: string, email: string | undefined, clearIfNoMatch = false): Promise<void> {
    if (!email) {
      if (clearIfNoMatch) {
        try { await databaseService.query('UPDATE resources SET user_id = NULL WHERE id = ?', [resourceId]); } catch {}
      }
      return;
    }
    const ctx = getRequestContext();
    if (!ctx?.organizationId) return;
    try {
      const [user] = await databaseService.queryControlPlane<{ id: string }>(
        'SELECT id FROM users WHERE LOWER(email) = LOWER(?) AND organization_id = ? LIMIT 1',
        [email, ctx.organizationId],
      );
      if (user) {
        await databaseService.query('UPDATE resources SET user_id = ? WHERE id = ?', [user.id, resourceId]);
      } else if (clearIfNoMatch) {
        await databaseService.query('UPDATE resources SET user_id = NULL WHERE id = ?', [resourceId]);
      }
    } catch {
      // Fire-and-forget — don't break resource CRUD if linking fails
    }
  }

  // --- Resource CRUD ---

  async findAllResources(): Promise<Resource[]> {
    return resourceRepository.findAllOrdered();
  }

  async findAllResourcesPaginated(
    limit = 50,
    offset = 0,
    group?: string,
  ): Promise<{ resources: Resource[]; total: number }> {
    return resourceRepository.findAllPaginated(limit, offset, group);
  }

  /** The company owner — the default line manager */
  private async companyOwnerId(): Promise<string | null> {
    const orgId = getRequestContext()?.organizationId;
    if (!orgId) return null;
    const [org] = await databaseService.queryControlPlane<{ owner_user_id: string }>('SELECT owner_user_id FROM organizations WHERE id = ? LIMIT 1', [orgId]);
    return org?.owner_user_id ?? null;
  }

  /** A line manager is an active user of this company; nobody manages themselves except the owner */
  private async assertLineManager(lineManagerUserId: string, ownUserId: string | null): Promise<void> {
    const orgId = getRequestContext()?.organizationId;
    if (!orgId) return; // system jobs outside a company (scripts) — nothing to check against
    const [user] = await databaseService.queryControlPlane<{ id: string; is_active: number }>(
      'SELECT id, is_active FROM users WHERE id = ? AND organization_id = ? LIMIT 1', [lineManagerUserId, orgId]);
    if (!user || !Number(user.is_active)) throw new ResourceValidationError("That line manager isn't an active user of your company. Choose someone with a login.");
    if (ownUserId && ownUserId === lineManagerUserId && ownUserId !== await this.companyOwnerId()) {
      throw new ResourceValidationError("Someone can't be their own line manager — they'd approve their own timesheets. Choose someone else.");
    }
  }

  async findResourcesByIds(ids: string[]): Promise<Resource[]> {
    return resourceRepository.findByIds(ids);
  }

  async findResourceById(id: string): Promise<Resource | null> {
    return resourceRepository.findById(id);
  }

  async createResource(data: Omit<Resource, 'id'>): Promise<Resource> {
    // Every person has an email; a generic role never does (and never links to a login)
    if (data.isGeneric) data = { ...data, email: '', userId: null, lineManagerUserId: null, lineManagerIsDefault: false };
    else if (!data.email?.trim()) throw new ResourceValidationError(EMAIL_REQUIRED_MESSAGE);
    // Every person has a line manager: the one chosen (checked), else the company owner, to check
    if (!data.isGeneric) {
      if (data.lineManagerUserId) {
        await this.assertLineManager(data.lineManagerUserId, data.userId ?? null);
        data = { ...data, lineManagerIsDefault: false };
      } else {
        data = { ...data, lineManagerUserId: await this.companyOwnerId(), lineManagerIsDefault: true };
      }
    }
    const resource = await resourceRepository.create(data);
    this.autoLinkUser(resource.id, resource.email).catch(() => {});
    return resource;
  }

  async updateResource(id: string, data: Partial<Omit<Resource, 'id'>>): Promise<Resource | null> {
    const existing = await resourceRepository.findById(id);
    if (!existing) return null;

    // Whether a resource is a person or a generic role is fixed when it's created
    const { isGeneric: _ignored, ...rest } = data;
    data = rest;
    if (existing.isGeneric) { delete data.email; delete data.userId; delete data.lineManagerUserId; }
    else if ('email' in data && !data.email?.trim()) throw new ResourceValidationError(EMAIL_REQUIRED_MESSAGE);
    // Changing or confirming the line manager: it must be a user of this company, and it can't be
    // removed. Saving it (even unchanged) counts as checked.
    delete data.lineManagerIsDefault;
    if (!existing.isGeneric && 'lineManagerUserId' in data) {
      if (!data.lineManagerUserId) throw new ResourceValidationError(LINE_MANAGER_REQUIRED_MESSAGE);
      await this.assertLineManager(data.lineManagerUserId, data.userId !== undefined ? data.userId : existing.userId);
      data.lineManagerIsDefault = false;
    }

    const changed = await resourceRepository.updateResource(id, data);
    if (!changed) return existing;

    const updated = (await resourceRepository.findById(id))!;

    // Re-link user if email changed — clear user_id if new email doesn't match any user
    if (data.email && data.email !== existing.email) {
      this.autoLinkUser(id, data.email, true).catch(() => {});
    }

    // A different rate (or role, for the rate card) re-prices the plans they're on
    if (['costRateHourly', 'overtimeRateHourly', 'useRateCard', 'role', 'capacityHoursPerWeek'].some(k => k in data && (data as any)[k] !== (existing as any)[k])) {
      personRatesChanged(id);
    }

    auditLedgerService.append({
      actorId: 'system',
      actorType: 'system',
      action: 'resource.update',
      entityType: 'resource',
      entityId: id,
      payload: { before: existing, after: updated, changes: data },
      source: getActorSource(),
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return updated;
  }

  async deleteResource(id: string): Promise<boolean> {
    return resourceRepository.deleteResource(id);
  }

  async deleteResources(ids: string[]): Promise<number> {
    return resourceRepository.deleteResources(ids);
  }

  // --- Skill-based search ---

  async findAllDistinctSkillNames(): Promise<string[]> {
    return resourceRepository.findAllDistinctSkillNames();
  }

  async findBySkill(skillName: string, minLevel?: number): Promise<Resource[]> {
    return resourceRepository.findBySkill(skillName, minLevel);
  }

  // --- Assignment CRUD ---

  async findAssignmentsBySchedule(scheduleId: string): Promise<ResourceAssignment[]> {
    return resourceRepository.findAssignmentsBySchedule(scheduleId);
  }

  async findAssignmentsByResource(resourceId: string): Promise<ResourceAssignment[]> {
    return resourceRepository.findAssignmentsByResource(resourceId);
  }

  async findAllAssignments(): Promise<ResourceAssignment[]> {
    return resourceRepository.findAllAssignments();
  }

  /** Every booking of people's time (hours bookings, people + % on tasks, "Assigned to") — see the repository */
  async findEffectiveAssignments(filter: { scheduleIds?: string[]; resourceId?: string; from?: string; to?: string; includeDone?: boolean } = {}): Promise<ResourceAssignment[]> {
    return resourceRepository.findEffectiveAssignments(filter);
  }

  /**
   * "Would this booking push the person over 100%?" — for the task form and the Assigned To
   * cell, before/after saving. Same numbers as the Workload Heatmap: every live booking of the
   * person (minus this task's own, so an edit isn't counted twice) plus this one at `allocationPct`
   * of their weekly capacity, per Monday week, against that week's capacity (holidays lower it).
   * Returns only the weeks over 100%.
   */
  async checkLoad(input: { resourceId: string; startDate: string; endDate: string; allocationPct: number; excludeTaskId?: string }): Promise<{
    resourceId: string; resourceName: string;
    overWeeks: Array<{ weekStart: string; utilization: number; hours: number; capacity: number; otherTaskIds: string[] }>;
  } | null> {
    const resource = await resourceRepository.findById(input.resourceId);
    if (!resource) return null;
    // A generic role stands for however many people the work needs — it's never over-booked
    if (resource.isGeneric) return { resourceId: resource.id, resourceName: resource.name, overWeeks: [] };
    const mine = (resource.capacityHoursPerWeek || 40) * Math.max(0, Math.min(100, input.allocationPct)) / 100;
    const task = input.excludeTaskId ? await scheduleService.findTaskById(input.excludeTaskId).catch(() => null) : null;
    const isWorking = task?.scheduleId ? await scheduleService.workingDayTest(task.scheduleId).catch(() => weekdaysOnly) : weekdaysOnly;
    const overWeeks = await this.overWeeks(resource, [{ taskId: input.excludeTaskId ?? '', startDate: input.startDate, endDate: input.endDate, hoursPerWeek: mine }], isWorking);
    return { resourceId: resource.id, resourceName: resource.name, overWeeks };
  }

  /**
   * The Replace dialog's warning: would taking over these tasks from `fromId` push `toId` over
   * 100%? The tasks' hours move across scaled to the new person's week (50% of a 40 h week is
   * 50% of a 30 h week), and the tasks overlapping each other count together.
   */
  async checkReplaceLoad(input: { fromId: string; toId: string; scheduleId: string; taskIds: string[] }): Promise<{
    resourceId: string; resourceName: string;
    overWeeks: Array<{ weekStart: string; utilization: number; hours: number; capacity: number; otherTaskIds: string[] }>;
  } | null> {
    const [from, to] = await Promise.all([resourceRepository.findById(input.fromId), resourceRepository.findById(input.toId)]);
    if (!from || !to) return null;
    if (to.isGeneric) return { resourceId: to.id, resourceName: to.name, overWeeks: [] };
    const wanted = new Set(input.taskIds);
    const scale = (to.capacityHoursPerWeek || 40) / (from.capacityHoursPerWeek || 40);
    const moving = (await resourceRepository.findEffectiveAssignments({ resourceId: from.id, scheduleIds: [input.scheduleId] }))
      .filter(a => wanted.has(a.taskId))
      .map(a => ({ taskId: a.taskId, startDate: a.startDate, endDate: a.endDate, hoursPerWeek: a.hoursPerWeek * scale }));
    const isWorking = await scheduleService.workingDayTest(input.scheduleId).catch(() => weekdaysOnly);
    return { resourceId: to.id, resourceName: to.name, overWeeks: await this.overWeeks(to, moving, isWorking) };
  }

  /** Weeks over 100% for this person: their live bookings (minus the tasks in `extra`) plus `extra` */
  private async overWeeks(resource: Resource, extra: Array<{ taskId: string; startDate: string; endDate: string; hoursPerWeek: number }>, isWorking: IsWorking = weekdaysOnly) {
    const overWeeks: Array<{ weekStart: string; utilization: number; hours: number; capacity: number; otherTaskIds: string[] }> = [];
    if (extra.length === 0) return overWeeks;
    const start = extra.map(e => e.startDate.slice(0, 10)).sort()[0];
    const end = extra.map(e => (e.endDate.slice(0, 10) < e.startDate.slice(0, 10) ? e.startDate : e.endDate).slice(0, 10)).sort().reverse()[0];
    const DAY = 86_400_000;
    const at = (d: string) => Date.parse(`${d}T00:00:00Z`);
    const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
    const first = at(start) - ((new Date(at(start)).getUTCDay() + 6) % 7) * DAY; // Monday
    const weekStarts: string[] = [];
    for (let t = first; t <= at(end) && weekStarts.length < 104; t += 7 * DAY) weekStarts.push(iso(t));
    const lastDay = iso(at(weekStarts[weekStarts.length - 1]) + 6 * DAY);

    // An edit isn't counted twice: the person's own booking on these tasks is replaced by `extra`
    const own = new Set(extra.map(e => e.taskId).filter(Boolean));
    const others = (await resourceRepository.findEffectiveAssignments({ resourceId: resource.id, from: weekStarts[0], to: lastDay }))
      .filter(a => !own.has(a.taskId));
    const capacityMap = await resourceAvailabilityService.getEffectiveCapacityBatch(
      [{ id: resource.id, capacityHoursPerWeek: resource.capacityHoursPerWeek, calendarTemplateId: resource.calendarTemplateId }],
      weekStarts.map(w => new Date(at(w))),
    );
    // Each booking counts only the working days it covers that week, on its plan's calendar
    const calOf = await calendarsFor(others.map(a => a.scheduleId), (id) => scheduleService.workingDayTest(id));
    const inWeek = (w: string, wEnd: string) => (a: { startDate: string; endDate: string }) => a.startDate.slice(0, 10) <= wEnd && a.endDate.slice(0, 10) >= w;
    for (const w of weekStarts) {
      const wEnd = iso(at(w) + 6 * DAY);
      const hits = others.filter(inWeek(w, wEnd)).filter(a => hoursInWeek(a, w, calOf(a.scheduleId)) > 0);
      const added = extra.filter(inWeek(w, wEnd)).filter(a => hoursInWeek(a, w, isWorking) > 0);
      const hours = Math.round((hits.reduce((s, a) => s + hoursInWeek(a, w, calOf(a.scheduleId)), 0) + added.reduce((s, a) => s + hoursInWeek(a, w, isWorking), 0)) * 10) / 10;
      const capacity = capacityMap.get(resource.id)?.get(w) ?? resource.capacityHoursPerWeek;
      const utilization = capacity > 0 ? Math.round((hours / capacity) * 100) : (hours > 0 ? 999 : 0);
      if (utilization > 100) overWeeks.push({ weekStart: w, utilization, hours, capacity, // what else is in that week: their other work, plus the other added tasks it overlaps
        otherTaskIds: [...new Set([...hits, ...(added.length > 1 ? added : [])].map(a => a.taskId).filter(Boolean))] });
    }
    return overWeeks;
  }

  async checkAssignmentConflicts(data: {
    resourceId: string;
    hoursPerWeek: number;
    startDate: string;
    endDate: string;
    /** The task being booked: the person's existing booking on it is replaced, not added to */
    taskId?: string;
  }): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];
    const resource = await resourceRepository.findById(data.resourceId);
    if (!resource) return { warnings };
    if (resource.isGeneric) return { warnings };

    // Week by week, each booking counting only the working days it covers (an hours booking
    // across months used to be added to every other booking in the range, overlapping or not)
    const over = await this.overWeeks(resource, [{ taskId: data.taskId ?? '', startDate: data.startDate, endDate: data.endDate, hoursPerWeek: data.hoursPerWeek }]);
    if (over.length > 0) {
      const worst = over.reduce((m, w) => (w.utilization > m.utilization ? w : m));
      warnings.push(
        `Resource '${resource.name}' would be allocated ${worst.hours}h against ${worst.capacity}h capacity (${worst.utilization}% utilization) in the week of ${worst.weekStart}${over.length > 1 ? ` and ${over.length - 1} other week${over.length === 2 ? '' : 's'}` : ''}`,
      );
    }

    return { warnings };
  }

  async createAssignment(data: Omit<ResourceAssignment, 'id'>): Promise<{ assignment: ResourceAssignment; warnings: string[] }> {
    const { warnings } = await this.checkAssignmentConflicts(data);

    const assignment = await resourceRepository.createAssignment(data);

    auditLedgerService.append({
      actorId: 'system',
      actorType: 'system',
      action: 'resource.assign',
      entityType: 'resource_assignment',
      entityId: assignment.id,
      payload: { after: assignment, warnings },
      source: getActorSource(),
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    // An hours booking changes the task's planned cost: refresh it (and the review) shortly
    planChanged(data.scheduleId);
    return { assignment, warnings };
  }

  async deleteAssignment(id: string): Promise<boolean> {
    const [row] = await databaseService.query<{ schedule_id: string }>('SELECT schedule_id FROM resource_assignments WHERE id = ?', [id]);
    const deleted = await resourceRepository.deleteAssignment(id);
    if (deleted && row) planChanged(row.schedule_id);
    return deleted;
  }

  // --- Workload computation ---

  /**
   * The weekly load of the people working on this project, counting ALL their live projects
   * (2026-10-02, user: "count all projects"): a person has one week however it's split. Each week
   * keeps the split (`thisProject` / `otherProjects` hours); cost stays this project's only; a
   * person is over-allocated here only in a week they also work on this project.
   * `generic` = the generic roles' load on this project instead (unfilled demand, this project only).
   */
  async computeWorkload(projectId: string, generic = false): Promise<ResourceWorkload[]> {
    const schedules = await scheduleService.findByProjectId(projectId);
    const scheduleIds = schedules.map((s) => s.id);

    if (scheduleIds.length === 0) return [];

    const projectAssignments = await resourceRepository.findEffectiveAssignments({ scheduleIds });
    const calOf = await calendarsFor(projectAssignments.map(a => a.scheduleId), (id) => scheduleService.workingDayTest(id));

    const DAY_MS = 86_400_000;
    const WEEK_MS = 7 * DAY_MS;
    let minDate = Infinity;
    let maxDate = -Infinity;

    for (const a of projectAssignments) {
      minDate = Math.min(minDate, new Date(a.startDate).getTime());
      maxDate = Math.max(maxDate, new Date(a.endDate).getTime());
    }

    if (minDate === Infinity) {
      const now = Date.now();
      minDate = now;
      maxDate = now + 12 * WEEK_MS;
    }

    // Monday of the first week, as a calendar day (local-time maths here used to start weeks on a
    // Tuesday on any machine west of UTC)
    const startWeek = new Date(`${mondayOf(new Date(minDate).toISOString())}T00:00:00Z`);

    const weeks: Date[] = [];
    for (let t = startWeek.getTime(); t <= maxDate; t += WEEK_MS) {
      weeks.push(new Date(t));
    }
    while (weeks.length < 8) {
      const last = weeks[weeks.length - 1];
      weeks.push(new Date(last.getTime() + WEEK_MS));
    }

    const involvedResourceIds = [...new Set(projectAssignments.map((a) => a.resourceId))];

    // Batch-load all resources in one query
    const resources = await resourceRepository.findByIds(involvedResourceIds);
    const resourceMap = new Map(resources.map(r => [r.id, r]));

    // The same people's work on other projects in these weeks (not for generic roles: their
    // demand is this project's)
    const here = new Set(scheduleIds);
    const people = new Set(resources.filter(r => !r.isGeneric).map(r => r.id));
    const firstDay = weeks[0].toISOString().slice(0, 10);
    const lastDay = new Date(weeks[weeks.length - 1].getTime() + 6 * DAY_MS).toISOString().slice(0, 10);
    const elsewhere = generic || people.size === 0 ? [] : (await resourceRepository.findEffectiveAssignments({ from: firstDay, to: lastDay, resourceIds: [...people] }))
      .filter(a => people.has(a.resourceId) && !here.has(a.scheduleId));
    const calOther = await calendarsFor(elsewhere.map(a => a.scheduleId), (id) => scheduleService.workingDayTest(id));
    // Rates can change over time (rate card): each week is costed at that week's rate
    const rateCard = await rateCardService.listSafe();
    const todayKey = new Date().toISOString().slice(0, 10);

    // Batch-load all availability data in one query
    const capacityMap = await resourceAvailabilityService.getEffectiveCapacityBatch(
      resources.map(r => ({ id: r.id, capacityHoursPerWeek: r.capacityHoursPerWeek, calendarTemplateId: r.calendarTemplateId })),
      weeks,
    );

    // This project's approved hours for everyone involved, in one query (it was two queries per
    // person, one person at a time — 2026-10-04 audit)
    const hoursByUser = await timeEntryRepository.sumHoursByUsersAndWeekRange(
      resources.map(r => r.userId).filter((u): u is string => !!u),
      weeks[0].toISOString().slice(0, 10),
      new Date(weeks[weeks.length - 1].getTime() + WEEK_MS).toISOString().slice(0, 10),
      projectId,
    );

    // Everyone's booked hours per week, each booking visited only for the weeks it covers (it was
    // every person × every week × all their bookings — 2026-10-08 speed test)
    const weekKeys = weeks.map(w => w.toISOString().slice(0, 10));
    // only the people this heatmap shows (people, or generic roles) — no work for skipped ones
    const shown = (a: { resourceId: string }) => { const r = resourceMap.get(a.resourceId); return !!r && !!r.isGeneric === generic; };
    const hereByWeek = bookedHoursByWeek(projectAssignments.filter(shown), weekKeys, calOf);
    const elsewhereByWeek = bookedHoursByWeek(elsewhere.filter(shown), weekKeys, calOther);

    const workloads: ResourceWorkload[] = [];

    for (const resId of involvedResourceIds) {
      const resource = resourceMap.get(resId);
      if (!resource) continue;
      // Generic roles are unfilled demand, not people: they're never over- or under-booked
      if (!!resource.isGeneric !== generic) continue;

      const resHere = hereByWeek.get(resId);
      const resElsewhere = elsewhereByWeek.get(resId);
      const baseCapacity = resource.capacityHoursPerWeek;
      const rate = ratesOn(resource, todayKey, rateCard).standard;
      let totalUtilization = 0;
      let projectUtilization = 0;
      let totalCost = 0;
      let isOverAllocated = false;

      // Pre-fetch actual hours from time entries if resource is linked to a user
      let actualByWeek: Map<string, number> | null = null;
      let rateByWeek: Map<string, { standard: number; overtime: number }> | null = null;
      if (resource.userId) {
        // This project's approved hours and their cost — not the person's other projects (it used
        // to take all their time, so a project's cost included work logged elsewhere)
        const rows = hoursByUser.get(resource.userId) ?? [];
        actualByWeek = new Map(rows.map(a => [a.weekStart, a.totalHours]));
        rateByWeek = new Map(rows.map(r => [r.weekStart, { standard: r.standardHours, overtime: r.overtimeHours }]));
      }

      const resCapacityMap = capacityMap.get(resId);

      const weeklyData: WeeklyUtilization[] = [];
      for (let i = 0; i < weeks.length; i++) {
        // Only the working days each booking covers this week count (one day of a 40 h/week
        // task is 8 h, not 40)
        const thisProject = Math.round((resHere?.[i] ?? 0) * 10) / 10;
        const otherProjects = Math.round((resElsewhere?.[i] ?? 0) * 10) / 10;
        const allocated = Math.round((thisProject + otherProjects) * 10) / 10;

        const weekKey = weekKeys[i];
        const actual = actualByWeek?.get(weekKey) ?? 0;

        const capacity = resCapacityMap?.get(weekKey) ?? baseCapacity;
        const utilization = capacity > 0 ? Math.round((allocated / capacity) * 100) : 0;
        // Over-booked HERE only in a week they also work on this project — otherwise this plan
        // can't change it
        if (utilization > 100 && thisProject > 0) isOverAllocated = true;
        totalUtilization += utilization;
        projectUtilization += capacity > 0 ? Math.round((thisProject / capacity) * 100) : 0;

        // Cost: use rate-type breakdown if available, otherwise fall back to allocated * rate
        let weeklyCost = 0;
        const rb = rateByWeek?.get(weekKey);
        const { standard: weekRate, overtime: weekOvertime } = ratesOn(resource, weekKey, rateCard);
        if (weekRate && rb && (rb.standard > 0 || rb.overtime > 0)) {
          weeklyCost = Math.round((rb.standard * weekRate + rb.overtime * (weekOvertime ?? weekRate)) * 100) / 100;
        } else if (weekRate) {
          // The money is this project's: only its own hours are costed
          weeklyCost = Math.round(thisProject * weekRate * 100) / 100;
        }
        totalCost += weeklyCost;

        weeklyData.push({
          weekStart: weekKey,
          allocated,
          thisProject,
          otherProjects,
          actual,
          capacity,
          utilization,
          cost: weeklyCost,
        });
      }

      totalCost = Math.round(totalCost * 100) / 100;

      workloads.push({
        resourceId: resId,
        resourceName: resource.name,
        role: resource.role,
        costRateHourly: rate,
        totalCost,
        weeks: weeklyData,
        averageUtilization: weeks.length > 0 ? Math.round(totalUtilization / weeks.length) : 0,
        projectAverageUtilization: weeks.length > 0 ? Math.round(projectUtilization / weeks.length) : 0,
        isOverAllocated,
      });
    }

    return workloads;
  }

  // --- Cross-project workload (#2) ---

  /**
   * Unfilled demand: work booked to generic roles, per week, as the number of people it needs
   * ("in the week of 17 Aug you need 3 developers you haven't named yet").
   */
  async computeUnfilledDemand(projectId: string): Promise<UnfilledDemand[]> {
    const rows = await this.computeWorkload(projectId, true);
    return rows.map((w) => ({
      resourceId: w.resourceId,
      resourceName: w.resourceName,
      role: w.role,
      weeks: w.weeks.map((wk) => ({ weekStart: wk.weekStart, hours: wk.allocated, people: peopleNeeded(wk.allocated, wk.capacity) })),
    }));
  }

  async computeGlobalWorkload(generic = false): Promise<ResourceWorkload[]> {
    const allAssignments = await resourceRepository.findEffectiveAssignments();
    const calOf = await calendarsFor(allAssignments.map(a => a.scheduleId), (id) => scheduleService.workingDayTest(id));
    if (allAssignments.length === 0) return [];

    const DAY_MS = 86_400_000;
    const WEEK_MS = 7 * DAY_MS;
    let minDate = Infinity;
    let maxDate = -Infinity;

    for (const a of allAssignments) {
      minDate = Math.min(minDate, new Date(a.startDate).getTime());
      maxDate = Math.max(maxDate, new Date(a.endDate).getTime());
    }

    if (minDate === Infinity) {
      const now = Date.now();
      minDate = now;
      maxDate = now + 12 * WEEK_MS;
    }

    // Monday of the first week, as a calendar day (local-time maths here used to start weeks on a
    // Tuesday on any machine west of UTC)
    const startWeek = new Date(`${mondayOf(new Date(minDate).toISOString())}T00:00:00Z`);

    const weeks: Date[] = [];
    for (let t = startWeek.getTime(); t <= maxDate; t += WEEK_MS) {
      weeks.push(new Date(t));
    }
    while (weeks.length < 8) {
      const last = weeks[weeks.length - 1];
      weeks.push(new Date(last.getTime() + WEEK_MS));
    }

    const involvedResourceIds = [...new Set(allAssignments.map((a) => a.resourceId))];

    // Batch-load all resources and availability
    const resources = await resourceRepository.findByIds(involvedResourceIds);
    const resourceMap = new Map(resources.map(r => [r.id, r]));
    // Rates can change over time (rate card): each week is costed at that week's rate
    const rateCard = await rateCardService.listSafe();
    const todayKey = new Date().toISOString().slice(0, 10);
    const capacityMap = await resourceAvailabilityService.getEffectiveCapacityBatch(
      resources.map(r => ({ id: r.id, capacityHoursPerWeek: r.capacityHoursPerWeek, calendarTemplateId: r.calendarTemplateId })),
      weeks,
    );

    // Everyone's approved hours in one query (was one query per person — 2026-10-04 audit)
    const hoursByUser = await timeEntryRepository.sumHoursByUsersAndWeekRange(
      resources.map(r => r.userId).filter((u): u is string => !!u),
      weeks[0].toISOString().slice(0, 10),
      new Date(weeks[weeks.length - 1].getTime() + WEEK_MS).toISOString().slice(0, 10),
    );

    // Everyone's booked hours per week, each booking visited only for the weeks it covers (it was
    // every person × every week × all their bookings — 2026-10-08 speed test)
    const weekKeys = weeks.map(w => w.toISOString().slice(0, 10));
    // only the people this heatmap shows (people, or generic roles) — no work for skipped ones
    const shown = (a: { resourceId: string }) => { const r = resourceMap.get(a.resourceId); return !!r && !!r.isGeneric === generic; };
    const bookedByWeek = bookedHoursByWeek(allAssignments.filter(shown), weekKeys, calOf);

    const workloads: ResourceWorkload[] = [];

    for (const resId of involvedResourceIds) {
      const resource = resourceMap.get(resId);
      if (!resource) continue;
      // Generic roles are unfilled demand, not people: they're never over- or under-booked
      if (!!resource.isGeneric !== generic) continue;

      const resBooked = bookedByWeek.get(resId);
      const baseCapacity = resource.capacityHoursPerWeek;
      const rate = ratesOn(resource, todayKey, rateCard).standard;
      let totalUtilization = 0;
      let totalCost = 0;
      let isOverAllocated = false;

      let actualByWeek: Map<string, number> | null = null;
      if (resource.userId) {
        actualByWeek = new Map((hoursByUser.get(resource.userId) ?? []).map(a => [a.weekStart, a.totalHours]));
      }

      const resCapacityMap = capacityMap.get(resId);

      const weeklyData: WeeklyUtilization[] = [];
      for (let i = 0; i < weeks.length; i++) {
        // Only the working days each booking covers this week count (one day of a 40 h/week
        // task is 8 h, not 40)
        const allocated = Math.round((resBooked?.[i] ?? 0) * 10) / 10;

        const weekKey = weekKeys[i];
        const actual = actualByWeek?.get(weekKey) ?? 0;
        const capacity = resCapacityMap?.get(weekKey) ?? baseCapacity;
        const utilization = capacity > 0 ? Math.round((allocated / capacity) * 100) : 0;
        if (utilization > 100) isOverAllocated = true;
        totalUtilization += utilization;

        const weekRate = ratesOn(resource, weekKey, rateCard).standard;
        const weeklyCost = weekRate ? Math.round(allocated * weekRate * 100) / 100 : 0;
        totalCost += weeklyCost;

        weeklyData.push({ weekStart: weekKey, allocated, actual, capacity, utilization, cost: weeklyCost });
      }

      totalCost = Math.round(totalCost * 100) / 100;

      workloads.push({
        resourceId: resId,
        resourceName: resource.name,
        role: resource.role,
        costRateHourly: rate,
        totalCost,
        weeks: weeklyData,
        averageUtilization: weeks.length > 0 ? Math.round(totalUtilization / weeks.length) : 0,
        isOverAllocated,
      });
    }

    return workloads;
  }

  // --- Utilization history (#6) ---

  async computeUtilizationHistory(resourceId: string, numWeeks = 12): Promise<{
    weeks: Array<{ weekStart: string; planned: number; actual: number; capacity: number; utilization: number }>;
  }> {
    const resource = await resourceRepository.findById(resourceId);
    if (!resource) return { weeks: [] };

    const DAY_MS = 86_400_000;
    const WEEK_MS = 7 * DAY_MS;
    // This week's Monday as a calendar day (local-time maths gave a different day off UTC)
    const currentWeekStart = new Date(`${mondayOf(new Date().toISOString())}T00:00:00Z`);

    const weekStarts: Date[] = [];
    for (let i = numWeeks - 1; i >= 0; i--) {
      weekStarts.push(new Date(currentWeekStart.getTime() - i * WEEK_MS));
    }

    const firstWeek = weekStarts[0].toISOString().slice(0, 10);
    const lastWeekEnd = new Date(weekStarts[weekStarts.length - 1].getTime() + WEEK_MS).toISOString().slice(0, 10);

    // Get all assignments overlapping the date range
    // Past weeks: what was planned then, finished work included
    const assignments = await resourceRepository.findEffectiveAssignments({ resourceId, from: firstWeek, to: lastWeekEnd, includeDone: true });
    const calOf = await calendarsFor(assignments.map(a => a.scheduleId), (id) => scheduleService.workingDayTest(id));

    // Get actual hours if user linked
    let actualByWeek: Map<string, number> | null = null;
    if (resource.userId) {
      const actuals = await timeEntryRepository.sumHoursByUserAndWeekRange(resource.userId, firstWeek, lastWeekEnd);
      actualByWeek = new Map(actuals.map(a => [a.weekStart, a.totalHours]));
    }

    const baseCapacity = resource.capacityHoursPerWeek;
    const result: Array<{ weekStart: string; planned: number; actual: number; capacity: number; utilization: number }> = [];

    for (const ws of weekStarts) {
      const weekEnd = new Date(ws.getTime() + WEEK_MS);
      let planned = 0;

      const wk = ws.toISOString().slice(0, 10);
      for (const a of assignments) planned += hoursInWeek(a, wk, calOf(a.scheduleId));
      planned = Math.round(planned * 10) / 10;

      const weekKey = ws.toISOString().slice(0, 10);
      const actual = actualByWeek?.get(weekKey) ?? 0;
      const capacity = await resourceAvailabilityService.getEffectiveCapacity(resourceId, ws, baseCapacity);
      const utilization = capacity > 0 ? Math.round((planned / capacity) * 100) : 0;

      result.push({ weekStart: weekKey, planned, actual, capacity, utilization });
    }

    return { weeks: result };
  }
}

export const resourceService = new ResourceService();
