import { CronExpressionParser } from 'cron-parser';
import type { ScheduleConfig } from './types';

/**
 * Compute the next run time for a scheduled automation.
 * Returns a Date or null if the config is invalid.
 */
export function computeNextRun(config: ScheduleConfig, timezone: string = 'UTC', from?: Date): Date | null {
  const now = from ?? new Date();

  switch (config.type) {
    case 'interval': {
      const minutes = Math.max(1, Math.min(1440, config.intervalMinutes));
      return new Date(now.getTime() + minutes * 60_000);
    }

    case 'daily': {
      const cronExpr = timeToCron(config.time);
      return nextFromCron(cronExpr, timezone, now);
    }

    case 'weekly': {
      const day = Math.max(0, Math.min(6, config.dayOfWeek));
      const [hour, minute] = parseTime(config.time);
      const cronExpr = `${minute} ${hour} * * ${day}`;
      return nextFromCron(cronExpr, timezone, now);
    }

    case 'monthly': {
      const dayOfMonth = Math.max(1, Math.min(31, config.dayOfMonth));
      const [hour, minute] = parseTime(config.time);
      const cronExpr = `${minute} ${hour} ${dayOfMonth} * *`;
      return nextFromCron(cronExpr, timezone, now);
    }

    case 'cron': {
      return nextFromCron(config.expression, timezone, now);
    }

    default:
      return null;
  }
}

function parseTime(time: string): [number, number] {
  const parts = (time || '00:00').split(':');
  const hour = Math.max(0, Math.min(23, parseInt(parts[0], 10) || 0));
  const minute = Math.max(0, Math.min(59, parseInt(parts[1], 10) || 0));
  return [hour, minute];
}

function timeToCron(time: string): string {
  const [hour, minute] = parseTime(time);
  return `${minute} ${hour} * * *`;
}

function nextFromCron(expression: string, timezone: string, now: Date): Date | null {
  try {
    const interval = CronExpressionParser.parse(expression, { currentDate: now, tz: timezone });
    return interval.next().toDate();
  } catch {
    return null;
  }
}
