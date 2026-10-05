import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { planDurationEdit } from '../../components/schedule/durationEdit';
import type { WorkCalendar } from '../../utils/workingDays';

// 2026-10-08 is a Thursday. 10-10/10-11 are the weekend, 10-12 a Monday.
const THU = '2026-10-08';
const task = (over: Partial<{ startDate: string | null; isSummary: boolean; isMilestone: boolean }> = {}) =>
  ({ startDate: THU, ...over });
const end = (r: ReturnType<typeof planDurationEdit>) => (r.ok ? r.patch.endDate : `refused:${r.reason}`);

describe('planDurationEdit — typing a Duration moves the finish', () => {
  it('counts working days, start day included', () => {
    expect(end(planDurationEdit(task(), '1', null))).toBe('2026-10-08');
    expect(end(planDurationEdit(task(), '2', null))).toBe('2026-10-09');
    expect(end(planDurationEdit(task(), '3', null))).toBe('2026-10-12'); // skips the weekend
    expect(end(planDurationEdit(task(), '10', null))).toBe('2026-10-21');
  });

  it('only ever changes the finish date', () => {
    const r = planDurationEdit(task(), '3', null);
    expect(r).toEqual({ ok: true, patch: { endDate: '2026-10-12' } });
  });

  it('accepts a trailing "d" in either case', () => {
    expect(end(planDurationEdit(task(), '3d', null))).toBe('2026-10-12');
    expect(end(planDurationEdit(task(), '3D', null))).toBe('2026-10-12');
  });

  it('drops decimals (2.5 and 2.9 are 2 days), as both views always did', () => {
    expect(end(planDurationEdit(task(), '2.5', null))).toBe('2026-10-09');
    expect(end(planDurationEdit(task(), '2.9d', null))).toBe('2026-10-09');
  });

  it('skips the plan\'s holidays', () => {
    const cal: WorkCalendar = { nonWorking: new Set(['2026-10-10', '2026-10-11', '2026-10-12']), from: '2026-10-01', to: '2026-10-31' };
    expect(end(planDurationEdit(task(), '3', cal))).toBe('2026-10-13');
  });

  it('works a weekend the plan calendar marks as working', () => {
    const cal: WorkCalendar = { nonWorking: new Set(['2026-10-11']), from: '2026-10-01', to: '2026-10-31' };
    expect(end(planDurationEdit(task(), '3', cal))).toBe('2026-10-10');
  });

  it('a task starting on a weekend begins counting on the next working day', () => {
    expect(end(planDurationEdit(task({ startDate: '2026-10-10' }), '1', null))).toBe('2026-10-12');
  });

  it('accepts a start date with a time part', () => {
    expect(end(planDurationEdit(task({ startDate: '2026-10-08T00:00:00.000Z' }), '2', null))).toBe('2026-10-09');
  });

  it('refuses 0 and negative durations (a milestone is not made by typing 0)', () => {
    expect(end(planDurationEdit(task(), '0', null))).toBe('refused:too-small');
    expect(end(planDurationEdit(task(), '0d', null))).toBe('refused:too-small');
    expect(end(planDurationEdit(task(), '-2', null))).toBe('refused:too-small');
    expect(end(planDurationEdit(task({ isMilestone: true }), '0', null))).toBe('refused:too-small');
  });

  it('a milestone given 1 day finishes on its start', () => {
    expect(end(planDurationEdit(task({ isMilestone: true }), '1', null))).toBe(THU);
  });

  it('refuses blank and non-numeric text', () => {
    for (const typed of ['', ' ', 'abc', 'd', 'two']) {
      expect(end(planDurationEdit(task(), typed, null))).toBe('refused:not-a-number');
    }
  });

  it('refuses a task with no (or a broken) start date', () => {
    expect(end(planDurationEdit(task({ startDate: null }), '3', null))).toBe('refused:no-start');
    expect(end(planDurationEdit({}, '3', null))).toBe('refused:no-start');
    expect(end(planDurationEdit(task({ startDate: 'soon' }), '3', null))).toBe('refused:no-start');
  });

  it('refuses summary tasks — their dates come from the tasks under them', () => {
    expect(end(planDurationEdit(task({ isSummary: true }), '3', null))).toBe('refused:summary');
  });

  it('refuses an absurdly long duration rather than looping', () => {
    expect(end(planDurationEdit(task(), '99999', null))).toBe('refused:too-long');
  });

  it('every refusal carries a plain-English message', () => {
    for (const r of [
      planDurationEdit(task({ isSummary: true }), '3', null),
      planDurationEdit(task(), 'abc', null),
      planDurationEdit(task(), '0', null),
      planDurationEdit(task({ startDate: null }), '3', null),
      planDurationEdit(task(), '99999', null),
    ]) {
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeGreaterThan(10);
    }
  });
});

// Oct 2026: the Gantt grid and the Table view each had their own copy of this rule, so a fix
// in one never reached the other. Both must call the shared rule, for typing and for pasting.
describe('Gantt and Table use the one Duration rule', () => {
  const SCHEDULE = join(__dirname, '../../components/schedule');
  // The Gantt grid's paste path lives in gantt/hooks/useGridKeyboard.ts (moved out of GanttChart.tsx 2026-10-04)
  const GANTT_KEYBOARD = 'gantt/hooks/useGridKeyboard.ts';
  for (const file of ['GanttChart.tsx', 'TableView.tsx']) {
    const src = [file, ...(file === 'GanttChart.tsx' ? [GANTT_KEYBOARD] : [])]
      .map(f => readFileSync(join(SCHEDULE, f), 'utf8')).join('\n');
    it(`${file} calls planDurationEdit for typing and pasting`, () => {
      expect(src).toContain("from './durationEdit'");
      expect((src.match(/planDurationEdit\(/g) || []).length).toBeGreaterThanOrEqual(2);
    });
    it(`${file} does not work out the finish itself`, () => {
      expect(src).not.toMatch(/finishAfterWorkingDays/);
      expect(src).not.toMatch(/parseInt\(value\.replace\(\/d\$\/i/); // the old typed-duration parse
    });
  }
});
