import { describe, it, expect } from 'vitest';
import { withHeadingWork } from '../../components/schedule/shared/headingWork';
import { totalHours, personHours, daysForPersonHours } from '../../utils/taskWork';
import type { GanttTask } from '../../components/schedule/gantt/types';

const t = (id: string, over: Partial<GanttTask> = {}) => ({ id, name: id, status: 'pending', ...over }) as GanttTask;

describe('a heading shows the Work of the tasks under it', () => {
  it('adds up its tasks, through nested headings', () => {
    const out = withHeadingWork([
      t('phase', { isSummary: true }),
      t('sub', { isSummary: true, parentTaskId: 'phase' }),
      t('a', { parentTaskId: 'sub', estimatedDurationHours: 40 }),
      t('b', { parentTaskId: 'sub', estimatedDurationHours: 20 }),
      t('c', { parentTaskId: 'phase', estimatedDurationHours: 8.5 }),
      t('other', { estimatedDurationHours: 99 }),
    ]);
    const hours = Object.fromEntries(out.map(x => [x.id, x.estimatedDurationHours]));
    expect(hours).toMatchObject({ phase: 68.5, sub: 60, a: 40, other: 99 });
  });

  it('shows nothing for a heading with no hours under it, and leaves plans without headings alone', () => {
    const plain = [t('a', { estimatedDurationHours: 5 })];
    expect(withHeadingWork(plain)).toBe(plain);
    expect(withHeadingWork([t('h', { isSummary: true, estimatedDurationHours: 7 }), t('a', { parentTaskId: 'h' })])[0].estimatedDurationHours).toBeUndefined();
  });

  it('a loop in the data does not hang', () => {
    const out = withHeadingWork([t('x', { isSummary: true, parentTaskId: 'y' }), t('y', { isSummary: true, parentTaskId: 'x' })]);
    expect(out).toHaveLength(2);
  });
});

describe("the form's live hours are the server's (utils/taskWork on both sides)", () => {
  it('same numbers as the server test: 5 days, 100% + 50%, 8 h a day = 40 + 20 = 60', () => {
    expect(personHours(5, 100, 8)).toBe(40);
    expect(personHours(5, 50, 8)).toBe(20);
    expect(totalHours(5, [100, 50], 8)).toBe(60);
    expect(personHours(3, 25, 7.5)).toBe(5.63);
  });

  it("typing a person's hours gives the Duration that fits (whole days, rounded up, at least 1)", () => {
    expect(daysForPersonHours(40, 100, 8)).toBe(5);
    expect(daysForPersonHours(41, 100, 8)).toBe(6);
    expect(daysForPersonHours(20, 50, 8)).toBe(5);
    expect(daysForPersonHours(1, 100, 8)).toBe(1);
    expect(daysForPersonHours(Number.NaN, 100, 8)).toBeNull();
  });
});
