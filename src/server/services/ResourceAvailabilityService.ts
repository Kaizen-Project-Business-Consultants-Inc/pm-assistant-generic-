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
}

export const resourceAvailabilityService = new ResourceAvailabilityService();
