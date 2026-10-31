import { describe, it, expect } from 'vitest';
import { planMoves } from '../../services/indentPlan';

/**
 * planMoves (Mjuzi's indent_tasks and the Gantt/Table indent route): a task picked together with
 * a task above it in its own outline moves once, with that task (2026-10-30).
 */
// rows: X(1), Phase(2) > A(3) > A1(4)
const ALL = [
  { id: 'x', name: 'X' },
  { id: 'p', name: 'Phase' },
  { id: 'a', name: 'A', parentTaskId: 'p' },
  { id: 'a1', name: 'A1', parentTaskId: 'a' },
];
const rowOf = new Map(ALL.map((t, i) => [t.id, i + 1]));

describe('planMoves: parent and child picked together', () => {
  it('outdent A and A1: only A moves', () => {
    const plan = planMoves(['a', 'a1'], ALL, rowOf, { direction: 'outdent' });
    expect(plan).toMatchObject({ moves: [{ id: 'a', parentId: null }] });
  });

  it('indent Phase, A and A1: only Phase goes under X', () => {
    const plan = planMoves(['p', 'a', 'a1'], ALL, rowOf, { direction: 'indent' });
    expect(plan).toMatchObject({ moves: [{ id: 'p', parentId: 'x' }], target: 'x' });
  });

  it('select-all outdent: nothing is moved twice', () => {
    const plan = planMoves(ALL.map(t => t.id), ALL, rowOf, { direction: 'outdent' });
    expect(plan).toMatchObject({ moves: [] });
  });

  it('put under a heading: the picked descendant is not moved on its own', () => {
    const plan = planMoves(['p', 'a'], ALL, rowOf, { underTaskId: 'x' });
    expect(plan).toMatchObject({ moves: [{ id: 'p', parentId: 'x' }] });
  });
});
