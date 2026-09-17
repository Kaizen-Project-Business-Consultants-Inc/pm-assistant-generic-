import { describe, it, expect } from 'vitest';
import { proposeFixesDeterministic } from '../../services/scheduleReview/fixProposer';
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

  it('produces stable, unique fix ids', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'Design' });
    const b = task({ id: 'b', name: 'Build' });
    const fixes = proposeFixesDeterministic([], [a, b]);
    const ids = fixes.map(f => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
