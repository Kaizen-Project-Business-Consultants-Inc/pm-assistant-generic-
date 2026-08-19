import { v4 as uuidv4 } from 'uuid';
import { reportScheduleRepository, ReportSchedule } from '../database/ReportScheduleRepository';
import { reportBuilderService } from './ReportBuilderService';
import { emailService } from './EmailService';
import { projectStatusReportService } from './ProjectStatusReportService';
import { raidReportService } from './RAIDReportService';
import logger from '../utils/logger';

export type { ReportSchedule } from '../database/ReportScheduleRepository';

export class ReportScheduleService {
  async create(data: {
    templateId: string;
    createdBy: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    dayOfWeek?: number;
    dayOfMonth?: number;
    timeOfDay?: string;
    recipients: string[];
    isActive?: boolean;
  }): Promise<ReportSchedule> {
    const id = uuidv4();
    const timeOfDay = data.timeOfDay || '08:00';
    const nextRunAt = this.computeNextRun(data.frequency, data.dayOfWeek ?? null, data.dayOfMonth ?? null, timeOfDay);

    await reportScheduleRepository.insert(
      id, data.templateId, data.createdBy, data.frequency,
      data.dayOfWeek ?? null, data.dayOfMonth ?? null, timeOfDay,
      data.recipients, data.isActive !== false, nextRunAt,
    );

    return (await reportScheduleRepository.findById(id))!;
  }

  async getById(id: string): Promise<ReportSchedule | null> {
    return reportScheduleRepository.findById(id);
  }

  async listByUser(userId: string): Promise<ReportSchedule[]> {
    return reportScheduleRepository.findByUser(userId);
  }

  async getByTemplateId(templateId: string): Promise<ReportSchedule[]> {
    return reportScheduleRepository.findByTemplate(templateId);
  }

  async update(id: string, data: Partial<{
    frequency: 'daily' | 'weekly' | 'monthly';
    dayOfWeek: number | null;
    dayOfMonth: number | null;
    timeOfDay: string;
    recipients: string[];
    isActive: boolean;
  }>): Promise<ReportSchedule | null> {
    const fields: string[] = [];
    const values: any[] = [];

    if (data.frequency !== undefined) { fields.push('frequency = ?'); values.push(data.frequency); }
    if (data.dayOfWeek !== undefined) { fields.push('day_of_week = ?'); values.push(data.dayOfWeek); }
    if (data.dayOfMonth !== undefined) { fields.push('day_of_month = ?'); values.push(data.dayOfMonth); }
    if (data.timeOfDay !== undefined) { fields.push('time_of_day = ?'); values.push(data.timeOfDay); }
    if (data.recipients !== undefined) { fields.push('recipients = ?'); values.push(JSON.stringify(data.recipients)); }
    if (data.isActive !== undefined) { fields.push('is_active = ?'); values.push(data.isActive); }

    if (data.frequency !== undefined || data.dayOfWeek !== undefined || data.dayOfMonth !== undefined || data.timeOfDay !== undefined) {
      const current = await this.getById(id);
      if (current) {
        const freq = data.frequency ?? current.frequency;
        const dow = data.dayOfWeek !== undefined ? data.dayOfWeek : current.dayOfWeek;
        const dom = data.dayOfMonth !== undefined ? data.dayOfMonth : current.dayOfMonth;
        const tod = data.timeOfDay ?? current.timeOfDay;
        const nextRun = this.computeNextRun(freq, dow, dom, tod);
        fields.push('next_run_at = ?');
        values.push(nextRun);
      }
    }

    if (fields.length === 0) return this.getById(id);

    await reportScheduleRepository.updateFields(id, fields, values);
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    await reportScheduleRepository.deleteById(id);
  }

  async listAll(): Promise<ReportSchedule[]> {
    return reportScheduleRepository.findAll();
  }

  async executeOne(id: string): Promise<void> {
    const schedule = await this.getById(id);
    if (!schedule) throw new Error('Schedule not found');

    try {
      if (schedule.templateId.startsWith('status-report::')) {
        const projectId = schedule.templateId.replace('status-report::', '');
        await projectStatusReportService.generate(projectId, schedule.createdBy, {
          recipients: schedule.recipients,
          sendEmail: true,
        });
      } else if (schedule.templateId.startsWith('raid-report::')) {
        const projectId = schedule.templateId.replace('raid-report::', '');
        await raidReportService.generate(projectId, schedule.createdBy, {
          recipients: schedule.recipients,
          sendEmail: true,
        });
      } else {
        const template = await reportBuilderService.getTemplateById(schedule.templateId);
        if (!template) throw new Error('Template not found');
        const { data: csvContent } = await reportBuilderService.exportReport(schedule.templateId, 'csv');
        await emailService.sendReportEmail(schedule.recipients, template.name, csvContent as string);
      }

      await this.updateRunStatus(id, 'success', null);
    } catch (err: any) {
      logger.error(`[ReportScheduleService] Manual run failed for schedule ${id}:`, err);
      await this.updateRunStatus(id, 'error', err.message || 'Unknown error');
      throw err;
    }
  }

