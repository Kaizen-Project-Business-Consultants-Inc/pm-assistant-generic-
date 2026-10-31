/**
 * indentPlan: the one indent / outdent decision for the Gantt and the Table (keys and right-click
 * menus), the messages shown afterwards, the "nothing to move" reasons, and which menu items show.
 */
import { describe, it, expect } from 'vitest';
import { planIndent, menuTargetIds, indentAvailability, selectionHint } from '../../components/schedule/shared/indentPlan';
import type { GanttTask } from '../../components/schedule/gantt/types';

const t = (id: string, name: string, parentTaskId?: string): GanttTask =>
  ({ id, name, status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', parentTaskId } as GanttTask);

// Phase 1
//   A
//     A1
//   B
// Phase 2
// C
const TASKS = [t('p1', 'Phase 1'), t('a', 'A', 'p1'), t('a1', 'A1', 'a'), t('b', 'B', 'p1'), t('p2', 'Phase 2'), t('c', 'C', 'p2')];

describe('planIndent: outdent', () => {
  it('a task under a top-level heading goes to the top level, and says so', () => {
    const p = planIndent('outdent', ['b'], TASKS, TASKS);
    expect(p).toEqual({ nothing: false, moves: [{ id: 'b', parentTaskId: null }], message: 'Outdented "B" to the top level.' });
  });

  it('a deeper task goes under its grandparent, and says which', () => {
    const p = planIndent('outdent', ['a1'], TASKS, TASKS);
    expect(p.moves).toEqual([{ id: 'a1', parentTaskId: 'p1' }]);
    expect(p.message).toBe('Outdented "A1" one level, under "Phase 1".');
  });

  it('several tasks: one message with the count; top-level ones in the selection are skipped', () => {
    const p = planIndent('outdent', ['a', 'b', 'p2'], TASKS, TASKS);
    expect(p.moves.map(m => m.id)).toEqual(['a', 'b']);
    expect(p.message).toBe('Outdented 2 tasks.');
  });

  it('a top-level task: nothing to outdent, with the name', () => {
    const p = planIndent('outdent', ['p2'], TASKS, TASKS);
    expect(p).toEqual({ nothing: true, moves: [], message: 'Nothing to outdent: "Phase 2" is already at the top level.' });
  });

  it('several top-level tasks: nothing to outdent', () => {
    expect(planIndent('outdent', ['p1', 'p2'], TASKS, TASKS).message)
      .toBe('Nothing to outdent: the selected tasks are already at the top level.');
  });

  it('no task: says so', () => {
    expect(planIndent('outdent', [], TASKS, TASKS).nothing).toBe(true);
    expect(planIndent('outdent', ['gone'], TASKS, TASKS).message).toBe('Nothing to outdent: no task is selected.');
  });
});

describe('planIndent: indent', () => {
  it('goes under the row above, and says which', () => {
    const p = planIndent('indent', ['p2'], TASKS, TASKS);
    expect(p).toEqual({ nothing: false, moves: [{ id: 'p2', parentTaskId: 'b' }], message: 'Indented "Phase 2" under "B".' });
  });

  it('the first row has nothing above', () => {
    expect(planIndent('indent', ['p1'], TASKS, TASKS)).toEqual({ nothing: true, moves: [], message: 'Nothing above to indent under.' });
  });

  it('already under the row above: nothing to do, with the name', () => {
    expect(planIndent('indent', ['a'], TASKS, TASKS).message).toBe('Nothing to indent: "A" is already under "Phase 1".');
  });

  it('several rows go under the nearest row above the first that is not itself moving', () => {
    const p = planIndent('indent', ['b', 'p2'], TASKS, TASKS);
    expect(p.moves).toEqual([{ id: 'b', parentTaskId: 'a1' }, { id: 'p2', parentTaskId: 'a1' }]);
    expect(p.message).toBe('Indented 2 tasks under "A1".');
  });

  it('a selection that starts at the top has nothing above', () => {
    expect(planIndent('indent', ['p1', 'a'], TASKS, TASKS).message).toBe('Nothing above to indent under.');
  });

  it('rows already under the target stay put; the rest move', () => {
    const p = planIndent('indent', ['a1', 'b'], TASKS, TASKS);
    // target: the row above a1 that is not selected = a; a1 is already under a
    expect(p.moves).toEqual([{ id: 'b', parentTaskId: 'a' }]);
  });

  it('works on the rows as shown (a filtered or sorted list), parents looked up in the whole plan', () => {
    const shown = [TASKS[3], TASKS[5]]; // B, C only
    expect(planIndent('indent', ['c'], shown, TASKS).moves).toEqual([{ id: 'c', parentTaskId: 'b' }]);
    expect(planIndent('outdent', ['a1'], [TASKS[2]], TASKS).moves).toEqual([{ id: 'a1', parentTaskId: 'p1' }]);
  });
});

describe('a task and the tasks under it picked together move once (the topmost only)', () => {
  // X, Phase > A > A1
  const OUT = [t('x', 'X'), t('p', 'Phase'), t('a', 'A', 'p'), t('a1', 'A1', 'a')];

  it('outdent A and A1: only A moves (A1 stays under it)', () => {
    expect(planIndent('outdent', ['a', 'a1'], OUT, OUT).moves).toEqual([{ id: 'a', parentTaskId: null }]);
  });

  it('indent Phase, A and A1 together: only Phase goes (under X); A and A1 go with it', () => {
    expect(planIndent('indent', ['p', 'a', 'a1'], OUT, OUT).moves).toEqual([{ id: 'p', parentTaskId: 'x' }]);
  });

  it('select-all outdent: nothing moves that is not topmost; X and Phase are already top level', () => {
    const p = planIndent('outdent', OUT.map(x => x.id), OUT, OUT);
    expect(p.nothing).toBe(true);
  });
});

describe('outline rules the menu mirrors', () => {
  it('a milestone can not be a heading', () => {
    const rows = [{ ...t('m', 'Go-live'), isMilestone: true } as GanttTask, t('k', 'K')];
    const p = planIndent('indent', ['k'], rows, rows);
    expect(p.nothing).toBe(true);
    expect(p.message).toMatch(/milestone/);
  });

  it('a task linked to the heading it would go under is refused with the reason', () => {
    const rows = [t('h', 'Head'), { ...t('k', 'K'), dependencies: [{ dependencyId: 'h', dependencyType: 'FS', lagDays: 0 }] } as GanttTask];
    const p = planIndent('indent', ['k'], rows, rows);
    expect(p.nothing).toBe(true);
    expect(p.message).toMatch(/linked/);
  });

  it('Indent is hidden when the list is not in plan order', () => {
    expect(indentAvailability(['b'], TASKS, TASKS, false)).toEqual({ outdent: true, indent: false });
  });
});

describe('right-click menu helpers', () => {
  it('a right-click on a selected row acts on the selection; on any other row, on that row only', () => {
    expect(menuTargetIds('b', new Set(['a', 'b']))).toEqual(['a', 'b']);
    expect(menuTargetIds('c', new Set(['a', 'b']))).toEqual(['c']);
    expect(menuTargetIds('c', new Set())).toEqual(['c']);
  });

  it('Outdent only on a task that has a parent; Indent only with a row above that is not already its parent', () => {
    expect(indentAvailability(['p1'], TASKS, TASKS)).toEqual({ outdent: false, indent: false });
    expect(indentAvailability(['a'], TASKS, TASKS)).toEqual({ outdent: true, indent: false });
    expect(indentAvailability(['b'], TASKS, TASKS)).toEqual({ outdent: true, indent: true });
    expect(indentAvailability(['p2'], TASKS, TASKS)).toEqual({ outdent: false, indent: true });
  });
});

describe('selectionHint (hidden rows)', () => {
  it('does not say 0 tasks when the selected rows are hidden under a collapsed heading', () => {
    expect(selectionHint([], 2)).toMatch(/^2 tasks selected, hidden under collapsed headings/);
    expect(selectionHint([TASKS[3]], 3)).toBe('3 tasks selected (2 hidden under collapsed headings). Tab / Shift+Tab indent or outdent. Esc clears.');
  });
});

describe('selectionHint', () => {
  it('names the one selected task', () => {
    expect(selectionHint([TASKS[3]])).toBe('1 task selected: "B". Tab / Shift+Tab indent or outdent. Esc clears.');
  });
  it('counts several', () => {
    expect(selectionHint([TASKS[3], TASKS[5]])).toBe('2 tasks selected. Tab / Shift+Tab indent or outdent. Esc clears.');
  });
});
