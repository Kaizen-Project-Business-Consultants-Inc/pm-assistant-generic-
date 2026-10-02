import { describe, it, expect } from 'vitest';
import { layoutTimelineStrip, monthTicks, placeLabels } from '../../components/schedule/gantt/timelineStrip';

/** Timeline strip layout (2026-10-01): phases = top-level summaries, milestones, lanes. */
const plan = [
  { id: 't1', name: 'T1 Inception', startDate: '2026-06-12', endDate: '2026-07-31' },
  { id: 'a', name: 'Kick-off', startDate: '2026-06-12', endDate: '2026-06-18', parentTaskId: 't1' },
  { id: 'g1', name: 'Gate 1 approved', startDate: '2026-07-31', endDate: '2026-07-31', parentTaskId: 't1', isMilestone: true },
  { id: 't2', name: 'T2 Build', startDate: '2026-07-23', endDate: '2026-11-06' },
  { id: 'b', name: 'Detailed study', startDate: '2026-07-23', endDate: '2026-08-20', parentTaskId: 't2' },
  { id: 'g2', name: 'Build complete', startDate: '2026-11-06', endDate: '2026-11-06', parentTaskId: 't2', taskType: 'milestone' },
  { id: 'loose', name: 'Loose task', startDate: '2026-08-01', endDate: '2026-08-05' },
];

describe('Timeline strip layout', () => {
  it('spans the whole project', () => {
    const l = layoutTimelineStrip(plan)!;
    expect(l.start.toDateString()).toBe(new Date(2026, 5, 12).toDateString());
    expect(l.end.toDateString()).toBe(new Date(2026, 10, 6).toDateString());
  });

  it('phases are the top-level summary tasks; overlapping ones go on a second lane', () => {
    const l = layoutTimelineStrip(plan)!;
    expect(l.phases.map(p => [p.name, p.lane])).toEqual([['T1 Inception', 0], ['T2 Build', 1]]);
    expect(l.lanes).toBe(2);
    expect(l.noPhases).toBe(false);
  });

  it('milestones by flag or type, in date order', () => {
    expect(layoutTimelineStrip(plan)!.milestones.map(m => m.names[0])).toEqual(['Gate 1 approved', 'Build complete']);
  });

  it('a plan with no summary tasks shows one project bar', () => {
    const l = layoutTimelineStrip([plan[1], plan[6]], 'My plan')!;
    expect(l.noPhases).toBe(true);
    expect(l.phases.map(p => p.name)).toEqual(['My plan']);
  });

  it('milestones on the same day share one diamond', () => {
    const l = layoutTimelineStrip([
      { id: 'x', name: 'Plan', startDate: '2026-01-01', endDate: '2026-12-31' },
      { id: 'm1', name: 'Task 4 approved', startDate: '2026-02-25', endDate: '2026-02-25', isMilestone: true },
      { id: 'm2', name: 'Gate 4 approved', startDate: '2026-02-25', endDate: '2026-02-25', isMilestone: true },
      { id: 'm3', name: 'UAT sign-off', startDate: '2026-02-25', endDate: '2026-02-25', isMilestone: true },
      { id: 'm4', name: 'Go-live', startDate: '2026-03-10', endDate: '2026-03-10', isMilestone: true },
    ])!;
    expect(l.milestones.map(m => m.names.length)).toEqual([3, 1]);
  });

  it('labels that would overlap are left for hover; a second row is used first', () => {
    // three labels 100 wide starting 10 apart: row 0, row 1, then hover only; a far one goes back to row 0
    expect(placeLabels([{ x: 0, width: 100 }, { x: 10, width: 100 }, { x: 20, width: 100 }, { x: 300, width: 100 }]))
      .toEqual([0, 1, null, 0]);
    // right-aligned labels end at x
    expect(placeLabels([{ x: 500, width: 100 }, { x: 900, width: 100, anchorEnd: true }])).toEqual([0, 0]);
  });

  it("a first-row label never runs through another milestone's diamond — it drops to the second row (2026-10-02)", () => {
    // diamonds at 100 and 150; the first label (109..259) would cross the one at 150
    const diamonds = [{ left: 92, right: 108 }, { left: 142, right: 158 }];
    expect(placeLabels([{ x: 109, width: 150 }, { x: 159, width: 60 }], 2, 8, diamonds)).toEqual([1, 0]);
    // its own diamond (to its left) does not block it
    expect(placeLabels([{ x: 109, width: 30 }], 2, 8, diamonds)).toEqual([0]);
  });

  it('no dated tasks → nothing to draw; month ticks between start and end', () => {
    expect(layoutTimelineStrip([{ id: 'z', name: 'Undated' }])).toBeNull();
    expect(monthTicks(new Date(2026, 5, 12), new Date(2026, 8, 3)).map(d => d.getMonth())).toEqual([6, 7, 8]);
  });
});
