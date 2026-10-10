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

  it('a booking for part of the task moves by the same working days, kept inside the task', () => {
    expect(followTask({ start: '2026-10-26', end: '2026-10-30' }, before, after)).toEqual({ start: '2026-11-16', end: '2026-11-20' });
    // the task got shorter but still has room: the booking slides back, keeping its 5 working days
    expect(followTask({ start: '2026-10-26', end: '2026-10-30' }, before, { start: '2026-10-19', end: '2026-10-28' })).toEqual({ start: '2026-10-22', end: '2026-10-28' });
    // the task is now shorter than the booking: only then is the booking cut to the task
    expect(followTask({ start: '2026-10-22', end: '2026-10-30' }, before, { start: '2026-10-19', end: '2026-10-21' })).toEqual({ start: '2026-10-19', end: '2026-10-21' });
  });

  describe('audit 2026-10-09 M1 repros', () => {
    const task = { start: '2026-10-12', end: '2026-10-16' }; // Mon–Fri

    it('A. a Friday booking on a task moved one working day later lands on Monday, not Saturday', () => {
      expect(followTask({ start: '2026-10-16', end: '2026-10-16' }, task, { start: '2026-10-13', end: '2026-10-19' }))
        .toEqual({ start: '2026-10-19', end: '2026-10-19' });
    });

    it('C. a Thu–Fri booking on a task shortened to Mon–Wed stays 2 days (Tue–Wed), it does not grow to 3', () => {
      expect(followTask({ start: '2026-10-15', end: '2026-10-16' }, task, { start: '2026-10-12', end: '2026-10-14' }))
        .toEqual({ start: '2026-10-13', end: '2026-10-14' });
    });

    it('B. shortening cuts a 3-day booking to the 2-day task (Undo puts it back from History, not from here)', () => {
      expect(followTask({ start: '2026-10-14', end: '2026-10-16' }, task, { start: '2026-10-12', end: '2026-10-13' }))
        .toEqual({ start: '2026-10-12', end: '2026-10-13' });
    });

    it('the project calendar decides: a Saturday that is worked is used', () => {
      const satWorked = (ymd: string) => ymd === '2026-10-17' || ![0, 6].includes(new Date(`${ymd}T00:00:00Z`).getUTCDay());
      expect(followTask({ start: '2026-10-16', end: '2026-10-16' }, task, { start: '2026-10-13', end: '2026-10-19' }, satWorked))
        .toEqual({ start: '2026-10-17', end: '2026-10-17' });
    });

    it('a task that started on a weekend: the offset counts from its first working day (review)', () => {
      // task Sat 10 – Fri 16 Oct, booking Mon 12 – Tue 13, task moved one week later
      expect(followTask({ start: '2026-10-12', end: '2026-10-13' }, { start: '2026-10-10', end: '2026-10-16' }, { start: '2026-10-17', end: '2026-10-23' }))
        .toEqual({ start: '2026-10-19', end: '2026-10-20' });
    });

    it('a holiday is skipped', () => {
      const monOff = (ymd: string) => ymd !== '2026-10-19' && ![0, 6].includes(new Date(`${ymd}T00:00:00Z`).getUTCDay());
      expect(followTask({ start: '2026-10-16', end: '2026-10-16' }, task, { start: '2026-10-13', end: '2026-10-20' }, monOff))
        .toEqual({ start: '2026-10-20', end: '2026-10-20' });
    });
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
    expect(calls.at(-1)).toEqual([
      'UPDATE resource_assignments SET start_date = CASE id WHEN ? THEN ? END, end_date = CASE id WHEN ? THEN ? END WHERE id IN (?)',
      ['ra1', '2026-11-09', 'ra1', '2026-11-20', 'ra1'],
    ]);
  });

  it('a booking for part of a task reads that project calendar, and the move is remembered for History', async () => {
    const { asyncLocalStorage } = await import('../../middleware/requestContext');
    const { takeBookingMoves, setProjectCalendarProvider } = await import('../../database/bookingDates');
    const provider = vi.fn(async (_pid: string) => (ymd: string) => ![0, 6].includes(new Date(`${ymd}T00:00:00Z`).getUTCDay()));
    setProjectCalendarProvider(provider);
    const run = vi.fn(async (sql: string) => {
      if (sql.includes('JOIN schedules')) return [{ id: 't1', project_id: 'p1' }];
      if (sql.includes('FROM tasks')) return [{ id: 't1', s: '2026-10-13', e: '2026-10-19' }];
      if (sql.includes('FROM resource_assignments')) return [{ id: 'ra1', task_id: 't1', s: '2026-10-16', e: '2026-10-16' }];
      return [];
    });
    const ctx: any = { requestId: 'r', startTime: 0 };
    await asyncLocalStorage.run(ctx, async () => {
      const n = await moveBookingsWithTasks(run, new Map([['t1', { start: '2026-10-12', end: '2026-10-16' }]]));
      expect(n).toBe(1);
      expect(provider).toHaveBeenCalledWith('p1');
      expect(takeBookingMoves(['t1'])).toEqual([{ id: 'ra1', taskId: 't1', start: '2026-10-16', end: '2026-10-16', newStart: '2026-10-19', newEnd: '2026-10-19' }]);
      expect(takeBookingMoves(['t1'])).toEqual([]); // taken once
    });
    setProjectCalendarProvider(null);
  });

  it('many bookings are moved 100 per statement, each to its own new dates (2026-10-08)', async () => {
    const bookings = Array.from({ length: 250 }, (_, i) => ({ id: `ra${i}`, task_id: 't1', s: '2026-10-19', e: '2026-10-30' }));
    const updates: any[][] = [];
    const run = vi.fn(async (sql: string, params: any[]) => {
      if (sql.startsWith('UPDATE')) updates.push(params);
      if (sql.includes('FROM tasks')) return [{ id: 't1', s: '2026-11-09', e: '2026-11-20' }];
      if (sql.includes('FROM resource_assignments')) return bookings;
      return [];
    });
    const n = await moveBookingsWithTasks(run, new Map([['t1', before]]));
    expect(n).toBe(250);
    expect(updates.map(p => p.length / 5)).toEqual([100, 100, 50]);
    const last = updates[2];
    expect(last.slice(0, 2)).toEqual(['ra200', '2026-11-09']);
    expect(last.slice(100, 102)).toEqual(['ra200', '2026-11-20']);
    expect(last.slice(200)).toEqual(bookings.slice(200).map(b => b.id));
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
