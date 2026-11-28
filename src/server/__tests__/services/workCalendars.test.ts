import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Many projects' calendars for the Work (hours) rule are read in one batch (2026-11-28): a portfolio read touched every
 * project and one calendar read per project flooded the database connections on staging.
 */
const query = vi.hoisted(() => vi.fn(async (..._a: any[]): Promise<any[]> => []));
vi.mock('../../database/connection', () => ({ databaseService: { query, queryOn: vi.fn(), transaction: vi.fn() } }));

import { CalendarService } from '../../services/CalendarService';

describe('CalendarService.workCalendars', () => {
  const service = new CalendarService();
  beforeEach(() => {
    vi.clearAllMocks();
    query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes('FROM project_calendars')) return [
        { id: 'c1', project_id: 'p1', name: 'Standard', working_days: '[1,2,3,4,5]', hours_per_day: 6, is_default: 1, created_at: '', updated_at: '' },
      ];
      if (s.includes('FROM projects p')) return [{ id: 'p1', cal: 'home' }, { id: 'p2', cal: 'home' }];
      if (s.includes('FROM calendar_exceptions')) return [{ id: 'e1', calendar_id: 'c1', exception_date: '2026-10-14', type: 'holiday', name: 'Day off', created_at: '' }];
      if (s.includes('FROM company_holidays')) return [{ id: 'h1', calendar_id: 'home', holiday_date: '2026-10-15', name: 'Company day' }];
      return [];
    });
  });

  it('answers many projects in four reads, with each calendar\'s hours and days off', async () => {
    const out = await service.workCalendars(['p1', 'p2', 'p1']);
    expect(query).toHaveBeenCalledTimes(4);
    const p1 = out.get('p1')!;
    expect(p1.hoursPerDay).toBe(6);
    expect(p1.isWorking('2026-10-13')).toBe(true);  // Tuesday
    expect(p1.isWorking('2026-10-14')).toBe(false); // the project's own holiday
    expect(p1.isWorking('2026-10-15')).toBe(false); // the company holiday
    expect(p1.isWorking('2026-10-17')).toBe(false); // Saturday
  });

  it('a project with no calendar row yet gets Monday to Friday at 8 hours, and nothing is created', async () => {
    const p2 = (await service.workCalendars(['p1', 'p2'])).get('p2')!;
    expect(p2.hoursPerDay).toBe(8);
    expect(p2.isWorking('2026-10-13')).toBe(true);
    expect(p2.isWorking('2026-10-17')).toBe(false);
    expect(p2.isWorking('2026-10-15')).toBe(false); // the company holiday still applies
    expect(query.mock.calls.some(c => String(c[0]).startsWith('INSERT'))).toBe(false);
  });

  it('no projects asks nothing', async () => {
    expect((await service.workCalendars([])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
