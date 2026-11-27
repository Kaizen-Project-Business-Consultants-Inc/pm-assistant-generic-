import { describe, it, expect } from 'vitest';
import { actualDateKindFor, withActualDate } from '../../utils/actualDateAsk';

describe('when a single change asks "Finished on" / "Started on"', () => {
  const task = { status: 'pending', isSummary: false, actualStartDate: null, actualEndDate: null };
  it('marking Completed asks for the finish day', () => {
    expect(actualDateKindFor(task, { status: 'completed' }, false)).toBe('finished');
  });
  it('marking In progress asks for the start day, once', () => {
    expect(actualDateKindFor(task, { status: 'in_progress' }, false)).toBe('started');
    expect(actualDateKindFor({ ...task, actualStartDate: '2026-11-20' }, { status: 'in_progress' }, false)).toBeNull();
  });
  it('a day already sent is not asked again', () => {
    expect(actualDateKindFor(task, { status: 'completed', actualEndDate: '2026-11-21' }, false)).toBeNull();
  });
  it('ticking Done in a done / not done plan asks for the finish day; a percent plan does not', () => {
    expect(actualDateKindFor(task, { progressPercentage: 100 }, true)).toBe('finished');
    expect(actualDateKindFor(task, { progressPercentage: 100 }, false)).toBeNull();
  });
  it('a form sends the unchanged status with 100: still asks; a deliberately different status does not', () => {
    expect(actualDateKindFor(task, { status: 'pending', progressPercentage: 100 }, true)).toBe('finished');
    expect(actualDateKindFor(task, { status: 'blocked', progressPercentage: 100 }, true)).toBeNull();
  });
  it('already completed, headings and unrelated edits are never asked', () => {
    expect(actualDateKindFor({ ...task, status: 'completed' }, { status: 'completed' }, false)).toBeNull();
    expect(actualDateKindFor({ ...task, isSummary: true }, { status: 'completed' }, false)).toBeNull();
    expect(actualDateKindFor(task, { name: 'x' }, false)).toBeNull();
    expect(actualDateKindFor(undefined, { status: 'completed' }, false)).toBeNull();
  });
  it('reopening a completed task does not ask', () => {
    expect(actualDateKindFor({ ...task, status: 'completed', actualStartDate: '2026-11-18' }, { status: 'in_progress' }, false)).toBeNull();
  });
  it('withActualDate sets the right field', () => {
    expect(withActualDate({ status: 'completed' }, 'finished', '2026-11-21')).toEqual({ status: 'completed', actualEndDate: '2026-11-21' });
    expect(withActualDate({ status: 'in_progress' }, 'started', '2026-11-24')).toEqual({ status: 'in_progress', actualStartDate: '2026-11-24' });
  });
});
