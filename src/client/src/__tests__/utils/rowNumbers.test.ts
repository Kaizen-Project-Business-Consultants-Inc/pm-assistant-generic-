import { describe, it, expect } from 'vitest';
import { buildRowNumberMap, type GanttTask } from '../../components/schedule/gantt/types';
// The Morning Briefing computes the same numbers on the server — they must never disagree
import { computeScheduleRowNumbers } from '../../../../server/utils/scheduleRowNumbers';

const task = (id: string, sortOrder: number, extra: Partial<GanttTask> = {}): GanttTask =>
  ({ id, name: id, status: 'pending', sortOrder, ...extra }) as GanttTask;

describe('buildRowNumberMap (fixed, MS Project-style row numbers)', () => {
  // Shaped like the DBJ-Loans schedule: sortOrder counts from 1, and start dates are NOT in
  // plan order — so sorting by Start used to renumber SSD Part-1 from 6 to 8.
  const plan = [
    task('gate1', 3, { startDate: '2026-07-22' }),
    task('onboarding', 1, { startDate: '2026-06-19' }),
    task('ssd1', 6, { startDate: '2026-08-25' }),
    task('desk', 2, { startDate: '2026-06-26' }),
    task('coreLms', 9, { startDate: '2026-08-21' }),
    task('detailed', 4, { startDate: '2026-07-23' }),
    task('daily', 5, { startDate: '2026-08-21' }),
  ];

  it('numbers by position in the plan, regardless of the order tasks arrive in', () => {
    const rows = buildRowNumberMap(plan);
    expect(rows.get('gate1')).toBe(3);
    expect(rows.get('ssd1')).toBe(6);
    expect(rows.get('coreLms')).toBe(7);
  });

  it('gives a task the same number when the list is re-sorted by start date', () => {
    const byStart = [...plan].sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
    expect(buildRowNumberMap(byStart)).toEqual(buildRowNumberMap(plan));
  });

  it('numbers children straight after their parent, all expanded', () => {
    const rows = buildRowNumberMap([
      task('phase1', 0), task('phase2', 1),
      task('p1-b', 1, { parentTaskId: 'phase1' }), task('p1-a', 0, { parentTaskId: 'phase1' }),
      task('p2-a', 0, { parentTaskId: 'phase2' }),
    ]);
    expect(Object.fromEntries(rows)).toEqual({ phase1: 1, 'p1-a': 2, 'p1-b': 3, phase2: 4, 'p2-a': 5 });
  });

  it('breaks full ties the same way every time, whatever order the tasks arrive in', () => {
    // NSWMA case: bulk-created, every sortOrder 0, same start date, same second
    const tied = [
      task('zz', 0, { startDate: '2026-10-12', createdAt: '2026-09-24 17:15:11' } as any),
      task('bb', 0, { startDate: '2026-10-12', createdAt: '2026-09-24 17:15:10' } as any),
      task('aa', 0, { startDate: '2026-10-12', createdAt: '2026-09-24 17:15:11' } as any),
    ];
    const expected = { bb: 1, aa: 2, zz: 3 };
    expect(Object.fromEntries(buildRowNumberMap(tied))).toEqual(expected);
    expect(Object.fromEntries(buildRowNumberMap([...tied].reverse()))).toEqual(expected);
    const server = computeScheduleRowNumbers([...tied].reverse().map(t => ({ id: t.id, sortOrder: 0, startDate: t.startDate, createdAt: (t as any).createdAt })));
    expect(Object.fromEntries(server)).toEqual(expected);
  });

  it('matches the server-side numbering used by the Morning Briefing', () => {
    const nested = [
      ...plan,
      task('child-b', 2, { parentTaskId: 'desk', startDate: '2026-07-01' }),
      task('child-a', 2, { parentTaskId: 'desk', startDate: '2026-06-27' }),
      task('undated', 0, { parentTaskId: 'desk' }),
    ];
    const server = computeScheduleRowNumbers(nested.map(t => ({
      id: t.id, parentTaskId: t.parentTaskId ?? null, sortOrder: t.sortOrder, startDate: t.startDate ?? null,
    })));
    expect(Object.fromEntries(server)).toEqual(Object.fromEntries(buildRowNumberMap(nested)));
  });
});
