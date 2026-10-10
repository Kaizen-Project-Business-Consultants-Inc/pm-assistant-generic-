import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks ────────────────────────────────────────────────────────────
const mockQuery = vi.fn();
vi.mock('../../database/connection', () => ({
  databaseService: { query: (...args: any[]) => mockQuery(...args) },
}));

// The project calendar. Most tests below count every day as worked so they are
// independent of today's weekday; the working-day tests set a real calendar.
const everyDay = () => true;
const mockWorkingDayTest = vi.fn(async (_scheduleId: string): Promise<(d: Date) => boolean> => everyDay);
vi.mock('../../services/ScheduleService', () => ({
  scheduleService: { workingDayTest: (id: string) => mockWorkingDayTest(id) },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

import {
  parseRecurrenceRule,
  getNextOccurrence,
  instanceDate,
  RecurrenceService,
} from '../../services/RecurrenceService';
import { weekdaysOnly } from '../../utils/workingDays';

// ── Helpers ──────────────────────────────────────────────────────────
function makeTemplate(overrides: Record<string, any> = {}) {
  return {
    id: 'tpl-1',
    schedule_id: 'sch-1',
    name: 'Daily Standup',
    description: 'Stand-up meeting task',
    status: 'pending',
    priority: 'medium',
    assigned_to: 'user-1',
    estimated_days: 1,
    start_date: '2026-01-01',
    end_date: '2026-01-02',
    parent_task_id: null,
    is_recurrence_template: 1,
    recurrence_rule: 'FREQ=DAILY',
    created_by: 'user-1',
    ...overrides,
  };
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

// ── Tests ────────────────────────────────────────────────────────────
describe('parseRecurrenceRule', () => {
  it('should return null for empty string', () => {
    expect(parseRecurrenceRule('')).toBeNull();
  });

  it('should return null for invalid frequency', () => {
    expect(parseRecurrenceRule('FREQ=YEARLY')).toBeNull();
  });

  it('should return null for missing FREQ', () => {
    expect(parseRecurrenceRule('BYDAY=MO,TU')).toBeNull();
  });

  it('should parse DAILY frequency', () => {
    const result = parseRecurrenceRule('FREQ=DAILY');
    expect(result).toEqual({ freq: 'DAILY', byDay: undefined, byMonthDay: undefined });
  });

  it('should parse WEEKLY frequency', () => {
    const result = parseRecurrenceRule('FREQ=WEEKLY');
    expect(result).toEqual({ freq: 'WEEKLY', byDay: undefined, byMonthDay: undefined });
  });

  it('should parse BIWEEKLY frequency', () => {
    const result = parseRecurrenceRule('FREQ=BIWEEKLY');
    expect(result).toEqual({ freq: 'BIWEEKLY', byDay: undefined, byMonthDay: undefined });
  });

  it('should parse MONTHLY frequency', () => {
    const result = parseRecurrenceRule('FREQ=MONTHLY');
    expect(result).toEqual({ freq: 'MONTHLY', byDay: undefined, byMonthDay: undefined });
  });

  it('should parse BYDAY', () => {
    const result = parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO,WE,FR');
    expect(result).toEqual({
      freq: 'WEEKLY',
      byDay: ['MO', 'WE', 'FR'],
      byMonthDay: undefined,
    });
  });

  it('should parse BYMONTHDAY', () => {
    const result = parseRecurrenceRule('FREQ=MONTHLY;BYMONTHDAY=15');
    expect(result).toEqual({
      freq: 'MONTHLY',
      byDay: undefined,
      byMonthDay: 15,
    });
  });

  it('should handle whitespace in rule parts', () => {
    const result = parseRecurrenceRule('FREQ = WEEKLY ; BYDAY = TU, TH');
    expect(result).toEqual({
      freq: 'WEEKLY',
      byDay: ['TU', 'TH'],
      byMonthDay: undefined,
    });
  });

  it('should parse rule with both BYDAY and BYMONTHDAY', () => {
    const result = parseRecurrenceRule('FREQ=MONTHLY;BYDAY=MO;BYMONTHDAY=1');
    expect(result).toEqual({
      freq: 'MONTHLY',
      byDay: ['MO'],
      byMonthDay: 1,
    });
  });
});

describe('getNextOccurrence', () => {
  it('should advance by 1 day for DAILY', () => {
    const lastDate = new Date('2026-01-15');
    const result = getNextOccurrence({ freq: 'DAILY' }, lastDate);
    expect(formatDate(result)).toBe('2026-01-16');
  });

  it('should advance by 7 days for WEEKLY without byDay', () => {
    const lastDate = new Date('2026-01-15');
    const result = getNextOccurrence({ freq: 'WEEKLY' }, lastDate);
    expect(formatDate(result)).toBe('2026-01-22');
  });

  it('should advance by 14 days for BIWEEKLY without byDay', () => {
    const lastDate = new Date('2026-01-15');
    const result = getNextOccurrence({ freq: 'BIWEEKLY' }, lastDate);
    expect(formatDate(result)).toBe('2026-01-29');
  });

  it('should find next matching day for WEEKLY with byDay', () => {
    // Use local-time constructor: 2026-01-12 is Monday in local time
    const lastDate = new Date(2026, 0, 12);
    const result = getNextOccurrence({ freq: 'WEEKLY', byDay: ['WE'] }, lastDate);
    // Next Wednesday is Jan 14
    expect(formatDate(result)).toBe('2026-01-14');
  });

  it('should find next matching day for WEEKLY with multiple byDay', () => {
    // Use local-time constructor: 2026-01-12 is Monday in local time
    const lastDate = new Date(2026, 0, 12);
    const result = getNextOccurrence({ freq: 'WEEKLY', byDay: ['TU', 'TH'] }, lastDate);
    // Next Tuesday is Jan 13
    expect(formatDate(result)).toBe('2026-01-13');
  });

  it('should fall back to +7 if no byDay match found within 7 days for WEEKLY', () => {
    // byDay contains an invalid day name that won't match — fallback to +7
    const lastDate = new Date('2026-01-12');
    const result = getNextOccurrence({ freq: 'WEEKLY', byDay: ['XX'] }, lastDate);
    expect(formatDate(result)).toBe('2026-01-19');
  });

  it('should advance by 1 month for MONTHLY', () => {
    const lastDate = new Date('2026-01-15');
    const result = getNextOccurrence({ freq: 'MONTHLY' }, lastDate);
    expect(formatDate(result)).toBe('2026-02-15');
  });

  it('should clamp MONTHLY byMonthDay to last day of month', () => {
    // Start from Jan 15 with byMonthDay=31 — February only has 28 days
    const lastDate = new Date(2026, 0, 15); // Jan 15 local time
    const result = getNextOccurrence({ freq: 'MONTHLY', byMonthDay: 31 }, lastDate);
    // setMonth(+1) → Feb 15 (no overflow), then setDate(min(31,28)) → Feb 28
    expect(formatDate(result)).toBe('2026-02-28');
  });

  it('should set specific day for MONTHLY byMonthDay', () => {
    const lastDate = new Date(2026, 0, 10); // Jan 10 local time
    const result = getNextOccurrence({ freq: 'MONTHLY', byMonthDay: 15 }, lastDate);
    expect(formatDate(result)).toBe('2026-02-15');
  });

  it('should not mutate the input date', () => {
    const lastDate = new Date('2026-01-15');
    const originalTime = lastDate.getTime();
    getNextOccurrence({ freq: 'DAILY' }, lastDate);
    expect(lastDate.getTime()).toBe(originalTime);
  });

  it('should handle year boundary for DAILY', () => {
    const lastDate = new Date('2025-12-31');
    const result = getNextOccurrence({ freq: 'DAILY' }, lastDate);
    expect(formatDate(result)).toBe('2026-01-01');
  });

  it('should handle year boundary for MONTHLY', () => {
    const lastDate = new Date('2025-12-15');
    const result = getNextOccurrence({ freq: 'MONTHLY' }, lastDate);
    expect(formatDate(result)).toBe('2026-01-15');
  });

  // Audit 2026-10-09 (H2): the pattern is walked from where it started (the anchor)
  const walk = (rule: Parameters<typeof getNextOccurrence>[0], start: string, n: number) => {
    const anchor = new Date(`${start}T00:00:00Z`);
    const out: string[] = [];
    for (let d = anchor, i = 0; i < n; i++) { d = getNextOccurrence(rule, d, undefined, anchor); out.push(formatDate(d)); }
    return out;
  };

  it('BIWEEKLY with a chosen day repeats every OTHER week (it used to repeat every week)', () => {
    // the task form builds exactly this rule: "Biweekly" + Mon
    expect(walk(parseRecurrenceRule('FREQ=BIWEEKLY;BYDAY=MO')!, '2026-10-12', 4))
      .toEqual(['2026-10-26', '2026-11-09', '2026-11-23', '2026-12-07']);
  });

  it('BIWEEKLY with several days: the rest of the start week, then every other week', () => {
    // starts Wed 14 Oct, Mon + Fri: Fri 16 (same week), then the week of 26 Oct, then 9 Nov
    expect(walk(parseRecurrenceRule('FREQ=BIWEEKLY;BYDAY=MO,FR')!, '2026-10-14', 5))
      .toEqual(['2026-10-16', '2026-10-26', '2026-10-30', '2026-11-09', '2026-11-13']);
  });

  it('WEEKLY with a chosen day still repeats every week', () => {
    expect(walk(parseRecurrenceRule('FREQ=WEEKLY;BYDAY=MO')!, '2026-10-12', 3))
      .toEqual(['2026-10-19', '2026-10-26', '2026-11-02']);
  });

  it("MONTHLY keeps the start's day of the month after a short month (it drifted to the 28th)", () => {
    expect(walk({ freq: 'MONTHLY' }, '2026-01-31', 5))
      .toEqual(['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30']);
    // a leap year February
    expect(walk({ freq: 'MONTHLY' }, '2028-01-30', 2)).toEqual(['2028-02-29', '2028-03-30']);
  });
});

describe('RecurrenceService', () => {
  let service: RecurrenceService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkingDayTest.mockImplementation(async () => everyDay);
    service = new RecurrenceService();
  });

  // ── generateInstances ──────────────────────────────────────────────
  describe('generateInstances', () => {
    it('should return 0 when no templates exist', async () => {
      mockQuery.mockResolvedValueOnce([]); // templates query
      const result = await service.generateInstances();
      expect(result).toBe(0);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('should skip templates with invalid recurrence rules', async () => {
      mockQuery.mockResolvedValueOnce([makeTemplate({ recurrence_rule: 'INVALID' })]);
      const result = await service.generateInstances();
      expect(result).toBe(0);
    });

    it('should create instances up to the horizon', async () => {
      const today = new Date();
      const startDate = formatDate(today);
      const tpl = makeTemplate({ recurrence_rule: 'FREQ=DAILY', start_date: startDate });

      mockQuery
        .mockResolvedValueOnce([tpl])                // templates
        .mockResolvedValueOnce([])                    // latest instance (none)
        // For each day in horizon (14 days), need existing check + insert
        .mockResolvedValue([]);                       // existing check returns empty → insert succeeds

      const result = await service.generateInstances(3);
      // Should create instances for day+1, day+2, day+3
      expect(result).toBe(3);
    });

    it('should use latest instance date when instances exist', async () => {
      const tpl = makeTemplate({ recurrence_rule: 'FREQ=DAILY', start_date: '2026-01-01' });

      // Return a recent instance so fewer new ones are needed
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      mockQuery
        .mockResolvedValueOnce([tpl])                               // templates
        .mockResolvedValueOnce([{ start_date: formatDate(yesterday) }]) // latest instance
        .mockResolvedValue([]);                                      // existing checks + inserts

      const result = await service.generateInstances(2);
      // From yesterday, should generate today, tomorrow, day after
      expect(result).toBeGreaterThan(0);
    });

    it('should skip existing instances (no duplicates)', async () => {
      const today = new Date();
      const tpl = makeTemplate({ recurrence_rule: 'FREQ=DAILY', start_date: formatDate(today) });

      mockQuery
        .mockResolvedValueOnce([tpl])     // templates
        .mockResolvedValueOnce([])        // latest instance
        .mockImplementationOnce(async (_sql: string, params: any[]) => params.slice(1).map((d: string) => ({ d }))) // every due date already exists
        .mockResolvedValue([]);           // rest

      const result = await service.generateInstances(1);
      // The one day that fits is already existing, so 0 created
      expect(result).toBe(0);
    });

    it('should use current date when template has no start_date and no instances', async () => {
      const tpl = makeTemplate({
        recurrence_rule: 'FREQ=DAILY',
        start_date: null,
      });

      mockQuery
        .mockResolvedValueOnce([tpl])  // templates
        .mockResolvedValueOnce([])     // no instances
        .mockResolvedValue([]);        // existing checks + inserts

      const result = await service.generateInstances(2);
      expect(result).toBeGreaterThan(0);
    });

    it('should use default estimated_days of 1 when not set', async () => {
      const today = new Date();
      const tpl = makeTemplate({
        recurrence_rule: 'FREQ=DAILY',
        start_date: formatDate(today),
        estimated_days: null,
      });

      mockQuery
        .mockResolvedValueOnce([tpl])
        .mockResolvedValueOnce([])
        .mockResolvedValue([]);

      await service.generateInstances(1);

      // Find the INSERT call
      const insertCall = mockQuery.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks')
      );
      expect(insertCall).toBeDefined();
      // estimated_days param (index 7 in the params array) should be null
      expect(insertCall![1][6]).toBeNull();
    });

    it('should process multiple templates', async () => {
      const today = new Date();
      const startDate = formatDate(today);
      const tpl1 = makeTemplate({ id: 'tpl-1', recurrence_rule: 'FREQ=DAILY', start_date: startDate });
      const tpl2 = makeTemplate({ id: 'tpl-2', recurrence_rule: 'FREQ=DAILY', start_date: startDate, name: 'Task 2' });

      mockQuery
        .mockResolvedValueOnce([tpl1, tpl2]) // templates
        .mockResolvedValue([]);               // all subsequent queries

      const result = await service.generateInstances(1);
      // Each template should produce 1 instance
      expect(result).toBe(2);
    });
  });

  // ── expandTemplate ─────────────────────────────────────────────────
  describe('expandTemplate', () => {
    it('should return 0 when template not found', async () => {
      mockQuery.mockResolvedValueOnce([]); // template query
      const result = await service.expandTemplate('nonexistent');
      expect(result).toBe(0);
    });

    it('should return 0 when template has invalid recurrence rule', async () => {
      mockQuery.mockResolvedValueOnce([makeTemplate({ recurrence_rule: 'BAD' })]);
      const result = await service.expandTemplate('tpl-1');
      expect(result).toBe(0);
    });

    it('should expand a template with DAILY frequency', async () => {
      const today = new Date();
      const tpl = makeTemplate({ recurrence_rule: 'FREQ=DAILY', start_date: formatDate(today) });

      mockQuery
        .mockResolvedValueOnce([tpl])   // template
        .mockResolvedValueOnce([])      // latest instance
        .mockResolvedValue([]);         // existing checks + inserts

      const result = await service.expandTemplate('tpl-1', 3);
      expect(result).toBe(3);
    });

    it('should cap at 100 instances', async () => {
      // Use a start date far in the past so many instances could be generated
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 200);
      const tpl = makeTemplate({
        recurrence_rule: 'FREQ=DAILY',
        start_date: formatDate(pastDate),
      });

      mockQuery
        .mockResolvedValueOnce([tpl])  // template
        .mockResolvedValueOnce([])     // latest instance
        .mockResolvedValue([]);        // existing checks + inserts

      const result = await service.expandTemplate('tpl-1', 365);
      expect(result).toBeLessThanOrEqual(100);
    });

    it('should query with the provided templateTaskId', async () => {
      mockQuery.mockResolvedValueOnce([]);
      await service.expandTemplate('my-template-id');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM tasks WHERE id = ?'),
        ['my-template-id']
      );
    });

    it('should use template start_date when no instances exist', async () => {
      const tpl = makeTemplate({
        recurrence_rule: 'FREQ=WEEKLY',
        start_date: '2026-01-01',
      });

      // Set horizon to include a couple weeks
      mockQuery
        .mockResolvedValueOnce([tpl])
        .mockResolvedValueOnce([])   // no existing instances
        .mockResolvedValue([]);

      const result = await service.expandTemplate('tpl-1', 21);
      // From Jan 1, weekly → Jan 8, Jan 15, Jan 22 (if within horizon)
      expect(result).toBeGreaterThan(0);
    });

    it('should pass correct parameters in INSERT query', async () => {
      const today = new Date();
      const tpl = makeTemplate({
        recurrence_rule: 'FREQ=DAILY',
        start_date: formatDate(today),
        description: 'Test desc',
        priority: 'high',
        assigned_to: 'user-42',
        estimated_days: 3,
        parent_task_id: 'parent-1',
        created_by: 'creator-1',
      });

      mockQuery
        .mockResolvedValueOnce([tpl])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])   // existing check
        .mockResolvedValue([]);      // insert

      await service.expandTemplate('tpl-1', 1);

      const insertCall = mockQuery.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks')
      );
      expect(insertCall).toBeDefined();
      const params = insertCall![1];
      expect(params[0]).toBe('mock-uuid-1234');  // id
      expect(params[1]).toBe('sch-1');           // schedule_id
      expect(params[2]).toBe('Daily Standup');   // name
      expect(params[3]).toBe('Test desc');       // description
      expect(params[4]).toBe('high');            // priority
      expect(params[5]).toBe('user-42');         // assigned_to
      expect(params[6]).toBe(3);                 // estimated_days
      expect(params[9]).toBe('parent-1');        // parent_task_id
      expect(params[10]).toBe('tpl-1');          // recurrence_parent_id
      expect(params[11]).toBe('creator-1');      // created_by
    });

    it('should use null for optional fields when not set', async () => {
      const today = new Date();
      const tpl = makeTemplate({
        recurrence_rule: 'FREQ=DAILY',
        start_date: formatDate(today),
        description: null,
        priority: null,
        assigned_to: null,
        estimated_days: null,
        parent_task_id: null,
      });

      mockQuery
        .mockResolvedValueOnce([tpl])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValue([]);

      await service.expandTemplate('tpl-1', 1);

      const insertCall = mockQuery.mock.calls.find(
        (c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks')
      );
      expect(insertCall).toBeDefined();
      const params = insertCall![1];
      expect(params[3]).toBeNull();       // description
      expect(params[4]).toBe('medium');   // priority fallback
      expect(params[5]).toBeNull();       // assigned_to
      expect(params[6]).toBeNull();       // estimated_days
      expect(params[9]).toBeNull();       // parent_task_id
    });
  });

  // ── working days (project calendar) ────────────────────────────────
  describe('working days', () => {
    // instances are saved several to a statement (2026-10-09): 13 values a row
    const inserts = () => mockQuery.mock.calls
      .filter((c: any[]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO tasks'))
      .flatMap((c: any[]) => Array.from({ length: c[1].length / 13 }, (_, k) => ({ start: c[1][k * 13 + 7], end: c[1][k * 13 + 8] })));

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-01T12:00:00Z')); // a Thursday
    });
    afterEach(() => vi.useRealTimers());

    it('DAILY skips weekends and project holidays', async () => {
      // Mon 5 Oct is a holiday on this project
      mockWorkingDayTest.mockImplementation(async () => (d: Date) => weekdaysOnly(d) && d.toISOString().slice(0, 10) !== '2026-10-05');
      mockQuery
        .mockResolvedValueOnce([makeTemplate({ start_date: '2026-10-01', recurrence_rule: 'FREQ=DAILY' })])
        .mockResolvedValueOnce([])
        .mockResolvedValue([]);
      await service.expandTemplate('tpl-1', 6); // horizon Wed 7 Oct
      expect(inserts().map(i => i.start)).toEqual(['2026-10-02', '2026-10-06', '2026-10-07']);
      expect(mockWorkingDayTest).toHaveBeenCalledWith('sch-1');
    });

    it('WEEKLY on a holiday moves to the next working day, and the pattern keeps its weekday', async () => {
      mockWorkingDayTest.mockImplementation(async () => (d: Date) => weekdaysOnly(d) && d.toISOString().slice(0, 10) !== '2026-10-12');
      mockQuery
        .mockResolvedValueOnce([makeTemplate({ start_date: '2026-10-05', recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO' })])
        .mockResolvedValueOnce([])
        .mockResolvedValue([]);
      await service.expandTemplate('tpl-1', 20); // horizon 21 Oct
      expect(inserts().map(i => i.start)).toEqual(['2026-10-13', '2026-10-19']);
    });

    it('two pattern dates that move onto the same working day create one instance', async () => {
      mockWorkingDayTest.mockImplementation(async () => weekdaysOnly);
      mockQuery
        .mockResolvedValueOnce([makeTemplate({ start_date: '2026-10-02', recurrence_rule: 'FREQ=WEEKLY;BYDAY=SA,SU,MO' })])
        .mockResolvedValueOnce([])
        .mockResolvedValue([]);
      await service.expandTemplate('tpl-1', 5); // horizon Tue 6 Oct
      expect(inserts().map(i => i.start)).toEqual(['2026-10-05']);
    });

    it('a MONTHLY date on a weekend moves to Monday', async () => {
      mockWorkingDayTest.mockImplementation(async () => weekdaysOnly);
      mockQuery
        .mockResolvedValueOnce([makeTemplate({ start_date: '2026-09-17', recurrence_rule: 'FREQ=MONTHLY;BYMONTHDAY=17' })])
        .mockResolvedValueOnce([])
        .mockResolvedValue([]);
      await service.expandTemplate('tpl-1', 30);
      expect(inserts().map(i => i.start)).toEqual(['2026-10-19']); // 17 Oct 2026 is a Saturday
    });

    it("BIWEEKLY on Mondays creates an instance every other Monday from the template's week", async () => {
      mockWorkingDayTest.mockImplementation(async () => weekdaysOnly);
      mockQuery
        .mockResolvedValueOnce([makeTemplate({ start_date: '2026-10-05', recurrence_rule: 'FREQ=BIWEEKLY;BYDAY=MO' })])
        .mockResolvedValueOnce([])
        .mockResolvedValue([]);
      await service.expandTemplate('tpl-1', 50); // horizon Fri 20 Nov
      expect(inserts().map(i => i.start)).toEqual(['2026-10-19', '2026-11-02', '2026-11-16']);
    });

    it("MONTHLY from the 31st lands on each month's last day, not the 30th forever after", async () => {
      mockWorkingDayTest.mockImplementation(async () => weekdaysOnly);
      mockQuery
        .mockResolvedValueOnce([makeTemplate({ start_date: '2026-08-31', recurrence_rule: 'FREQ=MONTHLY' })])
        .mockResolvedValueOnce([])
        .mockResolvedValue([]);
      await service.expandTemplate('tpl-1', 90); // horizon 30 Dec
      // 30 Sep; 31 Oct is a Saturday → Mon 2 Nov; 30 Nov
      expect(inserts().map(i => i.start)).toEqual(['2026-09-30', '2026-11-02', '2026-11-30']);
    });

    it('an instance finishes after its duration in working days, the start day counted', async () => {
      mockWorkingDayTest.mockImplementation(async () => weekdaysOnly);
      mockQuery
        .mockResolvedValueOnce([makeTemplate({ start_date: '2026-10-01', recurrence_rule: 'FREQ=DAILY', estimated_days: 2 })])
        .mockResolvedValueOnce([])
        .mockResolvedValue([]);
      await service.expandTemplate('tpl-1', 1); // horizon Fri 2 Oct
      expect(inserts()).toEqual([{ start: '2026-10-02', end: '2026-10-05' }]); // Fri + 2 days → Mon
    });

    it('falls back to Mon–Fri when the calendar cannot be read', async () => {
      mockWorkingDayTest.mockRejectedValue(new Error('db down'));
      mockQuery
        .mockResolvedValueOnce([makeTemplate({ start_date: '2026-10-01', recurrence_rule: 'FREQ=DAILY' })])
        .mockResolvedValueOnce([])
        .mockResolvedValue([]);
      await service.expandTemplate('tpl-1', 5); // horizon Tue 6 Oct
      expect(inserts().map(i => i.start)).toEqual(['2026-10-02', '2026-10-05', '2026-10-06']);
    });

    it('instanceDate keeps a working day and moves a day off forward', () => {
      expect(formatDate(instanceDate(new Date('2026-10-02'), weekdaysOnly))).toBe('2026-10-02');
      expect(formatDate(instanceDate(new Date('2026-10-03'), weekdaysOnly))).toBe('2026-10-05');
    });

    it('getNextOccurrence DAILY with a calendar steps to the next working day', () => {
      expect(formatDate(getNextOccurrence({ freq: 'DAILY' }, new Date('2026-10-02'), weekdaysOnly))).toBe('2026-10-05');
    });
  });

  // ── deleteChildren ─────────────────────────────────────────────────
  describe('deleteChildren', () => {
    it('should return affectedRows from query result', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 5 });
      const result = await service.deleteChildren('tpl-1');
      expect(result).toBe(5);
    });

    it('should return 0 when no rows affected', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 0 });
      const result = await service.deleteChildren('tpl-1');
      expect(result).toBe(0);
    });

    it('should return 0 when result has no affectedRows property', async () => {
      mockQuery.mockResolvedValueOnce({});
      const result = await service.deleteChildren('tpl-1');
      expect(result).toBe(0);
    });

    it('should return 0 when result is null/undefined', async () => {
      mockQuery.mockResolvedValueOnce(null);
      const result = await service.deleteChildren('tpl-1');
      expect(result).toBe(0);
    });

    it('should pass the correct templateTaskId in DELETE query', async () => {
      mockQuery.mockResolvedValueOnce({ affectedRows: 0 });
      await service.deleteChildren('my-template-id');
      expect(mockQuery).toHaveBeenCalledWith(
        'DELETE FROM tasks WHERE recurrence_parent_id = ?',
        ['my-template-id']
      );
    });
  });
});
