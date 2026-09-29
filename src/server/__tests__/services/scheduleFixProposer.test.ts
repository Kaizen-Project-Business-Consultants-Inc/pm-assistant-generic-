import { describe, it, expect } from 'vitest';
import { proposeFixesDeterministic, buildGroupingFixes, splitCandidates, buildSplitFixes, buildPhaseFixes, planSplitDates } from '../../services/scheduleReview/fixProposer';
import type { Finding, ReviewTask } from '../../services/scheduleReview/rules';
import { weekdaysOnly } from '../../utils/workingDays';

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
    // Mon 5 - Mon 19 Oct is 11 working days, start day counted
    const wrong = task({ id: 'w', name: 'Build', startDate: '2026-10-05', endDate: '2026-10-19', estimatedDays: 1 });
    const right = task({ id: 'r', name: 'Design', startDate: '2026-10-05', endDate: '2026-10-19', estimatedDays: 11 });
    const fixes = proposeFixesDeterministic([], [wrong, right]);
    const dur = fixes.filter(f => f.type === 'set_duration');
    expect(dur.map(d => d.taskId)).toEqual(['w']);
    expect(dur[0].newDuration).toBe(11);
    expect(dur[0].defaultChecked).toBe(true);
  });

  it('proposes a buffer before a gate that already has a predecessor, sized ~15% of the feeder', () => {
    seq = 0;
    const work = task({ id: 'p', name: 'Build work', startDate: '2026-10-01', endDate: '2026-10-28' }); // 20 working days
    const gate = task({ id: 'g', name: 'Gate 1', isMilestone: true, dependencies: [{ dependencyId: 'p' }] });
    const buf = proposeFixesDeterministic([], [work, gate]).filter(f => f.type === 'insert_buffer');
    expect(buf).toHaveLength(1);
    expect(buf[0]).toMatchObject({ gateTaskId: 'g', bufferDays: 3 });
    expect(buf[0].defaultChecked).toBe(false); // advisory
  });

  it('does not propose a buffer for a gate with no predecessor or one already buffered', () => {
    seq = 0;
    const lone = task({ id: 'g1', name: 'Gate 1', isMilestone: true });
    const buffer = task({ id: 'b', name: 'Buffer before Gate 2', startDate: '2026-10-01', endDate: '2026-10-03' });
    const g2 = task({ id: 'g2', name: 'Gate 2', isMilestone: true, dependencies: [{ dependencyId: 'b' }] });
    const buf = proposeFixesDeterministic([], [lone, buffer, g2]).filter(f => f.type === 'insert_buffer');
    expect(buf).toHaveLength(0);
  });

  it('pre-ticks a dependency when the dates already run in sequence, unticks it when they overlap', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'A', startDate: '2026-10-01', endDate: '2026-10-05' });
    const b = task({ id: 'b', name: 'B', startDate: '2026-10-06', endDate: '2026-10-10' }); // starts after A ends
    const seqFix = proposeFixesDeterministic([], [a, b]).find(f => f.type === 'add_dependency' && f.taskId === 'b')!;
    expect(seqFix.defaultChecked).toBe(true);
    expect(seqFix.confidence).toBeGreaterThanOrEqual(0.7);

    seq = 0;
    const c = task({ id: 'c', name: 'C', startDate: '2026-10-01', endDate: '2026-10-10' });
    const d = task({ id: 'd', name: 'D', startDate: '2026-10-03', endDate: '2026-10-08' }); // overlaps C
    const overFix = proposeFixesDeterministic([], [c, d]).find(f => f.type === 'add_dependency' && f.taskId === 'd')!;
    expect(overFix.defaultChecked).toBe(false);
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

  it('a partly organised plan: a group named like an existing phase joins it (even with one task)', () => {
    const phase = task({ id: 'ph', name: 'Build', isSummary: true });
    const fixes = buildGroupingFixes([
      { phaseName: 'build', taskIds: ['c'] },
      { phaseName: 'Initiation', taskIds: ['a', 'b'] },
    ], tasks, [phase]);
    expect(fixes.map(f => [f.taskId, f.parentTaskId ?? null, f.newParentName ?? null])).toEqual([
      ['c', 'ph', null], ['a', null, 'Initiation'], ['b', null, 'Initiation'],
    ]);
  });
});


