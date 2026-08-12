import { v4 as uuidv4 } from 'uuid';
import { databaseService } from '../database/connection';

interface ParsedRule {
  freq: 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
  byDay?: string[];       // MO, TU, WE, TH, FR, SA, SU
  byMonthDay?: number;    // 1-31
}

const DAY_NAMES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function parseRecurrenceRule(rule: string): ParsedRule | null {
  if (!rule) return null;
  const parts = rule.split(';');
  const map: Record<string, string> = {};
  for (const part of parts) {
    const [key, val] = part.split('=');
    if (key && val) map[key.trim()] = val.trim();
  }
  const freq = map.FREQ as ParsedRule['freq'];
  if (!freq || !['DAILY', 'WEEKLY', 'BIWEEKLY', 'MONTHLY'].includes(freq)) return null;

  return {
    freq,
    byDay: map.BYDAY ? map.BYDAY.split(',').map(d => d.trim()) : undefined,
    byMonthDay: map.BYMONTHDAY ? parseInt(map.BYMONTHDAY, 10) : undefined,
  };
}

export function getNextOccurrence(rule: ParsedRule, lastDate: Date): Date {
  const next = new Date(lastDate);

  switch (rule.freq) {
    case 'DAILY':
      next.setDate(next.getDate() + 1);
      break;

    case 'WEEKLY':
    case 'BIWEEKLY': {
      const increment = rule.freq === 'BIWEEKLY' ? 14 : 7;
      if (rule.byDay && rule.byDay.length > 0) {
        // Find the next matching day
        for (let i = 1; i <= increment; i++) {
          const candidate = new Date(lastDate);
          candidate.setDate(candidate.getDate() + i);
          const dayName = DAY_NAMES[candidate.getDay()];
          if (rule.byDay.includes(dayName)) {
            return candidate;
          }
        }
        // Fallback: just add the interval
        next.setDate(next.getDate() + increment);
      } else {
        next.setDate(next.getDate() + increment);
      }
      break;
    }

    case 'MONTHLY': {
      next.setMonth(next.getMonth() + 1);
      if (rule.byMonthDay) {
        next.setDate(Math.min(rule.byMonthDay, new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()));
      }
      break;
    }
  }

  return next;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

export class RecurrenceService {
  /**
   * Generate recurring task instances for all templates.
   * Called daily by the agent scheduler.
   */
  async generateInstances(horizonDays = 14): Promise<number> {
    // Find all active recurrence templates
    const templates = await databaseService.query(
      `SELECT * FROM tasks WHERE is_recurrence_template = 1 AND status != 'cancelled'`
    );

    let created = 0;
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + horizonDays);

    for (const tpl of templates) {
      const rule = parseRecurrenceRule(tpl.recurrence_rule);
      if (!rule) continue;

      // Find the latest instance created from this template
      const instances = await databaseService.query(
        `SELECT start_date FROM tasks WHERE recurrence_parent_id = ? ORDER BY start_date DESC LIMIT 1`,
        [tpl.id]
      );

      let lastDate: Date;
      if (instances.length > 0 && instances[0].start_date) {
        lastDate = new Date(instances[0].start_date);
      } else if (tpl.start_date) {
        lastDate = new Date(tpl.start_date);
      } else {
        lastDate = new Date();
      }

      // Generate instances up to horizon
      let next = getNextOccurrence(rule, lastDate);
      while (next <= horizon) {
        // Check if instance already exists for this date
        const existing = await databaseService.query(
          `SELECT id FROM tasks WHERE recurrence_parent_id = ? AND start_date = ?`,
          [tpl.id, formatDate(next)]
        );

        if (existing.length === 0) {
          const id = uuidv4();
          const duration = tpl.estimated_days || 1;
          const endDate = new Date(next);
          endDate.setDate(endDate.getDate() + duration);

          await databaseService.query(
            `INSERT INTO tasks (id, schedule_id, name, description, status, priority, assigned_to,
              estimated_days, start_date, end_date, progress_percentage, parent_task_id,
              recurrence_parent_id, is_recurrence_template, created_by)
             VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)`,
            [
              id,
              tpl.schedule_id,
              tpl.name,
              tpl.description || null,
              tpl.priority || 'medium',
              tpl.assigned_to || null,
              tpl.estimated_days || null,
              formatDate(next),
              formatDate(endDate),
              tpl.parent_task_id || null,
              tpl.id,
              tpl.created_by,
            ]
          );
          created++;
        }

        next = getNextOccurrence(rule, next);
      }
    }

    return created;
  }

  /**
   * On-demand expansion for a specific template task.
   * Called from the API when a user creates/updates a recurring template.
   */
  async expandTemplate(templateTaskId: string, horizonDays = 90): Promise<number> {
    const templates = await databaseService.query(
      `SELECT * FROM tasks WHERE id = ? AND is_recurrence_template = 1`,
      [templateTaskId]
    );
    if (templates.length === 0) return 0;
    const tpl = templates[0];

    const rule = parseRecurrenceRule(tpl.recurrence_rule);
    if (!rule) return 0;

    const horizon = new Date();
    horizon.setDate(horizon.getDate() + horizonDays);

    const instances = await databaseService.query(
      `SELECT start_date FROM tasks WHERE recurrence_parent_id = ? ORDER BY start_date DESC LIMIT 1`,
      [tpl.id]
    );

    let lastDate: Date;
    if (instances.length > 0 && instances[0].start_date) {
      lastDate = new Date(instances[0].start_date);
    } else if (tpl.start_date) {
      lastDate = new Date(tpl.start_date);
    } else {
      lastDate = new Date();
    }

    let created = 0;
    let next = getNextOccurrence(rule, lastDate);
    while (next <= horizon && created < 100) {
      const existing = await databaseService.query(
        `SELECT id FROM tasks WHERE recurrence_parent_id = ? AND start_date = ?`,
        [tpl.id, formatDate(next)]
      );

      if (existing.length === 0) {
        const id = uuidv4();
        const duration = tpl.estimated_days || 1;
        const endDate = new Date(next);
        endDate.setDate(endDate.getDate() + duration);

        await databaseService.query(
          `INSERT INTO tasks (id, schedule_id, name, description, status, priority, assigned_to,
            estimated_days, start_date, end_date, progress_percentage, parent_task_id,
            recurrence_parent_id, is_recurrence_template, created_by)
           VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 0, ?, ?, 0, ?)`,
          [
            id,
            tpl.schedule_id,
            tpl.name,
            tpl.description || null,
            tpl.priority || 'medium',
            tpl.assigned_to || null,
            tpl.estimated_days || null,
            formatDate(next),
            formatDate(endDate),
            tpl.parent_task_id || null,
            tpl.id,
            tpl.created_by,
          ]
        );
        created++;
      }

      next = getNextOccurrence(rule, next);
    }

    return created;
  }

  /**
   * Delete all instances created from a template.
   */
  async deleteChildren(templateTaskId: string): Promise<number> {
    const result: any = await databaseService.query(
      `DELETE FROM tasks WHERE recurrence_parent_id = ?`,
      [templateTaskId]
    );
    return result?.affectedRows ?? 0;
  }
}

export const recurrenceService = new RecurrenceService();
