import { describe, it, expect } from 'vitest';
import { proposeFixesDeterministic, buildGroupingFixes, splitCandidates, buildSplitFixes, buildPhaseFixes, planSplitDates, withSeverity, suggestSummaryName, unaddressedFindings, type ProposedFix } from '../../services/scheduleReview/fixProposer';
import { reviewSchedule, type Finding, type ReviewTask } from '../../services/scheduleReview/rules';
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
    const buf = proposeFixesDeterministic([finding('R20', ['g'])], [work, gate], undefined, new Date('2026-09-01')).filter(f => f.type === 'insert_buffer');
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

  it("a task that feeds nothing (R02) gets a link to the next step — same phase first, never a loop (2026-10-02)", () => {
    seq = 0;
    const integ = task({ id: 'i', name: 'Integration', parentTaskId: 'dev', startDate: '2026-11-24', endDate: '2026-12-02' });
    const sec = task({ id: 's', name: 'Security Review', parentTaskId: 'qa', startDate: '2026-12-03', endDate: '2026-12-09', dependencies: [{ dependencyId: 'i' }] });
    const launch = task({ id: 'l', name: 'Launch prep', parentTaskId: 'go', startDate: '2026-12-10', endDate: '2026-12-11' });
    const uat = task({ id: 'u', name: 'User Acceptance Testing', parentTaskId: 'qa', startDate: '2026-12-14', endDate: '2026-12-18' });
    const tasks = [task({ id: 'dev', name: 'Development' }), task({ id: 'qa', name: 'Testing' }), task({ id: 'go', name: 'Go-live' }), integ, sec, launch, uat];
    const deps = proposeFixesDeterministic([finding('R02', ['s'])], tasks).filter(f => f.id === 'add_dependency:u:s');
    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({ taskId: 'u', dependsOnTaskId: 's', dependencyType: 'FS', defaultChecked: true });

    // the only later task already sits upstream of it → no proposal (would loop)
    seq = 0;
    const a = task({ id: 'a', name: 'A', startDate: '2026-12-01', endDate: '2026-12-02' });
    const b = task({ id: 'b', name: 'B', startDate: '2026-12-10', endDate: '2026-12-11' });
    const c = task({ id: 'c', name: 'C', startDate: '2026-12-03', endDate: '2026-12-04', dependencies: [{ dependencyId: 'b' }] });
    a.dependencies = [{ dependencyId: 'c' }];
    const loop = proposeFixesDeterministic([finding('R02', ['a'])], [a, b, c]).filter(f => /feeds nothing/.test(f.reason));
    expect(loop).toHaveLength(0);
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
    expect(proposeFixesDeterministic([finding('R20', [gate.id])], [work, gate], () => true, new Date('2026-09-01')).find(f => f.type === 'insert_buffer')?.bufferDays).toBe(3);
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

  it("a go-live line becomes the go-live moment and the work around it — not 'Approve Monitoring' (2026-10-01)", async () => {
    const { milestoneSplitParts } = await import('../../services/scheduleReview/fixProposer');
    expect(milestoneSplitParts('Go-Live & Monitoring', 5, null)).toEqual([
      { name: 'Go-Live Complete', isMilestone: true, days: 0 },
      { name: 'Hypercare & Monitoring', isMilestone: false, days: 5 },
    ]);
    expect(milestoneSplitParts('Go-Live', 3, null).map(p => [p.name, p.isMilestone])).toEqual([['Go-Live Cutover', false], ['Go-Live Complete', true]]);
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

describe('withSeverity', () => {
  const f = (ruleId: string, severity: Finding['severity'], taskIds: string[] = []): Finding =>
    ({ ruleId, rule: ruleId, severity, taskIds, message: '', pointsDeducted: 0 });
  const fix = (over: Partial<ProposedFix>): ProposedFix =>
    ({ id: over.id ?? 'x', type: 'add_dependency', confidence: 0.5, reason: '', defaultChecked: false, ...over });

  it("takes the highest level among the findings that cover the fix's task", () => {
    const [link] = withSeverity(
      [fix({ type: 'add_dependency', taskId: 'b', dependsOnTaskId: 'a' })],
      [f('R02', 'high', ['a']), f('R01', 'critical', ['b']), f('R01', 'critical', ['zzz'])],
    );
    expect(link.severity).toBe('critical');
  });

  it('checks the task a link starts from too (R02 on the feeder)', () => {
    const [link] = withSeverity([fix({ taskId: 'b', dependsOnTaskId: 'a' })], [f('R02', 'high', ['a'])]);
    expect(link.severity).toBe('high');
  });

  it('reads each rule on its own end: R01 on the feeder does not make the link critical', () => {
    // the feeder 'a' has no predecessor (R01) and feeds nothing (R02); this link fixes R02 only
    const [link] = withSeverity(
      [fix({ taskId: 'b', dependsOnTaskId: 'a' })],
      [f('R01', 'critical', ['a']), f('R02', 'high', ['a'])],
    );
    expect(link.severity).toBe('high');
    // and R02 on the waiting task is not this link's business either
    const [other] = withSeverity([fix({ taskId: 'b', dependsOnTaskId: 'a' })], [f('R02', 'high', ['b'])]);
    expect(other.severity).toBe('critical'); // no matching finding → R01's own level
  });

  it('a whole-plan finding (R03, R23, R31) covers every task', () => {
    const out = withSeverity([
      fix({ id: '1', type: 'add_dependency', taskId: 'b', dependsOnTaskId: 'a' }),
      fix({ id: '2', type: 'set_parent', taskId: 'c', newParentName: 'P' }),
      fix({ id: '3', type: 'add_task', phaseLabel: 'Testing', newTaskName: 'UAT' }),
    ], [f('R03', 'critical'), f('R23', 'high'), f('R31', 'medium')]);
    expect(out.map(x => x.severity)).toEqual(['critical', 'high', 'medium']);
  });

  it('insert_buffer looks at its gate; set_duration at R12/R28', () => {
    const out = withSeverity([
      fix({ id: '1', type: 'insert_buffer', gateTaskId: 'g' }),
      fix({ id: '2', type: 'set_duration', taskId: 't', newDuration: 5 }),
    ], [f('R20', 'medium', ['g']), f('R28', 'medium', ['t'])]);
    expect(out.map(x => x.severity)).toEqual(['medium', 'medium']);
  });

  it("falls back to the rule's own level; info counts as low; an AI split answers no rule (low)", () => {
    const out = withSeverity([
      fix({ id: '1', type: 'add_dependency', taskId: 'b', dependsOnTaskId: 'a' }),
      fix({ id: '2', type: 'set_milestone', taskId: 'm' }),
      fix({ id: '3', type: 'split_task', taskId: 's', replace: true }),
      fix({ id: '4', type: 'split_task', taskId: 'ai' }),
      fix({ id: '5', type: 'rename_task', taskId: 'r', newName: 'Task 1' }),
      fix({ id: '6', type: 'set_duration', taskId: 'i' }),
    ], [f('R12', 'info', ['i'])]);
    expect(out.map(x => x.severity)).toEqual(['critical', 'medium', 'high', 'low', 'low', 'low']);
  });
});

describe('rename_task (R22 on a heading)', () => {
  it('suggests a name from the code and the first task under it', () => {
    expect(suggestSummaryName('T1', 'Kick-Off Meeting & Project Governance')).toBe('Task 1 – Kick-Off Meeting');
    expect(suggestSummaryName('T 2', 'Requirements / Analysis')).toBe('Task 2 – Requirements');
    expect(suggestSummaryName('Task3', 'Design (high level)')).toBe('Task 3 – Design');
    expect(suggestSummaryName('PG', 'Post-Go-Live Support')).toBe('Post-Go-Live Support');
    expect(suggestSummaryName('T4', null)).toBe('Task 4');
    expect(suggestSummaryName('PG', null)).toBeNull();
    expect(suggestSummaryName('Build', 'Build')).toBeNull(); // nothing better
  });

  it('rules 1.10: a heading called "PG" is flagged by R22 and offered its first task\'s name', () => {
    seq = 0;
    const pg = task({ id: 'pg', name: 'PG', isSummary: true });
    const kids = [
      task({ id: 'k1', name: 'Post-Go-Live Support', parentTaskId: 'pg', startDate: '2026-11-02', endDate: '2026-11-06' }),
      task({ id: 'k2', name: 'Hypercare, monitoring', parentTaskId: 'pg', startDate: '2026-11-09', endDate: '2026-11-13' }),
    ];
    const review = reviewSchedule({
      schedule: { id: 's1', startDate: '2026-11-02', endDate: '2026-12-31' },
      project: { startDate: '2026-11-02', endDate: '2026-12-31' },
      tasks: [pg, ...kids], resources: [], baselineCount: 1, latestBaselineTasks: null,
      floatByTask: null, overAllocations: null, today: new Date('2026-10-17T00:00:00Z'),
    });
    const renames = proposeFixesDeterministic(review.findings, [pg, ...kids]).filter(f => f.type === 'rename_task');
    expect(renames.map(r => r.newName)).toEqual(['Post-Go-Live Support']);
  });

  it('proposes a rename for a flagged heading only; a flagged leaf keeps the finding', () => {
    seq = 0;
    const t1 = task({ id: 'h1', name: 'T1', isSummary: true });
    const k1 = task({ id: 'k1', name: 'Kick-Off Meeting & Project Governance', parentTaskId: 'h1' });
    const k2 = task({ id: 'k2', name: 'Charter', parentTaskId: 'h1' });
    const pg = task({ id: 'h2', name: 'PG' });
    const p1 = task({ id: 'p1', name: 'Post-Go-Live Support', parentTaskId: 'h2' });
    const p2 = task({ id: 'p2', name: 'Hypercare, monitoring', parentTaskId: 'h2' });
    const leaf = task({ id: 'l1', name: 'A12' });
    const fixes = proposeFixesDeterministic([finding('R22', ['h1', 'h2', 'l1'])], [t1, k1, k2, pg, p1, p2, leaf]);
    const renames = fixes.filter(x => x.type === 'rename_task');
    expect(renames.map(r => [r.taskId, r.newName])).toEqual([['h1', 'Task 1 – Kick-Off Meeting'], ['h2', 'Post-Go-Live Support']]);
    expect(renames[0]).toMatchObject({ id: 'rename_task:h1', taskName: 'T1', confidence: 0.6 });
  });
});

describe('links between tasks that run at the same time (2026-10-18)', () => {
  it('marks a link overlapping when the task starts before the one it would follow finishes', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'Design', startDate: '2026-10-05', endDate: '2026-10-09' });
    const b = task({ id: 'b', name: 'Build', startDate: '2026-10-12', endDate: '2026-10-16' });
    const c = task({ id: 'c', name: 'Test', startDate: '2026-10-14', endDate: '2026-10-20' });
    const deps = proposeFixesDeterministic([], [a, b, c]).filter(f => f.type === 'add_dependency');
    expect(deps.map(d => [d.taskId, d.overlaps, d.confidence])).toEqual([['b', false, 0.75], ['c', true, 0.5]]);
  });

  it('back to back on the same day overlaps: a finish-to-start link moves the second task a day', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'Design', startDate: '2026-10-05', endDate: '2026-10-09' });
    const b = task({ id: 'b', name: 'Build', startDate: '2026-10-09', endDate: '2026-10-16' });
    const deps = proposeFixesDeterministic([], [a, b]).filter(f => f.type === 'add_dependency');
    expect(deps.map(d => [d.taskId, d.overlaps, d.confidence])).toEqual([['b', true, 0.5]]);
  });

  it('the first task of a phase: same rule', () => {
    seq = 0;
    const p1 = task({ id: 'p1', name: 'Phase 1', isSummary: true });
    const p2 = task({ id: 'p2', name: 'Phase 2', isSummary: true });
    const a = task({ id: 'a', name: 'Design', parentTaskId: 'p1', startDate: '2026-10-05', endDate: '2026-10-09' });
    const b = task({ id: 'b', name: 'Build', parentTaskId: 'p2', startDate: '2026-10-09', endDate: '2026-10-16' });
    const c = task({ id: 'c', name: 'Test', parentTaskId: 'p2', startDate: '2026-10-19', endDate: '2026-10-23' });
    const first = proposeFixesDeterministic([], [p1, p2, a, b, c]).find(f => f.id === 'add_dependency:b:a');
    expect(first).toMatchObject({ overlaps: true, confidence: 0.5 });
  });
});

