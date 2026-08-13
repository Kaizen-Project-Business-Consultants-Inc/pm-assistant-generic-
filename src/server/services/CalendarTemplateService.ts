import { calendarTemplateRepository, CalendarTemplate } from '../database/CalendarTemplateRepository';

export class CalendarTemplateService {
  async list(): Promise<CalendarTemplate[]> {
    return calendarTemplateRepository.findAll();
  }

  async get(id: string): Promise<CalendarTemplate | null> {
    return calendarTemplateRepository.findById(id);
  }

  async getDefault(): Promise<CalendarTemplate | null> {
    return calendarTemplateRepository.findDefault();
  }

  async create(data: Omit<CalendarTemplate, 'id'>): Promise<CalendarTemplate> {
    return calendarTemplateRepository.create(data);
  }

  async update(id: string, data: Partial<Omit<CalendarTemplate, 'id'>>): Promise<CalendarTemplate | null> {
    return calendarTemplateRepository.update(id, data);
  }

  async delete(id: string): Promise<boolean> {
    return calendarTemplateRepository.deleteTemplate(id);
  }
}

export const calendarTemplateService = new CalendarTemplateService();
