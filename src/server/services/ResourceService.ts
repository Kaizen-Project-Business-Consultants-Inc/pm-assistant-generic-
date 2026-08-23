import { resourceRepository } from '../database/ResourceRepository';
import { scheduleService } from './ScheduleService';
import { auditLedgerService } from './AuditLedgerService';
import { resourceAvailabilityService } from './ResourceAvailabilityService';
import { deadLetterService } from './DeadLetterService';
import { timeEntryRepository } from '../database/TimeEntryRepository';

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
  resourceGroup: string | null;
  userId: string | null;
  calendarTemplateId: string | null;
}

export interface ResourceAssignment {
  id: string;
  resourceId: string;
  taskId: string;
  scheduleId: string;
  hoursPerWeek: number;
  startDate: string;
  endDate: string;
}

export interface WeeklyUtilization {
  weekStart: string;
  allocated: number;
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
  isOverAllocated: boolean;
}

export class ResourceService {
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

  async findResourceById(id: string): Promise<Resource | null> {
    return resourceRepository.findById(id);
  }

  async createResource(data: Omit<Resource, 'id'>): Promise<Resource> {
    return resourceRepository.create(data);
  }

  async updateResource(id: string, data: Partial<Omit<Resource, 'id'>>): Promise<Resource | null> {
    const existing = await resourceRepository.findById(id);
    if (!existing) return null;

    const changed = await resourceRepository.updateResource(id, data);
    if (!changed) return existing;

    const updated = (await resourceRepository.findById(id))!;

    auditLedgerService.append({
      actorId: 'system',
      actorType: 'system',
      action: 'resource.update',
      entityType: 'resource',
      entityId: id,
      payload: { before: existing, after: updated, changes: data },
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return updated;
  }

  async deleteResource(id: string): Promise<boolean> {
    return resourceRepository.deleteResource(id);
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

  async checkAssignmentConflicts(data: {
    resourceId: string;
    hoursPerWeek: number;
    startDate: string;
    endDate: string;
    excludeAssignmentId?: string;
  }): Promise<{ warnings: string[] }> {
    const warnings: string[] = [];
    const resource = await resourceRepository.findById(data.resourceId);
    if (!resource) return { warnings };

    const overlapping = await resourceRepository.findOverlappingAssignments(
      data.resourceId, data.startDate, data.endDate, data.excludeAssignmentId,
    );

    const existingHours = overlapping.reduce((sum, a) => sum + a.hoursPerWeek, 0);
    const totalHours = existingHours + data.hoursPerWeek;
    const capacity = resource.capacityHoursPerWeek;

    if (totalHours > capacity) {
      const pct = Math.round((totalHours / capacity) * 100);
      warnings.push(
        `Resource '${resource.name}' would be allocated ${totalHours}h/week against ${capacity}h capacity (${pct}% utilization) during ${data.startDate} to ${data.endDate}`,
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
      source: 'web',
    }).catch(err => deadLetterService.capture('audit.append', {}, err));

    return { assignment, warnings };
  }

  async deleteAssignment(id: string): Promise<boolean> {
    return resourceRepository.deleteAssignment(id);
  }

  // --- Workload computation ---

  async computeWorkload(projectId: string): Promise<ResourceWorkload[]> {
    const schedules = await scheduleService.findByProjectId(projectId);
    const scheduleIds = schedules.map((s) => s.id);

    if (scheduleIds.length === 0) return [];

    const projectAssignments = await resourceRepository.findAssignmentsByScheduleIds(scheduleIds);

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

    const startWeek = new Date(minDate);
    startWeek.setDate(startWeek.getDate() - ((startWeek.getDay() + 6) % 7));

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

    // Batch-load all availability data in one query
    const capacityMap = await resourceAvailabilityService.getEffectiveCapacityBatch(
      resources.map(r => ({ id: r.id, capacityHoursPerWeek: r.capacityHoursPerWeek, calendarTemplateId: r.calendarTemplateId })),
      weeks,
    );

    const workloads: ResourceWorkload[] = [];

    for (const resId of involvedResourceIds) {
      const resource = resourceMap.get(resId);
      if (!resource) continue;

      const resAssignments = projectAssignments.filter((a) => a.resourceId === resId);
      const baseCapacity = resource.capacityHoursPerWeek;
      const rate = resource.costRateHourly;
      let totalUtilization = 0;
      let totalCost = 0;
      let isOverAllocated = false;

      // Pre-fetch actual hours from time entries if resource is linked to a user
      let actualByWeek: Map<string, number> | null = null;
      let rateByWeek: Map<string, { standard: number; overtime: number }> | null = null;
      if (resource.userId) {
        const firstWeek = weeks[0].toISOString().slice(0, 10);
        const lastWeekEnd = new Date(weeks[weeks.length - 1].getTime() + WEEK_MS).toISOString().slice(0, 10);
        const actuals = await timeEntryRepository.sumHoursByUserAndWeekRange(resource.userId, firstWeek, lastWeekEnd);
        actualByWeek = new Map(actuals.map(a => [a.weekStart, a.totalHours]));
        // Fetch rate-type breakdown for cost calculation
        const rateBreakdown = await timeEntryRepository.sumHoursByRateTypeAndWeekRange(resource.userId, firstWeek, lastWeekEnd);
        rateByWeek = new Map(rateBreakdown.map(r => [r.weekStart, { standard: r.standardHours, overtime: r.overtimeHours }]));
      }

      const overtimeRate = resource.overtimeRateHourly ?? (rate ? rate * 1.5 : null);
      const resCapacityMap = capacityMap.get(resId);

      const weeklyData: WeeklyUtilization[] = [];
      for (const weekStart of weeks) {
        const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
        let allocated = 0;

        for (const a of resAssignments) {
          const aStart = new Date(a.startDate).getTime();
          const aEnd = new Date(a.endDate).getTime();
          if (aStart < weekEnd.getTime() && aEnd >= weekStart.getTime()) {
            allocated += a.hoursPerWeek;
          }
        }

        const weekKey = weekStart.toISOString().slice(0, 10);
        const actual = actualByWeek?.get(weekKey) ?? 0;

        const capacity = resCapacityMap?.get(weekKey) ?? baseCapacity;
        const utilization = capacity > 0 ? Math.round((allocated / capacity) * 100) : 0;
        if (utilization > 100) isOverAllocated = true;
        totalUtilization += utilization;

        // Cost: use rate-type breakdown if available, otherwise fall back to allocated * rate
        let weeklyCost = 0;
        const rb = rateByWeek?.get(weekKey);
        if (rate && rb && (rb.standard > 0 || rb.overtime > 0)) {
          weeklyCost = Math.round((rb.standard * rate + rb.overtime * (overtimeRate ?? rate)) * 100) / 100;
        } else if (rate) {
          weeklyCost = Math.round(allocated * rate * 100) / 100;
        }
        totalCost += weeklyCost;

        weeklyData.push({
          weekStart: weekKey,
          allocated,
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
        isOverAllocated,
      });
    }

    return workloads;
  }

  // --- Cross-project workload (#2) ---

  async computeGlobalWorkload(): Promise<ResourceWorkload[]> {
    const allAssignments = await resourceRepository.findAllAssignments();
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

    const startWeek = new Date(minDate);
    startWeek.setDate(startWeek.getDate() - ((startWeek.getDay() + 6) % 7));

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
    const capacityMap = await resourceAvailabilityService.getEffectiveCapacityBatch(
      resources.map(r => ({ id: r.id, capacityHoursPerWeek: r.capacityHoursPerWeek, calendarTemplateId: r.calendarTemplateId })),
      weeks,
    );

    const workloads: ResourceWorkload[] = [];

    for (const resId of involvedResourceIds) {
      const resource = resourceMap.get(resId);
      if (!resource) continue;

      const resAssignments = allAssignments.filter((a) => a.resourceId === resId);
      const baseCapacity = resource.capacityHoursPerWeek;
      const rate = resource.costRateHourly;
      let totalUtilization = 0;
      let totalCost = 0;
      let isOverAllocated = false;

      let actualByWeek: Map<string, number> | null = null;
      if (resource.userId) {
        const firstWeek = weeks[0].toISOString().slice(0, 10);
        const lastWeekEnd = new Date(weeks[weeks.length - 1].getTime() + WEEK_MS).toISOString().slice(0, 10);
        const actuals = await timeEntryRepository.sumHoursByUserAndWeekRange(resource.userId, firstWeek, lastWeekEnd);
        actualByWeek = new Map(actuals.map(a => [a.weekStart, a.totalHours]));
      }

      const resCapacityMap = capacityMap.get(resId);

      const weeklyData: WeeklyUtilization[] = [];
      for (const weekStart of weeks) {
        const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
        let allocated = 0;

        for (const a of resAssignments) {
          const aStart = new Date(a.startDate).getTime();
          const aEnd = new Date(a.endDate).getTime();
          if (aStart < weekEnd.getTime() && aEnd >= weekStart.getTime()) {
            allocated += a.hoursPerWeek;
          }
        }

        const weekKey = weekStart.toISOString().slice(0, 10);
        const actual = actualByWeek?.get(weekKey) ?? 0;
        const capacity = resCapacityMap?.get(weekKey) ?? baseCapacity;
        const utilization = capacity > 0 ? Math.round((allocated / capacity) * 100) : 0;
        if (utilization > 100) isOverAllocated = true;
        totalUtilization += utilization;

        const weeklyCost = rate ? Math.round(allocated * rate * 100) / 100 : 0;
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
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(currentWeekStart.getDate() - ((currentWeekStart.getDay() + 6) % 7));

    const weekStarts: Date[] = [];
    for (let i = numWeeks - 1; i >= 0; i--) {
      weekStarts.push(new Date(currentWeekStart.getTime() - i * WEEK_MS));
    }

    const firstWeek = weekStarts[0].toISOString().slice(0, 10);
    const lastWeekEnd = new Date(weekStarts[weekStarts.length - 1].getTime() + WEEK_MS).toISOString().slice(0, 10);

    // Get all assignments overlapping the date range
    const assignments = await resourceRepository.findOverlappingAssignments(resourceId, firstWeek, lastWeekEnd);

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

      for (const a of assignments) {
        const aStart = new Date(a.startDate).getTime();
        const aEnd = new Date(a.endDate).getTime();
        if (aStart < weekEnd.getTime() && aEnd >= ws.getTime()) {
          planned += a.hoursPerWeek;
        }
      }

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
