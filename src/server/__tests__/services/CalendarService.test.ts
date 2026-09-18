import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: { query: (...args: any[]) => mockQuery(...args) },
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234'),
}));

import { CalendarService, type ProjectCalendar } from '../../services/CalendarService';

// ── Helpers ──────────────────────────────────────────────────────────
let calIdCounter = 0;

function uniqueCalId(): string {
  return `cal-${++calIdCounter}`;
}

function makeCalendarRow(overrides: Partial<{
  id: string;
  project_id: string;
  name: string;
  working_days: string | number[];
  hours_per_day: number | string;
  is_default: number | boolean;
  created_at: string;
  updated_at: string;
}> = {}) {
  return {
    id: overrides.id ?? 'cal-1',
    project_id: overrides.project_id ?? 'proj-1',
    name: overrides.name ?? 'Standard',
    working_days: overrides.working_days ?? JSON.stringify([1, 2, 3, 4, 5]),
    hours_per_day: overrides.hours_per_day ?? 8,
    is_default: overrides.is_default ?? 1,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-01-01T00:00:00.000Z',
  };
}

function makeCalendar(overrides: Partial<ProjectCalendar> = {}): ProjectCalendar {
  return {
    id: overrides.id ?? 'cal-1',
    projectId: overrides.projectId ?? 'proj-1',
    name: overrides.name ?? 'Standard',
    workingDays: overrides.workingDays ?? [1, 2, 3, 4, 5],
    hoursPerDay: overrides.hoursPerDay ?? 8,
    isDefault: overrides.isDefault ?? true,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
  };
}

function makeExceptionRow(overrides: Partial<{
  id: string;
  calendar_id: string;
  exception_date: string;
  type: string;
  name: string | null;
  created_at: string;
}> = {}) {
  return {
    id: overrides.id ?? 'exc-1',
    calendar_id: overrides.calendar_id ?? 'cal-1',
    exception_date: overrides.exception_date ?? '2026-12-25',
    type: overrides.type ?? 'holiday',
    name: overrides.name !== undefined ? overrides.name : 'Christmas',
    created_at: overrides.created_at ?? '2026-01-01T00:00:00.000Z',
  };
}

