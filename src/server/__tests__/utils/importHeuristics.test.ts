import { describe, it, expect } from 'vitest';
import {
  isLegendRow,
  isCellRef,
  cleanAssignee,
  workingDaySpan,
  decideDurationUnit,
  importedStatusAndProgress,
  importAsMilestone,
} from '../../utils/importHeuristics';

describe('isLegendRow', () => {
  it('skips a lone status word with empty cells', () => {
    expect(isLegendRow('Completed', ['', null, undefined])).toBe(true);
    expect(isLegendRow('Legend', [''])).toBe(true);
  });

  it('keeps a real task even if named like a status when other cells are filled', () => {
    expect(isLegendRow('Completed', ['2026-01-01'])).toBe(false);
  });

  it('keeps ordinary task names', () => {
    expect(isLegendRow('Kick-Off Meeting', ['', ''])).toBe(false);
  });
});

describe('cell references', () => {
  it('detects a whole-value cell/range ref', () => {
    expect(isCellRef('D9')).toBe(true);
    expect(isCellRef('D9:D27')).toBe(true);
    expect(isCellRef('DBJ')).toBe(false);
  });

  it('drops an assignee that is only a cell ref', () => {
    expect(cleanAssignee('D9:D27')).toBeNull();
    expect(cleanAssignee('   ')).toBeNull();
  });

  it('strips a trailing cell ref glued to a name', () => {
    expect(cleanAssignee('DBJ & JV+D9:D27')).toBe('DBJ & JV');
    expect(cleanAssignee('DBJ')).toBe('DBJ');
  });
});

describe('workingDaySpan', () => {
  it('counts inclusive weekdays', () => {
    // Mon 2026-01-05 .. Fri 2026-01-09 = 5 working days
    expect(workingDaySpan('2026-01-05', '2026-01-09')).toBe(5);
    // Mon .. next Mon = 6 working days (excludes the weekend)
    expect(workingDaySpan('2026-01-05', '2026-01-12')).toBe(6);
  });

  it('returns 0 for reversed or invalid ranges', () => {
    expect(workingDaySpan('2026-01-09', '2026-01-05')).toBe(0);
    expect(workingDaySpan('nope', '2026-01-05')).toBe(0);
  });
});

describe('decideDurationUnit', () => {
  it('detects days when values track the working-day span', () => {
    const samples = [
      { span: 5, value: 5 },
      { span: 3, value: 3 },
      { span: 10, value: 10 },
    ];
    expect(decideDurationUnit(samples)).toBe('days');
  });

  it('detects hours when values track span x 8', () => {
    const samples = [
      { span: 5, value: 40 },
      { span: 3, value: 24 },
      { span: 2, value: 16 },
    ];
    expect(decideDurationUnit(samples)).toBe('hours');
  });

  it('returns unknown when there is no usable data', () => {
    expect(decideDurationUnit([])).toBe('unknown');
    expect(decideDurationUnit([{ span: null, value: 5 }, { span: 4, value: null }])).toBe('unknown');
  });
});

describe('importedStatusAndProgress', () => {
  it('a Completed row with no progress column is 100%, not 0%', () => {
    expect(importedStatusAndProgress('completed', null, null)).toEqual({ status: 'completed', progress: 100 });
  });

  it('an actual finish date means done, even when status says Delayed (DBJ Gate 1)', () => {
    // "Delayed" maps to in_progress before this step
    expect(importedStatusAndProgress('in_progress', null, '2026-09-08')).toEqual({ status: 'completed', progress: 100 });
  });

  it('keeps an explicit progress value', () => {
    expect(importedStatusAndProgress('completed', 90, null)).toEqual({ status: 'completed', progress: 90 });
    expect(importedStatusAndProgress('in_progress', 40, null)).toEqual({ status: 'in_progress', progress: 40 });
  });

  it('leaves open and cancelled work alone', () => {
    expect(importedStatusAndProgress('in_progress', null, null)).toEqual({ status: 'in_progress', progress: 0 });
    expect(importedStatusAndProgress('pending', null, null)).toEqual({ status: 'pending', progress: 0 });
    expect(importedStatusAndProgress('cancelled', null, '2026-09-08')).toEqual({ status: 'cancelled', progress: 0 });
  });
});

describe('importAsMilestone', () => {
  it('a one-day row named like a milestone becomes a milestone (Gate 3 – UAT Sign-off)', () => {
    expect(importAsMilestone(true, '2027-01-22', '2027-01-22')).toBe(true);
    expect(importAsMilestone(true, '2027-01-22', null)).toBe(true);
  });

  it('a multi-day gate stays a task — the review work is real', () => {
    expect(importAsMilestone(true, '2026-07-22', '2026-07-31')).toBe(false);
  });

  it('needs both the name and a start date', () => {
    expect(importAsMilestone(false, '2027-01-22', '2027-01-22')).toBe(false);
    expect(importAsMilestone(true, null, null)).toBe(false);
  });
});
