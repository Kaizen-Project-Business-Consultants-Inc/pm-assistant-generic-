import { resourceAvailabilityRepository, ResourceAvailability } from '../database/ResourceAvailabilityRepository';
import { calendarTemplateRepository } from '../database/CalendarTemplateRepository';
import { MS_PER_DAY } from '../utils/constants';

export type { ResourceAvailability } from '../database/ResourceAvailabilityRepository';

export class ResourceAvailabilityService {
  async findByResource(resourceId: string, dateFrom?: string, dateTo?: string): Promise<ResourceAvailability[]> {
    return resourceAvailabilityRepository.findByResource(resourceId, dateFrom, dateTo);
  }

  async findById(id: string): Promise<ResourceAvailability | null> {
    return resourceAvailabilityRepository.findById(id);
  }

  async create(data: {
    resourceId: string;
    dateFrom: string;
    dateTo: string;
    type: 'vacation' | 'holiday' | 'unavailable' | 'reduced';
    hoursAvailable?: number;
    note?: string;
  }): Promise<ResourceAvailability> {
    return resourceAvailabilityRepository.insert(data);
  }

  async update(id: string, data: {
    dateFrom?: string;
    dateTo?: string;
    type?: 'vacation' | 'holiday' | 'unavailable' | 'reduced';
    hoursAvailable?: number | null;
    note?: string | null;
  }): Promise<ResourceAvailability | null> {
    const existing = await resourceAvailabilityRepository.findById(id);
    if (!existing) return null;
    return resourceAvailabilityRepository.update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return resourceAvailabilityRepository.deleteById(id);
  }

  async getEffectiveCapacity(resourceId: string, weekStart: Date, baseCapacity: number, calendarTemplateId?: string | null): Promise<number> {
    // Determine working days and hours from calendar template if provided
    let workingDaysCount = 5;
    let hoursPerDay = baseCapacity / 5;
    if (calendarTemplateId) {
      const template = await calendarTemplateRepository.findById(calendarTemplateId);
      if (template) {
        workingDaysCount = template.workingDays.length;
        hoursPerDay = template.hoursPerDay;
        baseCapacity = workingDaysCount * hoursPerDay;
      }
    }

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const blocks = await resourceAvailabilityRepository.findOverlapping(
      resourceId,
      weekEnd.toISOString().slice(0, 10),
      weekStart.toISOString().slice(0, 10),
    );

    if (blocks.length === 0) return baseCapacity;

    let unavailableDays = 0;
    let reducedHoursTotal = 0;
    let reducedDays = 0;

    for (const block of blocks) {
      const blockStart = new Date(Math.max(new Date(block.dateFrom).getTime(), weekStart.getTime()));
      const blockEnd = new Date(Math.min(new Date(block.dateTo).getTime(), weekEnd.getTime()));
      const overlapDays = Math.max(0, Math.ceil((blockEnd.getTime() - blockStart.getTime()) / MS_PER_DAY) + 1);

      if (block.type === 'reduced' && block.hoursAvailable != null) {
        reducedDays += overlapDays;
        reducedHoursTotal += block.hoursAvailable * overlapDays;
      } else {
        unavailableDays += overlapDays;
      }
    }

    const available = Math.max(0, baseCapacity - (unavailableDays * hoursPerDay));

    if (reducedDays > 0) {
      return Math.max(0, available - (reducedDays * hoursPerDay) + reducedHoursTotal);
    }

    return available;
  }
  /**
   * Batch-compute effective capacity for multiple resources across multiple weeks.
   * Returns Map<resourceId, Map<weekKey, capacity>>
   */
  async getEffectiveCapacityBatch(
    resources: Array<{ id: string; capacityHoursPerWeek: number; calendarTemplateId?: string | null }>,
    weeks: Date[],
  ): Promise<Map<string, Map<string, number>>> {
    const result = new Map<string, Map<string, number>>();
    if (resources.length === 0 || weeks.length === 0) return result;

    const resourceIds = resources.map(r => r.id);
    const rangeStart = weeks[0].toISOString().slice(0, 10);
    const lastWeekEnd = new Date(weeks[weeks.length - 1].getTime() + 7 * 24 * 60 * 60 * 1000);
    const rangeEnd = lastWeekEnd.toISOString().slice(0, 10);

    // Single batch query for all availability blocks
    const allBlocks = await resourceAvailabilityRepository.findOverlappingBatch(resourceIds, rangeStart, rangeEnd);
    const blocksByResource = new Map<string, typeof allBlocks>();
    for (const block of allBlocks) {
      const list = blocksByResource.get(block.resourceId) || [];
      list.push(block);
      blocksByResource.set(block.resourceId, list);
    }

    // Pre-fetch calendar templates (deduplicated)
    const templateIds = [...new Set(resources.map(r => r.calendarTemplateId).filter(Boolean))] as string[];
    const templateMap = new Map<string, { workingDays: string[]; hoursPerDay: number }>();
    for (const tid of templateIds) {
      const template = await calendarTemplateRepository.findById(tid);
      if (template) templateMap.set(tid, template);
    }

    for (const resource of resources) {
      const weekMap = new Map<string, number>();
      let baseCapacity = resource.capacityHoursPerWeek;
      let hoursPerDay = baseCapacity / 5;

      if (resource.calendarTemplateId) {
        const template = templateMap.get(resource.calendarTemplateId);
        if (template) {
          hoursPerDay = template.hoursPerDay;
          baseCapacity = template.workingDays.length * hoursPerDay;
        }
      }

      const resBlocks = blocksByResource.get(resource.id) || [];

      for (const weekStart of weeks) {
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        const weekKey = weekStart.toISOString().slice(0, 10);

        // Filter blocks overlapping this specific week
        const weekBlocks = resBlocks.filter(b =>
          new Date(b.dateFrom).getTime() <= weekEnd.getTime() &&
          new Date(b.dateTo).getTime() >= weekStart.getTime()
        );

        if (weekBlocks.length === 0) {
          weekMap.set(weekKey, baseCapacity);
          continue;
        }

        let unavailableDays = 0;
        let reducedHoursTotal = 0;
        let reducedDays = 0;

        for (const block of weekBlocks) {
          const blockStart = new Date(Math.max(new Date(block.dateFrom).getTime(), weekStart.getTime()));
          const blockEnd = new Date(Math.min(new Date(block.dateTo).getTime(), weekEnd.getTime()));
          const overlapDays = Math.max(0, Math.ceil((blockEnd.getTime() - blockStart.getTime()) / MS_PER_DAY) + 1);

          if (block.type === 'reduced' && block.hoursAvailable != null) {
            reducedDays += overlapDays;
            reducedHoursTotal += block.hoursAvailable * overlapDays;
          } else {
            unavailableDays += overlapDays;
          }
        }

        let available = Math.max(0, baseCapacity - (unavailableDays * hoursPerDay));
        if (reducedDays > 0) {
          available = Math.max(0, available - (reducedDays * hoursPerDay) + reducedHoursTotal);
        }
        weekMap.set(weekKey, available);
      }

      result.set(resource.id, weekMap);
    }

    return result;
  }
}

export const resourceAvailabilityService = new ResourceAvailabilityService();
