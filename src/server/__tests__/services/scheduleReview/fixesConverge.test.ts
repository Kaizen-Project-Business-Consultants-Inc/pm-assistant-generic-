import { describe, it, expect } from 'vitest';
import { proposeFixesDeterministic } from '../../../services/scheduleReview/fixProposer';
import { reviewSchedule, nameSaysMilestone, type ReviewInput, type ReviewTask } from '../../../services/scheduleReview/rules';

/**
 * Applying Schedule Review fixes must not feed on itself (UAT 2026-10-17: five Applies took a
 * 28-task plan to 57 — "Buffer before Buffer before Buffer before Gate 1 Approved" — while the
 * critical "first task of each phase has no predecessor" stayed unfixed).
 */
const TODAY = new Date('2026-09-16T12:00:00Z');
let seq = 0;
function task(over: Partial<ReviewTask> & { name: string }): ReviewTask {
  seq++;
  return { id: over.id ?? `t${seq}`, status: 'pending', dependencies: [], sortOrder: seq, updatedAt: '2026-09-16T00:00:00Z', ...over };
}
const input = (tasks: ReviewTask[]): ReviewInput => ({
  schedule: { id: 's1', startDate: '2026-07-06', endDate: '2027-07-06' },
  project: { startDate: '2026-07-06', endDate: '2027-07-06' },
  tasks, resources: [], baselineCount: 1, latestBaselineTasks: null, floatByTask: null, overAllocations: null, today: TODAY,
});

describe('a buffer is never a milestone', () => {
  it('"Buffer before Gate 1 Approved" and "Approve Gate 3 Deliverables" are not gates; real milestones still are', () => {
    expect(nameSaysMilestone('Buffer before Gate 1 Approved')).toBe(false);
    expect(nameSaysMilestone('Approve Gate 3 Deliverables')).toBe(false);
    expect(nameSaysMilestone('Gate 1 Approved')).toBe(true);
    expect(nameSaysMilestone('Milestone: management reserve released')).toBe(true);
  });

  it('the review does not call a buffer an unflagged milestone (R05) or a milestone with days (R04)', () => {
    seq = 0;
    const b = task({ id: 'b', name: 'Buffer before Gate 1 Approved', startDate: '2026-10-01', endDate: '2026-10-05', estimatedDays: 3 });
    const ruleIds = reviewSchedule(input([b])).findings.map(f => f.ruleId);
    expect(ruleIds).not.toContain('R05');
    expect(ruleIds).not.toContain('R04');
  });
});