describe('Phase 2 — split bundled tasks, add missing phases', () => {
  const dated = (id: string, name: string, extra: Partial<ReviewTask> = {}) =>
    task({ id, name, startDate: '2026-10-01', endDate: '2026-10-10', ...extra });

  it('splitCandidates pre-filters names that might bundle steps, skipping milestones, summaries and done work', () => {
    seq = 0;
    const tasks = [
      dated('a', 'Circulate and obtain approval for BRD'),
      dated('b', 'Build API & deploy to staging'),
      dated('c', 'Draft / review contract'),
      dated('d', 'Write test plan'),                       // no joiner
      dated('e', 'Gate 1 sign-off and acceptance', { isMilestone: true }),
      dated('f', 'Design and build', { status: 'completed' }),
      dated('ph', 'Phase A and B', { isSummary: true }),
      dated('k', 'Child', { parentTaskId: 'ph' }),
    ];
    expect(splitCandidates(tasks).map(t => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('buildSplitFixes keeps valid splits and drops bad ones', () => {
    seq = 0;
    const cands = [dated('a', 'Circulate and obtain approval for BRD'), dated('b', 'Build API & deploy')];
    const fixes = buildSplitFixes([
      { taskId: 'a', parts: [{ name: 'Circulate BRD', days: 8 }, { name: 'BRD approved', isMilestone: true, days: 0 }], reason: 'Approval is a separate decision' },
      { taskId: 'zz', parts: [{ name: 'x' }, { name: 'y' }] },                        // unknown task
      { taskId: 'b', parts: [{ name: 'Only one part' }] },                              // too few parts
      { taskId: 'b', parts: [{ name: 'A', isMilestone: true }, { name: 'B', isMilestone: true }] }, // no work
      { taskId: 'a', parts: [{ name: 'dup' }, { name: 'dup2' }] },                      // second split of a
    ], cands);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatchObject({ type: 'split_task', taskId: 'a', taskName: 'Circulate and obtain approval for BRD', reason: 'Approval is a separate decision', defaultChecked: true });
    expect(fixes[0].parts).toEqual([{ name: 'Circulate BRD', isMilestone: false, days: 8 }, { name: 'BRD approved', isMilestone: true, days: 0 }]);
  });

  it('buildPhaseFixes accepts only phases the review found missing, one each, with real anchors', () => {
    seq = 0;
    const tasks = [dated('build', 'Build API'), dated('dep', 'Deploy to production')];
    const fixes = buildPhaseFixes([
      { phase: 'testing', name: 'System and user acceptance testing', days: 10, afterTaskId: 'build', beforeTaskId: 'dep', reason: 'No testing planned' },
      { phase: 'Testing', name: 'Another testing task' },   // second for same phase
      { phase: 'Design', name: 'Not missing' },              // not in the missing list
      { phase: 'Deployment', name: 'Go live', afterTaskId: 'nope', days: 900 },
    ], tasks, ['Testing', 'Deployment']);
    expect(fixes.map(f => f.phaseLabel)).toEqual(['Testing', 'Deployment']);
    expect(fixes[0]).toMatchObject({ type: 'add_task', newTaskName: 'System and user acceptance testing', newTaskDays: 10, afterTaskId: 'build', afterTaskName: 'Build API', beforeTaskId: 'dep' });
    expect(fixes[1]).toMatchObject({ afterTaskId: undefined, newTaskDays: 60 }); // unknown anchor dropped, length capped
  });

  it('planSplitDates shares the task span across work parts and puts milestones on the day work ends', () => {
    const plan = planSplitDates('2026-10-01', '2026-10-10', [
      { name: 'Circulate BRD', isMilestone: false, days: 8 },
      { name: 'BRD approved', isMilestone: true, days: 0 },
    ]);
    // Thu 1 - Sat 10 Oct: the working days are Thu 1 - Fri 9 (7 days); nothing lands on the weekend
    expect(plan).toEqual([
      { name: 'Circulate BRD', isMilestone: false, days: 7, startDate: '2026-10-01', endDate: '2026-10-09' },
      { name: 'BRD approved', isMilestone: true, days: 0, startDate: '2026-10-09', endDate: '2026-10-09' },
    ]);
    const three = planSplitDates('2026-10-01', '2026-10-10', [
      { name: 'Draft', isMilestone: false, days: 3 },
      { name: 'Review', isMilestone: false, days: 2 },
      { name: 'Signed', isMilestone: true, days: 0 },
    ]);
    expect(three.map(p => [p.startDate, p.endDate, p.days])).toEqual([['2026-10-01', '2026-10-06', 4], ['2026-10-07', '2026-10-09', 3], ['2026-10-09', '2026-10-09', 0]]);
  });

  it('planSplitDates always fills the span exactly and gives each work part at least a day', () => {
    const plan = planSplitDates('2026-10-05', '2026-10-07', [
      { name: 'A', isMilestone: false, days: 30 }, { name: 'B', isMilestone: false, days: 1 }, { name: 'C', isMilestone: false, days: 1 },
    ]);
    expect(plan.map(p => [p.startDate, p.endDate])).toEqual([['2026-10-05', '2026-10-05'], ['2026-10-06', '2026-10-06'], ['2026-10-07', '2026-10-07']]);
    const tight = planSplitDates('2026-10-01', '2026-10-01', [{ name: 'A', isMilestone: false, days: 1 }, { name: 'B', isMilestone: false, days: 1 }]);
    expect(tight.every(p => p.startDate === '2026-10-01' && p.endDate === '2026-10-01')).toBe(true); // more parts than days: parallel
  });
});

describe('working days (project calendar)', () => {
  const holidayMon = (d: Date) => weekdaysOnly(d) && d.toISOString().slice(0, 10) !== '2026-10-12';

  it('planSplitDates skips weekends and project holidays inside the span', () => {
    // Fri 9 - Wed 14 Oct with Mon 12 off: working days Fri 9, Tue 13, Wed 14
    const plan = planSplitDates('2026-10-09', '2026-10-14', [
      { name: 'Review', isMilestone: false, days: 2 }, { name: 'Approve', isMilestone: false, days: 1 }, { name: 'Approved', isMilestone: true, days: 0 },
    ], holidayMon);
    expect(plan.map(p => [p.name, p.startDate, p.endDate, p.days])).toEqual([
      ['Review', '2026-10-09', '2026-10-13', 2], ['Approve', '2026-10-14', '2026-10-14', 1], ['Approved', '2026-10-14', '2026-10-14', 0],
    ]);
  });

  it('a split milestone line counts its working days and passes the calendar through', () => {
    seq = 0;
    // Fri 9 - Tue 13 Oct: 3 working days on Mon-Fri, 2 with the Monday holiday
    const ms = task({ id: 'm', name: 'UAT sign-off', startDate: '2026-10-09', endDate: '2026-10-13', isMilestone: true });
    const weekdays = proposeFixesDeterministic([finding('R04', ['m'])], [ms]).find(f => f.type === 'split_task')!;
    expect(weekdays.reason).toContain('is 3 days of work');
    const holiday = proposeFixesDeterministic([finding('R04', ['m'])], [ms], holidayMon).find(f => f.type === 'split_task')!;
    expect(holiday.reason).toContain('is 2 days of work');
    // A line over a weekend only has fewer than 2 working days: nothing to split
    const weekend = task({ id: 'w', name: 'Sign-off', startDate: '2026-10-10', endDate: '2026-10-11', isMilestone: true });
    expect(proposeFixesDeterministic([finding('R04', ['w'])], [weekend]).some(f => f.type === 'split_task')).toBe(false);
  });

  it('set_duration and the buffer size use the calendar given', () => {
    seq = 0;
    // Fri 9 - Tue 13 Oct is 2 working days when Mon 12 is a holiday: an estimate of 5 disagrees
    const t = task({ id: 't', name: 'Build', startDate: '2026-10-09', endDate: '2026-10-13', estimatedDays: 5 });
    expect(proposeFixesDeterministic([], [t], holidayMon).find(f => f.type === 'set_duration')?.newDuration).toBe(2);
    // Every day worked: Thu 1 - Tue 20 Oct is 20 days → 15% = 3
    seq = 0;
    const work = task({ id: 'p', name: 'Build work', startDate: '2026-10-01', endDate: '2026-10-20' });
    const gate = task({ id: 'g', name: 'Gate 1', isMilestone: true, dependencies: [{ dependencyId: 'p' }] });
    expect(proposeFixesDeterministic([], [work, gate], () => true).find(f => f.type === 'insert_buffer')?.bufferDays).toBe(3);
  });
});

describe('milestone lines that span days are split, not flagged (user rule, 2026-09-29)', () => {
  it("splits the DBJ line into review, approve, approved and gate — in PM wording, not the source's", async () => {
    const { milestoneSplitParts } = await import('../../services/scheduleReview/fixProposer');
    const parts = milestoneSplitParts('Gate 1 – Task 1 Inception Report Review & Acceptance  (MILESTONE - 1)', 10, 'Detailed Design');
    expect(parts).toEqual([
      { name: 'Review Inception Report', isMilestone: false, days: 7 },
      { name: 'Approve Inception Report', isMilestone: false, days: 3 },
      { name: 'Inception Report Approved', isMilestone: true, days: 0 },
      { name: 'Gate 1 Approved: proceed to Detailed Design', isMilestone: true, days: 0 },
    ]);
  });

  it("names the deliverable when the source only says 'Final', and never guesses the next step from 'GO-LIVE'", async () => {
    const { milestoneSplitParts } = await import('../../services/scheduleReview/fixProposer');
    expect(milestoneSplitParts('Gate 2 – Task 2 Final Acceptance (MILESTONE- 2)', 6, null).map(p => p.name))
      .toEqual(['Approve Task 2 Deliverables', 'Task 2 Deliverables Approved', 'Gate 2 Approved']);
    expect(milestoneSplitParts('Gate 4 – Task 4 Final Acceptance (MILESTONE - 3) GO-LIVE', 7, null).map(p => p.name))
      .toEqual(['Approve Task 4 Deliverables', 'Task 4 Deliverables Approved', 'Gate 4 Approved']);
  });

  it('next step: the next phase, else the work waiting on the gate, else the next line', async () => {
    const { nextStepName } = await import('../../services/scheduleReview/fixProposer');
    const t = (id: string, name: string, extra: Record<string, unknown> = {}) =>
      ({ id, name, status: 'pending', dependencies: [], ...extra }) as any;
    // Phased plan → next phase
    const phased = [
      t('p1', 'Initiation', { isSummary: true, sortOrder: 1 }),
      t('g1', 'Gate 1 sign-off', { parentTaskId: 'p1', sortOrder: 2 }),
      t('p2', 'Detailed Design', { isSummary: true, sortOrder: 3 }),
    ];
    expect(nextStepName(phased[1], phased)).toBe('Detailed Design');
    // Flat plan (DBJ-Loans Gate 4): the work that waits on it, not "Go-Live"
    const flat = [
      t('cut', 'Go-Live Execution / Production Cutover', { sortOrder: 1, startDate: '2027-02-19' }),
      t('g4', 'Gate 4 – Task 4 Final Acceptance GO-LIVE', { sortOrder: 2, startDate: '2027-02-19' }),
      t('pgl', 'Post-Go-Live Support', { sortOrder: 3, startDate: '2027-02-26', dependencies: [{ dependencyId: 'g4', dependencyType: 'FS' }] }),
    ];
    expect(nextStepName(flat[1], flat)).toBe('Post-Go-Live Support');
    // Nothing waits on it → the next line in plan order
    const loose = [t('g', 'Gate 1', { sortOrder: 1 }), t('n', 'Detailed System Study', { sortOrder: 2 })];
    expect(nextStepName(loose[0], loose)).toBe('Detailed System Study');
    // Nothing after it at all
    expect(nextStepName(loose[1], loose)).toBeNull();
  });

  it('a sign-off line with no review becomes approve + approved', async () => {
    const { milestoneSplitParts } = await import('../../services/scheduleReview/fixProposer');
    const parts = milestoneSplitParts('UAT sign-off', 4, null);
    expect(parts.map(p => p.name)).toEqual(['Approve UAT', 'UAT Approved']);
  });
});