// ── Tests ────────────────────────────────────────────────────────────
describe('CalendarService', () => {
  let service: CalendarService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new CalendarService();
  });

  // ── getOrCreateDefault ──────────────────────────────────────────
  describe('getOrCreateDefault', () => {
    it('returns existing default calendar when one exists', async () => {
      const row = makeCalendarRow();
      mockQuery.mockResolvedValueOnce([row]);

      const result = await service.getOrCreateDefault('proj-1');

      expect(result.id).toBe('cal-1');
      expect(result.projectId).toBe('proj-1');
      expect(result.name).toBe('Standard');
      expect(result.workingDays).toEqual([1, 2, 3, 4, 5]);
      expect(result.hoursPerDay).toBe(8);
      expect(result.isDefault).toBe(true);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM project_calendars'),
        ['proj-1'],
      );
    });

    it('creates a new default calendar when none exists', async () => {
      const createdRow = makeCalendarRow({ id: 'test-uuid-1234' });
      mockQuery
        .mockResolvedValueOnce([]) // SELECT returns nothing
        .mockResolvedValueOnce(undefined) // INSERT
        .mockResolvedValueOnce([createdRow]); // SELECT after insert

      const result = await service.getOrCreateDefault('proj-1');

      expect(result.id).toBe('test-uuid-1234');
      expect(mockQuery).toHaveBeenCalledTimes(3);
      // Second call is the INSERT
      expect(mockQuery.mock.calls[1][0]).toContain('INSERT INTO project_calendars');
      expect(mockQuery.mock.calls[1][1]).toEqual([
        'test-uuid-1234',
        'proj-1',
        JSON.stringify([1, 2, 3, 4, 5]),
      ]);
    });
  });

  // ── findByProject ───────────────────────────────────────────────
  describe('findByProject', () => {
    it('returns calendars for a project', async () => {
      const rows = [
        makeCalendarRow({ id: 'cal-1', is_default: 1 }),
        makeCalendarRow({ id: 'cal-2', name: 'Night Shift', is_default: 0 }),
      ];
      mockQuery.mockResolvedValueOnce(rows);

      const result = await service.findByProject('proj-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('cal-1');
      expect(result[1].id).toBe('cal-2');
      expect(result[1].isDefault).toBe(false);
    });

    it('returns empty array when project has no calendars', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await service.findByProject('proj-missing');

      expect(result).toEqual([]);
    });
  });

  // ── findById ────────────────────────────────────────────────────
  describe('findById', () => {
    it('returns calendar when found', async () => {
      mockQuery.mockResolvedValueOnce([makeCalendarRow()]);

      const result = await service.findById('cal-1');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('cal-1');
    });

    it('returns null when not found', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await service.findById('cal-missing');

      expect(result).toBeNull();
    });
  });

  // ── create ──────────────────────────────────────────────────────
  describe('create', () => {
    it('creates a non-default calendar and returns it', async () => {
      const row = makeCalendarRow({ id: 'test-uuid-1234', name: 'Custom', is_default: 0 });
      mockQuery
        .mockResolvedValueOnce(undefined) // INSERT
        .mockResolvedValueOnce([row]); // findById SELECT

      const result = await service.create({
        projectId: 'proj-1',
        name: 'Custom',
        workingDays: [1, 2, 3, 4, 5],
        hoursPerDay: 8,
      });

      expect(result.id).toBe('test-uuid-1234');
      expect(result.name).toBe('Custom');
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO project_calendars');
      // The SQL template has is_default hardcoded as 0 in the VALUES clause
      expect(mockQuery.mock.calls[0][0]).toContain('0)');
    });
  });

  // ── update ──────────────────────────────────────────────────────
  describe('update', () => {
    it('updates name only', async () => {
      const updatedRow = makeCalendarRow({ name: 'Renamed' });
      mockQuery
        .mockResolvedValueOnce(undefined) // UPDATE
        .mockResolvedValueOnce([updatedRow]); // findById

      const result = await service.update('cal-1', { name: 'Renamed' });

      expect(mockQuery.mock.calls[0][0]).toContain('UPDATE project_calendars SET name = ?');
      expect(result!.name).toBe('Renamed');
    });

    it('updates multiple fields', async () => {
      const updatedRow = makeCalendarRow({ name: 'Updated', hours_per_day: 6 });
      mockQuery
        .mockResolvedValueOnce(undefined) // UPDATE
        .mockResolvedValueOnce([updatedRow]); // findById

      const result = await service.update('cal-1', {
        name: 'Updated',
        workingDays: [1, 2, 3],
        hoursPerDay: 6,
      });

      expect(mockQuery.mock.calls[0][0]).toContain('name = ?');
      expect(mockQuery.mock.calls[0][0]).toContain('working_days = ?');
      expect(mockQuery.mock.calls[0][0]).toContain('hours_per_day = ?');
      expect(result!.hoursPerDay).toBe(6);
    });

    it('returns current calendar when no fields provided', async () => {
      const row = makeCalendarRow();
      mockQuery.mockResolvedValueOnce([row]);

      const result = await service.update('cal-1', {});

      // Should only call findById, no UPDATE
      expect(mockQuery).toHaveBeenCalledTimes(1);
      expect(mockQuery.mock.calls[0][0]).toContain('SELECT');
    });
  });

  // ── delete ──────────────────────────────────────────────────────
  describe('delete', () => {
    it('returns true when a non-default calendar is deleted', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 });

      const result = await service.delete('cal-2');

      expect(result).toBe(true);
      expect(mockQuery.mock.calls[0][0]).toContain('is_default = 0');
    });

    it('returns false when delete affects no rows (default calendar)', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 0 });

      const result = await service.delete('cal-1');

      expect(result).toBe(false);
    });

    it('returns false when affectedRows is missing', async () => {
      mockQuery.mockResolvedValueOnce({});

      const result = await service.delete('cal-1');

      expect(result).toBe(false);
    });
  });

  // ── getExceptions ───────────────────────────────────────────────
  describe('getExceptions', () => {
    it('returns exceptions for a calendar', async () => {
      const rows = [
        makeExceptionRow({ id: 'exc-1', exception_date: '2026-12-25', type: 'holiday', name: 'Christmas' }),
        makeExceptionRow({ id: 'exc-2', exception_date: '2026-12-26', type: 'holiday', name: 'Boxing Day' }),
      ];
      mockQuery.mockResolvedValueOnce(rows);

      const result = await service.getExceptions('cal-1');

      expect(result).toHaveLength(2);
      expect(result[0].exceptionDate).toBe('2026-12-25');
      expect(result[0].type).toBe('holiday');
      expect(result[1].name).toBe('Boxing Day');
    });

    it('returns empty array when no exceptions', async () => {
      mockQuery.mockResolvedValueOnce([]);

      const result = await service.getExceptions('cal-1');

      expect(result).toEqual([]);
    });
  });

  // ── addException ────────────────────────────────────────────────
  describe('addException', () => {
    it('adds a holiday exception', async () => {
      const calId = uniqueCalId();
      const row = makeExceptionRow({ calendar_id: calId, type: 'holiday', name: 'Christmas' });
      mockQuery
        .mockResolvedValueOnce(undefined) // INSERT
        .mockResolvedValueOnce([row]); // SELECT after

      const result = await service.addException(calId, '2026-12-25', 'holiday', 'Christmas');

      expect(result.type).toBe('holiday');
      expect(result.name).toBe('Christmas');
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO calendar_exceptions');
      expect(mockQuery.mock.calls[0][0]).toContain('ON DUPLICATE KEY UPDATE');
    });

    it('adds a working exception without name', async () => {
      const calId = uniqueCalId();
      const row = makeExceptionRow({ calendar_id: calId, type: 'working', name: null });
      mockQuery
        .mockResolvedValueOnce(undefined) // INSERT
        .mockResolvedValueOnce([row]); // SELECT after

      const result = await service.addException(calId, '2026-12-28', 'working');

      expect(result.type).toBe('working');
      expect(result.name).toBeUndefined();
      // Name param should be null when not provided
      expect(mockQuery.mock.calls[0][1]![4]).toBeNull();
    });
  });

  // ── removeException ─────────────────────────────────────────────
  describe('removeException', () => {
    it('returns true when exception is removed', async () => {
      mockQuery
        .mockResolvedValueOnce([{ calendar_id: 'cal-1' }]) // SELECT calendar_id
        .mockResolvedValueOnce({ affectedRows: 1 }); // DELETE

      const result = await service.removeException('exc-1');

      expect(result).toBe(true);
    });

    it('returns false when exception does not exist', async () => {
      mockQuery
        .mockResolvedValueOnce([]) // SELECT returns nothing
        .mockResolvedValueOnce({ affectedRows: 0 }); // DELETE affects nothing

      const result = await service.removeException('exc-missing');

      expect(result).toBe(false);
    });
  });

  // ── isWorkingDay ────────────────────────────────────────────────
  describe('isWorkingDay', () => {
    const calendar = makeCalendar();
    const emptyHolidays = new Set<string>();
    const emptyWorkingExc = new Set<string>();

    it('returns true for a regular weekday (Mon-Fri)', () => {
      // 2026-01-05 is a Monday
      const monday = '2026-01-05';
      expect(service.isWorkingDay(monday, calendar, emptyHolidays, emptyWorkingExc)).toBe(true);
    });

    it('returns false for a weekend day', () => {
      // 2026-01-03 is a Saturday
      const saturday = '2026-01-03';
      expect(service.isWorkingDay(saturday, calendar, emptyHolidays, emptyWorkingExc)).toBe(false);
    });

    it('returns false when date is a holiday exception', () => {
      const monday = '2026-01-05';
      const hols = new Set(['2026-01-05']);
      expect(service.isWorkingDay(monday, calendar, hols, emptyWorkingExc)).toBe(false);
    });

    it('returns true when weekend date is a working exception', () => {
      // 2026-01-03 is a Saturday
      const saturday = '2026-01-03';
      const workExc = new Set(['2026-01-03']);
      expect(service.isWorkingDay(saturday, calendar, emptyHolidays, workExc)).toBe(true);
    });

    it('holiday exception takes priority over working exception', () => {
      const monday = '2026-01-05';
      const hols = new Set(['2026-01-05']);
      const workExc = new Set(['2026-01-05']);
      // holidays are checked first
      expect(service.isWorkingDay(monday, calendar, hols, workExc)).toBe(false);
    });

    it('respects custom working days (e.g., Sat-Wed)', () => {
      const customCalendar = makeCalendar({ workingDays: [0, 1, 2, 3, 6] }); // Sun, Mon, Tue, Wed, Sat
      // 2026-01-03 is Saturday (day 6) - should be working
      const saturday = '2026-01-03';
      expect(service.isWorkingDay(saturday, customCalendar, emptyHolidays, emptyWorkingExc)).toBe(true);
      // 2026-01-08 is Thursday (day 4) - should NOT be working
      const thursday = '2026-01-08';
      expect(service.isWorkingDay(thursday, customCalendar, emptyHolidays, emptyWorkingExc)).toBe(false);
    });
  });

  // ── addWorkingDays ──────────────────────────────────────────────
  describe('addWorkingDays', () => {
    it('adds working days forward skipping weekends', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([]); // loadExceptions → getExceptions
      // 2026-01-05 is Monday, add 5 working days → Mon-Fri counted, lands on Fri 2026-01-12
      // Actually: start Mon, step +1 each iteration: Tue(4), Wed(3), Thu(2), Fri(1), Sat skip, Sun skip, Mon(0) → 2026-01-12
      const result = await service.addWorkingDays('2026-01-05', 5, cal);
      expect(result).toBe('2026-01-12');
    });

    it('adds working days forward across a weekend', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([]); // loadExceptions
      // 2026-01-08 is Thursday, add 2 working days → Fri(1), Sat skip, Sun skip, Mon(0) → 2026-01-12
      const result = await service.addWorkingDays('2026-01-08', 2, cal);
      expect(result).toBe('2026-01-12');
    });

    it('handles negative days (goes backward)', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([]);
      // 2026-01-12 is Monday, subtract 2 → Fri(1), Thu(0) → 2026-01-08
      const result = await service.addWorkingDays('2026-01-12', -2, cal);
      expect(result).toBe('2026-01-08');
    });

    it('returns next working day when adding 1 day from Friday', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([]);
      // 2026-01-09 is Friday, add 1 → Sat skip, Sun skip, Mon(0) → 2026-01-12
      const result = await service.addWorkingDays('2026-01-09', 1, cal);
      expect(result).toBe('2026-01-12');
    });

    it('skips holiday exceptions', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      // Monday 2026-01-05 is a holiday
      mockQuery.mockResolvedValueOnce([
        makeExceptionRow({ calendar_id: cal.id, exception_date: '2026-01-05', type: 'holiday' }),
      ]);

      // Start Fri 2026-01-02, add 1 → Sat skip, Sun skip, Mon holiday skip, Tue(0) → 2026-01-06
      const result = await service.addWorkingDays('2026-01-02', 1, cal);
      expect(result).toBe('2026-01-06');
    });

    it('handles zero days by returning start date', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([]);
      const result = await service.addWorkingDays('2026-01-05', 0, cal);
      expect(result).toBe('2026-01-05');
    });
  });

  // ── countWorkingDays ────────────────────────────────────────────
  describe('countWorkingDays', () => {
    it('counts working days in a single work week', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([]);
      // Mon 2026-01-05 to Fri 2026-01-09 = 5 working days
      const result = await service.countWorkingDays('2026-01-05', '2026-01-09', cal);
      expect(result).toBe(5);
    });

    it('counts working days across a weekend', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([]);
      // Fri 2026-01-09 to Mon 2026-01-12 = 2 working days (Fri + Mon)
      const result = await service.countWorkingDays('2026-01-09', '2026-01-12', cal);
      expect(result).toBe(2);
    });

    it('returns 0 for a weekend-only range', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([]);
      // Sat 2026-01-03 to Sun 2026-01-04 = 0
      const result = await service.countWorkingDays('2026-01-03', '2026-01-04', cal);
      expect(result).toBe(0);
    });

    it('returns 1 for a single working day', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([]);
      const result = await service.countWorkingDays('2026-01-05', '2026-01-05', cal);
      expect(result).toBe(1);
    });

    it('returns 0 for a single non-working day', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([]);
      const result = await service.countWorkingDays('2026-01-03', '2026-01-03', cal);
      expect(result).toBe(0);
    });

    it('excludes holiday exceptions from count', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([
        makeExceptionRow({ calendar_id: cal.id, exception_date: '2026-01-07', type: 'holiday' }),
      ]);

      // Mon-Fri but Wed is holiday = 4 working days
      const result = await service.countWorkingDays('2026-01-05', '2026-01-09', cal);
      expect(result).toBe(4);
    });

    it('includes working exceptions in count', async () => {
      const cal = makeCalendar({ id: uniqueCalId() });
      mockQuery.mockResolvedValueOnce([
        makeExceptionRow({ calendar_id: cal.id, exception_date: '2026-01-03', type: 'working' }),
      ]);

      // Sat 2026-01-03 is now a working day
      const result = await service.countWorkingDays('2026-01-03', '2026-01-03', cal);
      expect(result).toBe(1);
    });
  });

  // ── getNonWorkingDates ──────────────────────────────────────────
  describe('getNonWorkingDates', () => {
    it('returns weekend dates in range', async () => {
      const projId = 'proj-nwd-1';
      const calId = uniqueCalId();
      const calRow = makeCalendarRow({ id: calId, project_id: projId });
      mockQuery
        .mockResolvedValueOnce([calRow]) // getOrCreateDefault SELECT
        .mockResolvedValueOnce([]); // getExceptions (no exceptions)

      // Mon 2026-01-05 to Sun 2026-01-11
      const result = await service.getNonWorkingDates(projId, '2026-01-05', '2026-01-11');

      expect(result).toEqual(['2026-01-10', '2026-01-11']); // Sat + Sun
    });

    it('includes holiday exceptions as non-working', async () => {
      const projId = 'proj-nwd-2';
      const calId = uniqueCalId();
      const calRow = makeCalendarRow({ id: calId, project_id: projId });
      mockQuery
        .mockResolvedValueOnce([calRow]) // getOrCreateDefault
        .mockResolvedValueOnce([
          makeExceptionRow({ calendar_id: calId, exception_date: '2026-01-07', type: 'holiday' }),
        ]); // getExceptions

      // Mon-Fri, Wed is holiday
      const result = await service.getNonWorkingDates(projId, '2026-01-05', '2026-01-09');

      expect(result).toContain('2026-01-07');
      expect(result).toHaveLength(1); // Only Wed holiday; no weekends in Mon-Fri
    });

    it('excludes working exceptions from non-working list', async () => {
      const projId = 'proj-nwd-3';
      const calId = uniqueCalId();
      const calRow = makeCalendarRow({ id: calId, project_id: projId });
      mockQuery
        .mockResolvedValueOnce([calRow]) // getOrCreateDefault
        .mockResolvedValueOnce([
          makeExceptionRow({ calendar_id: calId, exception_date: '2026-01-10', type: 'working' }),
        ]); // getExceptions - Sat is working

      // Mon 2026-01-05 to Sun 2026-01-11
      const result = await service.getNonWorkingDates(projId, '2026-01-05', '2026-01-11');

      // Sat 2026-01-10 is a working exception, so only Sun 2026-01-11 is non-working
      expect(result).toEqual(['2026-01-11']);
    });

    it('returns empty array when all days are working', async () => {
      const projId = 'proj-nwd-4';
      const calId = uniqueCalId();
      const calRow = makeCalendarRow({ id: calId, project_id: projId });
      mockQuery
        .mockResolvedValueOnce([calRow])
        .mockResolvedValueOnce([]);

      // Mon-Fri only, no exceptions
      const result = await service.getNonWorkingDates(projId, '2026-01-05', '2026-01-09');

      expect(result).toEqual([]);
    });
  });

  // ── rowToCalendar edge cases ────────────────────────────────────
  describe('rowToCalendar edge cases', () => {
    it('handles working_days as already-parsed array', async () => {
      const row = { ...makeCalendarRow(), working_days: [1, 2, 3] };
      mockQuery.mockResolvedValueOnce([row]);

      const result = await service.findById('cal-edge-1');

      expect(result!.workingDays).toEqual([1, 2, 3]);
    });

    it('falls back to Mon-Fri when working_days is invalid JSON', async () => {
      const row = { ...makeCalendarRow(), working_days: 'not-json' };
      mockQuery.mockResolvedValueOnce([row]);

      const result = await service.findById('cal-edge-2');

      expect(result!.workingDays).toEqual([1, 2, 3, 4, 5]);
    });

    it('handles is_default as boolean true', async () => {
      const row = { ...makeCalendarRow(), is_default: true };
      mockQuery.mockResolvedValueOnce([row]);

      const result = await service.findById('cal-edge-3');

      expect(result!.isDefault).toBe(true);
    });

    it('handles is_default as 0 (number)', async () => {
      const row = { ...makeCalendarRow(), is_default: 0 };
      mockQuery.mockResolvedValueOnce([row]);

      const result = await service.findById('cal-edge-4');

      expect(result!.isDefault).toBe(false);
    });

    it('handles is_default as false (boolean)', async () => {
      const row = { ...makeCalendarRow(), is_default: false };
      mockQuery.mockResolvedValueOnce([row]);

      const result = await service.findById('cal-edge-5');

      expect(result!.isDefault).toBe(false);
    });

    it('defaults hoursPerDay to 8 when hours_per_day is NaN', async () => {
      const row = { ...makeCalendarRow(), hours_per_day: 'invalid' };
      mockQuery.mockResolvedValueOnce([row]);

      const result = await service.findById('cal-edge-6');

      expect(result!.hoursPerDay).toBe(8);
    });
  });

  // ── rowToException edge cases ───────────────────────────────────
  describe('rowToException edge cases', () => {
    it('slices exception_date to YYYY-MM-DD from datetime string', async () => {
      const row = makeExceptionRow({ exception_date: '2026-12-25T00:00:00.000Z' });
      mockQuery.mockResolvedValueOnce([row]);

      const calId = uniqueCalId();
      // Use a unique calendar_id to avoid cache collisions
      row.calendar_id = calId;
      const result = await service.getExceptions(calId);

      expect(result[0].exceptionDate).toBe('2026-12-25');
    });

    it('returns undefined for name when null', async () => {
      const calId = uniqueCalId();
      const row = makeExceptionRow({ calendar_id: calId, name: null });
      mockQuery.mockResolvedValueOnce([row]);

      const result = await service.getExceptions(calId);

      expect(result[0].name).toBeUndefined();
    });
  });
});
