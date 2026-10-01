import { describe, it, expect } from 'vitest';
import { layoutTimelineStrip, monthTicks } from '../../components/schedule/gantt/timelineStrip';

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
    expect(layoutTimelineStrip(plan)!.milestones.map(m => m.name)).toEqual(['Gate 1 approved', 'Build complete']);
  });

  it('a plan with no summary tasks shows one project bar', () => {
    const l = layoutTimelineStrip([plan[1], plan[6]], 'My plan')!;
    expect(l.noPhases).toBe(true);
    expect(l.phases.map(p => p.name)).toEqual(['My plan']);
  });

  it('close milestones alternate label rows', () => {
    const l = layoutTimelineStrip([
      { id: 'x', name: 'Start', startDate: '2026-01-01', endDate: '2026-12-31' },
      { id: 'm1', name: 'A', startDate: '2026-03-01', endDate: '2026-03-01', isMilestone: true },
      { id: 'm2', name: 'B', startDate: '2026-03-05', endDate: '2026-03-05', isMilestone: true },
      { id: 'm3', name: 'C', startDate: '2026-09-01', endDate: '2026-09-01', isMilestone: true },
    ])!;
    expect(l.milestones.map(m => m.labelRow)).toEqual([0, 1, 0]);
  });

  it('no dated tasks → nothing to draw; month ticks between start and end', () => {
    expect(layoutTimelineStrip([{ id: 'z', name: 'Undated' }])).toBeNull();
    expect(monthTicks(new Date(2026, 5, 12), new Date(2026, 8, 3)).map(d => d.getMonth())).toEqual([6, 7, 8]);
  });
});
