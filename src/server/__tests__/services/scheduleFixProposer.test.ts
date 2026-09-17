import { describe, it, expect } from 'vitest';
import { proposeFixesDeterministic, buildGroupingFixes } from '../../services/scheduleReview/fixProposer';
import type { Finding, ReviewTask } from '../../services/scheduleReview/rules';

let seq = 0;
function task(over: Partial<ReviewTask> & { name: string }): ReviewTask {
  seq++;
  return { id: over.id ?? `t${seq}`, status: 'pending', dependencies: [], sortOrder: seq, ...over };
}
function finding(ruleId: string, taskIds: string[] = []): Finding {
  return { ruleId, rule: ruleId, severity: 'low', taskIds, message: ruleId, pointsDeducted: 0 };
}

describe('proposeFixesDeterministic', () => {
  it('proposes a finish-to-start chain for a flat, unlinked schedule', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'Design' });
    const b = task({ id: 'b', name: 'Build' });
    const c = task({ id: 'c', name: 'Test' });
    const fixes = proposeFixesDeterministic([], [a, b, c]);
    const deps = fixes.filter(f => f.type === 'add_dependency');
    expect(deps.map(d => [d.taskId, d.dependsOnTaskId])).toEqual([['b', 'a'], ['c', 'b']]);
    expect(deps[0].dependencyType).toBe('FS');
    expect(deps[0].defaultChecked).toBe(false); // 0.55 < 0.6, unticked
  });

  it('does not re-link a task that already has a dependency', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'Design' });
    const b = task({ id: 'b', name: 'Build', dependencies: [{ dependencyId: 'a' }] });
    const c = task({ id: 'c', name: 'Test' });
    const fixes = proposeFixesDeterministic([], [a, b, c]);
    const deps = fixes.filter(f => f.type === 'add_dependency');
    // b already linked → only c gets a proposal (after b)
    expect(deps.map(d => d.taskId)).toEqual(['c']);
  });

  it('proposes milestone flags from R05 findings, skipping already-flagged tasks', () => {
    seq = 0;
    const g1 = task({ id: 'g1', name: 'Gate 1' });
    const g2 = task({ id: 'g2', name: 'Gate 2', isMilestone: true });
    const fixes = proposeFixesDeterministic([finding('R05', ['g1', 'g2'])], [g1, g2]);
    const ms = fixes.filter(f => f.type === 'set_milestone');
    expect(ms.map(m => m.taskId)).toEqual(['g1']);
    expect(ms[0].confidence).toBe(0.9);
    expect(ms[0].defaultChecked).toBe(true);
  });

  it('proposes phase parents only when flat (R23) and names share a prefix', () => {
    seq = 0;
    const t1 = task({ id: 'a', name: 'T1 Kickoff' });
    const t2 = task({ id: 'b', name: 'T1 Planning' });
    const t3 = task({ id: 'c', name: 'Standalone' });
    // Without R23: no parent proposals
    expect(proposeFixesDeterministic([], [t1, t2, t3]).some(f => f.type === 'set_parent')).toBe(false);
    // With R23: group the two "T1" tasks under a phase
    const fixes = proposeFixesDeterministic([finding('R23')], [t1, t2, t3]);
    const parents = fixes.filter(f => f.type === 'set_parent');
    expect(parents.map(p => p.taskId).sort()).toEqual(['a', 'b']);
    expect(parents.every(p => p.newParentName === 'T1')).toBe(true);
  });

  it('proposes set_duration when estimatedDays disagrees with the date span, not when it agrees', () => {
    seq = 0;
    const wrong = task({ id: 'w', name: 'Build', startDate: '2026-10-05', endDate: '2026-10-19', estimatedDays: 1 });
    const right = task({ id: 'r', name: 'Design', startDate: '2026-10-05', endDate: '2026-10-19', estimatedDays: 14 });
    const fixes = proposeFixesDeterministic([], [wrong, right]);
    const dur = fixes.filter(f => f.type === 'set_duration');
    expect(dur.map(d => d.taskId)).toEqual(['w']);
    expect(dur[0].newDuration).toBe(14);
    expect(dur[0].defaultChecked).toBe(true);
  });

  it('produces stable, unique fix ids', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'Design' });
    const b = task({ id: 'b', name: 'Build' });
    const fixes = proposeFixesDeterministic([], [a, b]);
    const ids = fixes.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('buildGroupingFixes (AI phase grouping → set_parent)', () => {
  const tasks = [
    task({ id: 'a', name: 'Kick-off' }),
    task({ id: 'b', name: 'Onboarding' }),
    task({ id: 'c', name: 'Build config' }),
    task({ id: 'd', name: 'Integration' }),
  ];

  it('turns groups into set_parent fixes under the phase name', () => {
    const fixes = buildGroupingFixes([
      { phaseName: 'Initiation', taskIds: ['a', 'b'] },
      { phaseName: 'Build', taskIds: ['c', 'd'] },
    ], tasks);
    expect(fixes.map(f => [f.taskId, f.newParentName])).toEqual([
      ['a', 'Initiation'], ['b', 'Initiation'], ['c', 'Build'], ['d', 'Build'],
    ]);
    expect(fixes.every(f => f.type === 'set_parent' && f.defaultChecked)).toBe(true);
  });

  it('drops unknown ids and single-member groups, and never groups a task twice', () => {
    const fixes = buildGroupingFixes([
      { phaseName: 'Solo', taskIds: ['a'] },              // single member → dropped
      { phaseName: 'Ghost', taskIds: ['zzz', 'yyy'] },    // unknown ids → dropped
      { phaseName: 'Real', taskIds: ['a', 'b', 'a'] },    // 'a' de-duped within group
    ], tasks);
    expect(fixes.map(f => f.taskId)).toEqual(['a', 'b']);
    expect(fixes.every(f => f.newParentName === 'Real')).toBe(true);
  });
});
