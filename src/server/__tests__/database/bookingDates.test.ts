import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { followTask, moveBookingsWithTasks } from '../../database/bookingDates';

describe('booked hours move with their task', () => {
  const before = { start: '2026-10-19', end: '2026-10-30' };
  const after = { start: '2026-11-09', end: '2026-11-20' };

  it('a booking for the whole task covers the whole task again', () => {
    expect(followTask({ start: '2026-10-19', end: '2026-10-30' }, before, after)).toEqual({ start: '2026-11-09', end: '2026-11-20' });
    // the task got longer: the booking still covers all of it
    expect(followTask({ start: '2026-10-19', end: '2026-10-30' }, before, { start: '2026-10-19', end: '2026-11-06' })).toEqual({ start: '2026-10-19', end: '2026-11-06' });
  });

  it('a booking for part of the task moves by the same days, kept inside the task', () => {
    expect(followTask({ start: '2026-10-26', end: '2026-10-30' }, before, after)).toEqual({ start: '2026-11-16', end: '2026-11-20' });
    // the task got shorter: the booking is cut to fit
    expect(followTask({ start: '2026-10-26', end: '2026-10-30' }, before, { start: '2026-10-19', end: '2026-10-28' })).toEqual({ start: '2026-10-26', end: '2026-10-28' });
    // nothing of it is left inside: it covers the task
    expect(followTask({ start: '2026-10-29', end: '2026-10-30' }, before, { start: '2026-10-19', end: '2026-10-21' })).toEqual({ start: '2026-10-19', end: '2026-10-21' });
  });

  it('nothing moves when the task has no dates or did not move', () => {
    const b = { start: '2026-10-26', end: '2026-10-30' };
    expect(followTask(b, { start: null, end: null }, after)).toBe(b);
    expect(followTask(b, before, before)).toBe(b);
  });

  it('after a write, only the bookings of tasks whose dates changed are moved', async () => {
    const calls: Array<[string, any[]]> = [];
    const run = vi.fn(async (sql: string, params: any[]) => {
      calls.push([sql, params]);
      if (sql.includes('FROM tasks')) return [{ id: 't1', s: '2026-11-09', e: '2026-11-20' }, { id: 't2', s: '2026-10-05', e: '2026-10-09' }];
      if (sql.includes('FROM resource_assignments')) return [{ id: 'ra1', task_id: 't1', s: '2026-10-19', e: '2026-10-30' }];
      return [];
    });
    const n = await moveBookingsWithTasks(run, new Map([['t1', before], ['t2', { start: '2026-10-05', end: '2026-10-09' }]]));
    expect(n).toBe(1);
    expect(calls.find(c => c[0].includes('FROM resource_assignments'))![1]).toEqual(['t1']);
    expect(calls.at(-1)).toEqual(['UPDATE resource_assignments SET start_date = ?, end_date = ? WHERE id = ?', ['2026-11-09', '2026-11-20', 'ra1']]);
  });
});

/**
 * Guard: any server file that writes a task's start/end date must move the bookings too
 * (dragging a task on the Gantt left its hours in the old weeks until 2026-10-02).
 */
const SERVER = join(__dirname, '..', '..');
const files = (d: string): string[] => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  if (f === '__tests__' || f === 'node_modules') return [];
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});

describe('every task date write moves the booked hours', () => {
  it('files that UPDATE tasks start/end dates call moveBookingsWithTasks', () => {
    const offenders = files(SERVER).filter(f => {
      const s = readFileSync(f, 'utf-8');
      // the planned start, not actual_start_date / baseline_start_date
      const writesDates = /UPDATE tasks SET[^`'"]*(?<![\w])start_date\s*=/.test(s)
        || (/UPDATE tasks SET \$\{/.test(s) && /(?<![\w])start_date/.test(s));
      return writesDates && !s.includes('moveBookingsWithTasks');
    }).map(f => relative(SERVER, f).split(sep).join('/'));
    expect(offenders, 'Wrap the write: taskDatesOf before, moveBookingsWithTasks after (database/bookingDates.ts)').toEqual([]);
  });
});
