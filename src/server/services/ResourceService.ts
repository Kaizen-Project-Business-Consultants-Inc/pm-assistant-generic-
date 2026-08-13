import { resourceRepository } from '../database/ResourceRepository';
import { scheduleService } from './ScheduleService';
import { auditLedgerService } from './AuditLedgerService';
import { resourceAvailabilityService } from './ResourceAvailabilityService';
import { deadLetterService } from './DeadLetterService';

export interface Resource {
  id: string;
  name: string;
  role: string;
  email: string;
  capacityHoursPerWeek: number;
  skills: string[];
  isActive: boolean;
  costRateHourly: number | null;
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
  ): Promise<{ resources: Resource[]; total: number }> {
    return resourceRepository.findAllPaginated(limit, offset);
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

    const workloads: ResourceWorkload[] = [];

    for (const resId of involvedResourceIds) {
      const resource = await resourceRepository.findById(resId);
      if (!resource) continue;

      const resAssignments = projectAssignments.filter((a) => a.resourceId === resId);
      const baseCapacity = resource.capacityHoursPerWeek;
      const rate = resource.costRateHourly;
      let totalUtilization = 0;
      let totalCost = 0;
      let isOverAllocated = false;

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

        const capacity = await resourceAvailabilityService.getEffectiveCapacity(resId, weekStart, baseCapacity);
        const utilization = capacity > 0 ? Math.round((allocated / capacity) * 100) : 0;
        if (utilization > 100) isOverAllocated = true;
        totalUtilization += utilization;

        const weeklyCost = rate ? Math.round(allocated * rate * 100) / 100 : 0;
        totalCost += weeklyCost;

        weeklyData.push({
          weekStart: weekStart.toISOString().slice(0, 10),
          allocated,
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
}

export const resourceService = new ResourceService();
