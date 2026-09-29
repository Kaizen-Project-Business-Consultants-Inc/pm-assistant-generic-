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

import { CalendarService, type ProjectCalendar, type CalendarSpec } from '../../services/CalendarService';

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
      mockQuery.mockResolvedValueOnce({ affectedRows: 1 });
      expect(await service.removeException('exc-1')).toBe(true);
    });

    it('returns false when exception does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 0 });
      expect(await service.removeException('exc-missing')).toBe(false);
    });
  });

  // ── isWorking (static, pure) ─────────────────────────────────────
  describe('isWorking', () => {
    const spec = (over: Partial<CalendarSpec> = {}): CalendarSpec => ({
      workingDays: [1, 2, 3, 4, 5], holidays: new Set(), working: new Set(), company: new Set(), ...over,
    });

    it('weekdays are worked, weekends are not', () => {
      expect(CalendarService.isWorking('2026-01-05', spec())).toBe(true);  // Mon
      expect(CalendarService.isWorking('2026-01-10', spec())).toBe(false); // Sat
    });
    it("a project's day off is not worked", () => {
      expect(CalendarService.isWorking('2026-01-07', spec({ holidays: new Set(['2026-01-07']) }))).toBe(false);
    });
    it('a Saturday marked working is worked', () => {
      expect(CalendarService.isWorking('2026-01-10', spec({ working: new Set(['2026-01-10']) }))).toBe(true);
    });
    it('a company holiday is not worked, unless the project marks it working', () => {
      const company = new Set(['2026-12-25']);
      expect(CalendarService.isWorking('2026-12-25', spec({ company }))).toBe(false);
      expect(CalendarService.isWorking('2026-12-25', spec({ company, working: new Set(['2026-12-25']) }))).toBe(true);
    });
    it('respects custom working days (Sat–Wed)', () => {
      const s = spec({ workingDays: [6, 0, 1, 2, 3] });
      expect(CalendarService.isWorking('2026-01-10', s)).toBe(true);  // Sat
      expect(CalendarService.isWorking('2026-01-08', s)).toBe(false); // Thu
    });
    it('a bad date is not worked', () => {
      expect(CalendarService.isWorking('not-a-date', spec())).toBe(false);
    });
  });

  /** calendarSpec reads: default calendar, its exceptions, company holidays */
  function mockSpec(opts: { exceptions?: any[]; company?: Array<{ id: string; holiday_date: string; name: string }>; workingDays?: number[] } = {}) {
    const calId = uniqueCalId();
    mockQuery
      .mockResolvedValueOnce([makeCalendarRow({ id: calId, working_days: JSON.stringify(opts.workingDays ?? [1, 2, 3, 4, 5]) })])
      .mockResolvedValueOnce((opts.exceptions ?? []).map(e => makeExceptionRow({ calendar_id: calId, ...e })))
      .mockResolvedValueOnce(opts.company ?? []);
  }

  describe('addWorkingDays / countWorkingDays', () => {
    it('adds working days across a weekend and a company holiday', async () => {
      mockSpec({ company: [{ id: 'h1', holiday_date: '2026-01-12', name: 'Test' }] });
      // Fri 9 Jan + 2 working days: Mon 12 is a company holiday → Tue 13, Wed 14
      expect(await service.addWorkingDays('2026-01-09', 2, 'proj-1')).toBe('2026-01-14');
    });
    it('goes backward for negative days', async () => {
      mockSpec();
      expect(await service.addWorkingDays('2026-01-12', -1, 'proj-1')).toBe('2026-01-09');
    });
    it('counts working days, skipping a project day off', async () => {
      mockSpec({ exceptions: [{ exception_date: '2026-01-07', type: 'holiday' }] });
      expect(await service.countWorkingDays('2026-01-05', '2026-01-11', 'proj-1')).toBe(4);
    });
  });

  describe('getNonWorkingDates', () => {
    it('lists weekends, project days off and company holidays; not a Saturday marked working', async () => {
      mockSpec({
        exceptions: [
          { exception_date: '2026-01-07', type: 'holiday' },
          { exception_date: '2026-01-10', type: 'working' },
        ],
        company: [{ id: 'h1', holiday_date: '2026-01-06', name: 'Company day' }],
      });
      const result = await service.getNonWorkingDates('proj-1', '2026-01-05', '2026-01-11');
      expect(result).toEqual(['2026-01-06', '2026-01-07', '2026-01-11']);
    });
    it('returns nothing for a bad range', async () => {
      mockSpec();
      expect(await service.getNonWorkingDates('proj-1', 'bad', '2026-01-11')).toEqual([]);
    });
  });

  describe('company holidays', () => {
    it('lists them as plain dates', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'h1', holiday_date: '2026-12-25', name: 'Christmas Day' }]);
      expect(await service.listCompanyHolidays()).toEqual([{ id: 'h1', date: '2026-12-25', name: 'Christmas Day' }]);
    });
    it('remove returns what was removed, or null', async () => {
      mockQuery.mockResolvedValueOnce([{ id: 'h1', holiday_date: '2026-12-25', name: 'Christmas Day' }]).mockResolvedValueOnce({ affectedRows: 1 });
      expect(await service.removeCompanyHoliday('h1')).toEqual({ id: 'h1', date: '2026-12-25', name: 'Christmas Day' });
      mockQuery.mockResolvedValueOnce([]);
      expect(await service.removeCompanyHoliday('nope')).toBeNull();
    });
  });

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