describe('Propose fixes', () => {
  function plan() {
    seq = 0;
    const p1 = task({ id: 'p1', name: 'Phase 1', isSummary: true });
    const a = task({ id: 'a', name: 'Design', parentTaskId: 'p1', startDate: '2026-10-01', endDate: '2026-10-09' });
    const g = task({ id: 'g', name: 'Gate 1 Approved', parentTaskId: 'p1', isMilestone: true, startDate: '2026-10-12', endDate: '2026-10-12', dependencies: [{ dependencyId: 'a' }] });
    const p2 = task({ id: 'p2', name: 'Phase 2', isSummary: true });
    const c = task({ id: 'c', name: 'Build', parentTaskId: 'p2', startDate: '2026-10-13', endDate: '2026-10-23' });
    const d = task({ id: 'd', name: 'Test', parentTaskId: 'p2', startDate: '2026-10-26', endDate: '2026-10-30' });
    return [p1, a, g, p2, c, d];
  }

  it("links the first task of a phase to the last task of the phase before", () => {
    const fixes = proposeFixesDeterministic([], plan(), undefined, TODAY);
    const link = fixes.find(f => f.type === 'add_dependency' && f.taskId === 'c');
    expect(link?.dependsOnTaskId).toBe('g');
  });

  it('a second Apply finds nothing new to buffer or split (the fixes converge)', () => {
    const tasks = plan();
    const r20 = { ruleId: 'R20', rule: 'R20', severity: 'medium' as const, taskIds: ['g'], message: '', pointsDeducted: 0 };
    const round1 = proposeFixesDeterministic([r20], tasks, undefined, TODAY);
    const buffers = round1.filter(f => f.type === 'insert_buffer');
    expect(buffers.map(f => f.gateTaskId)).toEqual(['g']);

    // Apply the buffer the way the service does: a task named "Buffer before <gate>" takes over
    // the gate's incoming links, and the gate then waits on it.
    const gate = tasks.find(t => t.id === 'g')!;
    const buffer = task({ id: 'buf', name: `Buffer before ${gate.name}`, parentTaskId: gate.parentTaskId, startDate: '2026-10-12', endDate: '2026-10-12', dependencies: gate.dependencies });
    const after = tasks.map(t => (t.id === 'g' ? { ...t, dependencies: [{ dependencyId: 'buf' }] } : t)).concat(buffer);

    const findings = reviewSchedule(input(after)).findings;
    const round2 = proposeFixesDeterministic(findings, after, undefined, TODAY);
    expect(round2.filter(f => f.type === 'insert_buffer')).toEqual([]);
    expect(round2.filter(f => f.type === 'split_task' && f.taskId === 'buf')).toEqual([]);
  });

  it('a split gate is not split again on the next Apply', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'Build', startDate: '2026-10-01', endDate: '2026-10-09' });
    const w = task({ id: 'w', name: 'Approve Gate 3 Deliverables', startDate: '2026-10-12', endDate: '2026-10-14', estimatedDays: 3, dependencies: [{ dependencyId: 'a' }] });
    const m1 = task({ id: 'm1', name: 'Gate 3 Deliverables Approved', isMilestone: true, startDate: '2026-10-14', endDate: '2026-10-14', dependencies: [{ dependencyId: 'w' }] });
    const m2 = task({ id: 'm2', name: 'Gate 3 Approved', isMilestone: true, startDate: '2026-10-14', endDate: '2026-10-14', dependencies: [{ dependencyId: 'm1' }] });
    const tasks = [a, w, m1, m2];
    const findings = reviewSchedule(input(tasks)).findings;
    expect(findings.map(f => f.ruleId)).not.toContain('R04');
    expect(proposeFixesDeterministic(findings, tasks, undefined, TODAY).filter(f => f.type === 'split_task')).toEqual([]);
  });

  it('a phase never links back to a gate that waits on it (interleaved root gates)', () => {
    seq = 0;
    const pa = task({ id: 'pa', name: 'Phase A', isSummary: true });
    const a1 = task({ id: 'a1', name: 'Design', parentTaskId: 'pa', startDate: '2026-10-01', endDate: '2026-10-05' });
    const g1 = task({ id: 'g1', name: 'Gate 1 Approved', isMilestone: true, startDate: '2026-10-06', endDate: '2026-10-06', dependencies: [{ dependencyId: 'a1' }] });
    const pb = task({ id: 'pb', name: 'Phase B', isSummary: true });
    const b1 = task({ id: 'b1', name: 'Build', parentTaskId: 'pb', startDate: '2026-10-07', endDate: '2026-10-20' });
    const g2 = task({ id: 'g2', name: 'Gate 2 Approved', isMilestone: true, startDate: '2026-10-21', endDate: '2026-10-21', dependencies: [{ dependencyId: 'b1' }] });
    const links = proposeFixesDeterministic([], [pa, a1, g1, pb, b1, g2], undefined, TODAY).filter(f => f.type === 'add_dependency');
    expect(links.find(f => f.taskId === 'b1')?.dependsOnTaskId).toBe('g1');
    expect(links.some(f => f.taskId === 'b1' && f.dependsOnTaskId === 'g2')).toBe(false);
  });

  it('a buffer only for a gate the review flags, and never one that pushes the plan past the project end', () => {
    const tasks = plan();
    const r20 = { ruleId: 'R20', rule: 'R20', severity: 'medium' as const, taskIds: ['g'], message: '', pointsDeducted: 0 };
    expect(proposeFixesDeterministic([], tasks, undefined, TODAY).filter(f => f.type === 'insert_buffer')).toEqual([]);
    expect(proposeFixesDeterministic([r20], tasks, undefined, TODAY, '2026-10-30').filter(f => f.type === 'insert_buffer')).toEqual([]);
    expect(proposeFixesDeterministic([r20], tasks, undefined, TODAY, '2027-06-30').filter(f => f.type === 'insert_buffer')).toHaveLength(1);
  });

  it('a gate right after another milestone gets no second buffer — from the real review findings', () => {
    seq = 0;
    const w = task({ id: 'w', name: 'Build', startDate: '2026-10-01', endDate: '2026-10-28' });
    const m1 = task({ id: 'm1', name: 'Deliverables Approved', isMilestone: true, startDate: '2026-10-28', endDate: '2026-10-28', dependencies: [{ dependencyId: 'w' }] });
    const m2 = task({ id: 'm2', name: 'Gate 1 Approved', isMilestone: true, startDate: '2026-10-28', endDate: '2026-10-28', dependencies: [{ dependencyId: 'm1' }] });
    const tasks = [w, m1, m2];
    const findings = reviewSchedule({ ...input(tasks), floatByTask: new Map([['w', 0], ['m1', 0], ['m2', 0]]) }).findings;
    expect(findings.filter(f => f.ruleId === 'R20').flatMap(f => f.taskIds)).toEqual(['m1']);
    expect(proposeFixesDeterministic(findings, tasks, undefined, TODAY, '2027-06-30').filter(f => f.type === 'insert_buffer').map(f => f.gateTaskId)).toEqual(['m1']);
  });

  it('buffers in a row are added up against the project end; one that just fits is still offered', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'Design', startDate: '2026-10-01', endDate: '2026-10-28' });   // 20 working days → 3-day buffer
    const g1 = task({ id: 'g1', name: 'Gate 1 Approved', isMilestone: true, startDate: '2026-10-28', endDate: '2026-10-28', dependencies: [{ dependencyId: 'a' }] });
    const b = task({ id: 'b', name: 'Build', startDate: '2026-10-29', endDate: '2026-11-25', dependencies: [{ dependencyId: 'g1' }] }); // 20 → 3
    const g2 = task({ id: 'g2', name: 'Gate 2 Approved', isMilestone: true, startDate: '2026-11-25', endDate: '2026-11-25', dependencies: [{ dependencyId: 'b' }] });
    const tasks = [a, g1, b, g2];
    const r20 = { ruleId: 'R20', rule: 'R20', severity: 'medium' as const, taskIds: ['g1', 'g2'], message: '', pointsDeducted: 0 };
    const buffers = (end: string) => proposeFixesDeterministic([r20], tasks, undefined, TODAY, end).filter(f => f.type === 'insert_buffer').map(f => f.gateTaskId);
    expect(buffers('2026-11-30')).toEqual(['g1']);        // plan ends Wed 25 Nov: 3 working days → Mon 30 fits one, not two
    expect(buffers('2026-12-03')).toEqual(['g1', 'g2']);  // 6 working days → Thu 3 Dec exactly: both fit
  });

  it('no buffer for a gate already passed or done — it would only be a late task', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'Design', startDate: '2026-08-01', endDate: '2026-08-10' });
    const past = task({ id: 'g', name: 'Gate 1 Approved', isMilestone: true, startDate: '2026-08-11', endDate: '2026-08-11', dependencies: [{ dependencyId: 'a' }] });
    const fixes = proposeFixesDeterministic([], [a, past], undefined, TODAY);
    expect(fixes.filter(f => f.type === 'insert_buffer')).toEqual([]);
  });
});