  async getDueSchedules(): Promise<ReportSchedule[]> {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    return reportScheduleRepository.findDue(now);
  }

  async executeDueSchedules(): Promise<number> {
    const dueSchedules = await this.getDueSchedules();
    let executed = 0;

    for (const schedule of dueSchedules) {
      try {
        // Handle status report schedules
        if (schedule.templateId.startsWith('status-report::')) {
          const projectId = schedule.templateId.replace('status-report::', '');
          await projectStatusReportService.generate(projectId, schedule.createdBy, {
            recipients: schedule.recipients,
            sendEmail: true,
          });

          const nextRun = this.computeNextRun(
            schedule.frequency, schedule.dayOfWeek, schedule.dayOfMonth, schedule.timeOfDay,
          );
          await this.updateRunStatus(schedule.id, 'success', null, nextRun);
          executed++;
          continue;
        }

        // Handle RAID report schedules
        if (schedule.templateId.startsWith('raid-report::')) {
          const projectId = schedule.templateId.replace('raid-report::', '');
          await raidReportService.generate(projectId, schedule.createdBy, {
            recipients: schedule.recipients,
            sendEmail: true,
          });

          const nextRun = this.computeNextRun(
            schedule.frequency, schedule.dayOfWeek, schedule.dayOfMonth, schedule.timeOfDay,
          );
          await this.updateRunStatus(schedule.id, 'success', null, nextRun);
          executed++;
          continue;
        }

        const template = await reportBuilderService.getTemplateById(schedule.templateId);
        if (!template) {
          await this.updateRunStatus(schedule.id, 'error', 'Template not found');
          continue;
        }

        const { data: csvContent } = await reportBuilderService.exportReport(schedule.templateId, 'csv');

        await emailService.sendReportEmail(
          schedule.recipients,
          template.name,
          csvContent as string,
        );

        const nextRun = this.computeNextRun(
          schedule.frequency, schedule.dayOfWeek, schedule.dayOfMonth, schedule.timeOfDay,
        );
        await this.updateRunStatus(schedule.id, 'success', null, nextRun);
        executed++;
      } catch (err: any) {
        logger.error(`[ReportScheduleService] Failed to execute schedule ${schedule.id}:`, err);
        const nextRun = this.computeNextRun(
          schedule.frequency, schedule.dayOfWeek, schedule.dayOfMonth, schedule.timeOfDay,
        );
        await this.updateRunStatus(schedule.id, 'error', err.message || 'Unknown error', nextRun);
      }
    }

    if (executed > 0) {
      logger.info(`[ReportScheduleService] Executed ${executed} scheduled report(s)`);
    }

    return executed;
  }

  private async updateRunStatus(id: string, status: string, error: string | null, nextRunAt?: string): Promise<void> {
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);
    await reportScheduleRepository.updateRunStatus(id, now, status, error, nextRunAt);
  }

  computeNextRun(
    frequency: 'daily' | 'weekly' | 'monthly',
    dayOfWeek: number | null,
    dayOfMonth: number | null,
    timeOfDay: string,
  ): string {
    const now = new Date();
    const [hours, minutes] = (timeOfDay || '08:00').split(':').map(Number);
    const next = new Date(now);
    next.setHours(hours, minutes, 0, 0);

    if (frequency === 'daily') {
      if (next <= now) next.setDate(next.getDate() + 1);
    } else if (frequency === 'weekly') {
      const targetDay = dayOfWeek ?? 1;
      const currentDay = next.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil < 0 || (daysUntil === 0 && next <= now)) {
        daysUntil += 7;
      }
      next.setDate(next.getDate() + daysUntil);
    } else if (frequency === 'monthly') {
      const targetDate = dayOfMonth ?? 1;
      next.setDate(targetDate);
      if (next <= now) {
        next.setMonth(next.getMonth() + 1);
        next.setDate(targetDate);
      }
    }

    return next.toISOString().replace('T', ' ').substring(0, 19);
  }
}

export const reportScheduleService = new ReportScheduleService();