describe('unaddressedFindings — "Needs your decision"', () => {
  const sev = (f: Finding, severity: Finding['severity']): Finding => ({ ...f, severity });
  const link = { id: 'l', type: 'add_dependency', taskId: 'b', dependsOnTaskId: 'a' } as ProposedFix;

  it('lists, per rule, the tasks no fix answers', () => {
    const open = unaddressedFindings([link], [
      sev(finding('R01', ['b']), 'critical'), // answered by the link (on the task that waits)
      sev(finding('R01', ['c']), 'critical'), // not answered
      sev(finding('R06', ['b', 'c']), 'high'),
      sev(finding('R06', ['d']), 'high'),
      sev(finding('R10', ['a']), 'medium'),
    ]);
    expect(open.map(o => [o.ruleId, o.severity, o.taskIds])).toEqual([
      ['R01', 'critical', ['c']],
      ['R06', 'high', ['b', 'c', 'd']],
      ['R10', 'medium', ['a']],
    ]);
  });

  it('a whole-plan finding is answered by any fix for it; info findings are left out', () => {
    const open = unaddressedFindings([link], [sev(finding('R03'), 'critical'), sev(finding('R18'), 'medium'), sev(finding('R27', ['a']), 'info')]);
    expect(open.map(o => o.ruleId)).toEqual(['R18']);
  });

  it('a feeder link answers R02 on the feeder only', () => {
    const open = unaddressedFindings([link], [sev(finding('R02', ['a', 'b']), 'high')]);
    expect(open[0].taskIds).toEqual(['b']);
  });
});
