import { describe, it, expect } from 'vitest';
import {
  reviewSchedule,
  evaluateRules,
  scoreFindings,
  bandFor,
  calendarDaySpan,
  workingDaySpan,
  RULES,
  type ReviewInput,
  type ReviewTask,
} from '../../services/scheduleReview/rules';

const TODAY = new Date('2026-09-16T12:00:00Z');

let seq = 0;
function task(over: Partial<ReviewTask> & { name: string }): ReviewTask {
  seq++;
  return {
    id: over.id ?? `t${seq}`,
    status: 'pending',
    dependencies: [],
    sortOrder: seq,
    updatedAt: '2026-09-16T00:00:00Z',
    ...over,
  };
}

function input(tasks: ReviewTask[], over: Partial<ReviewInput> = {}): ReviewInput {
  return {
    schedule: { id: 's1', startDate: '2026-07-06', endDate: '2027-07-06' },
    project: { startDate: '2026-07-06', endDate: '2027-07-06' },
    tasks,
    resources: [],
    baselineCount: 1,
    latestBaselineTasks: null,
    floatByTask: null,
    overAllocations: null,
    today: TODAY,
    ...over,
  };
}

function ids(findings: { ruleId: string }[]): string[] {
  return [...new Set(findings.map(f => f.ruleId))].sort();
}

function rule(findings: { ruleId: string }[], id: string) {
  return findings.filter(f => f.ruleId === id);
}

/** A clean, linked, owned schedule that should score near 100. */
function cleanSchedule(): ReviewTask[] {
  seq = 0;
  const a = task({ id: 'a', name: 'Discovery', description: 'Interview stakeholders', startDate: '2026-07-06', endDate: '2026-07-10', estimatedDays: 5, assignedTo: 'r1', status: 'completed', progressPercentage: 100 });
  const b = task({ id: 'b', name: 'Design', description: 'Produce the design pack', startDate: '2026-07-13', endDate: '2026-07-24', estimatedDays: 10, assignedTo: 'r1', dependencies: [{ dependencyId: 'a', dependencyType: 'FS', lagDays: 0 }] });
  const c = task({ id: 'c', name: 'Build', description: 'Implement', startDate: '2026-07-27', endDate: '2026-08-21', estimatedDays: 20, assignedTo: 'r2', dependencies: [{ dependencyId: 'b', dependencyType: 'FS', lagDays: 0 }] });
  const d = task({ id: 'd', name: 'Gate 1', description: 'Design approved', startDate: '2026-08-24', endDate: '2026-08-24', estimatedDays: 0, isMilestone: true, assignedTo: 'r1', dependencies: [{ dependencyId: 'c', dependencyType: 'FS', lagDays: 0 }] });
  // future-dated so nothing is overdue relative to TODAY except the completed one
  for (const t of [b, c, d]) { t.startDate = shift(t.startDate!, 120); t.endDate = shift(t.endDate!, 120); }
  return [a, b, c, d];
}

function shift(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const people = [
  { id: 'r1', name: 'Alex Thompson', email: 'alex@example.com', userId: 'u1' },
  { id: 'r2', name: 'Priya Patel', email: 'priya@example.com', userId: null },
];

describe('helpers', () => {
  it('calendarDaySpan is inclusive', () => {
    expect(calendarDaySpan('2026-06-12', '2026-06-12')).toBe(1);
    expect(calendarDaySpan('2026-06-12', '2026-06-18')).toBe(7);
  });
  it('workingDaySpan skips weekends', () => {
    // Mon 2026-09-14 .. Fri 2026-09-18 = 5; through Sun 2026-09-20 still 5
    expect(workingDaySpan('2026-09-14', '2026-09-18')).toBe(5);
    expect(workingDaySpan('2026-09-14', '2026-09-20')).toBe(5);
    expect(workingDaySpan('2026-09-20', '2026-09-14')).toBe(0);
  });
  it('bandFor maps the spec boundaries', () => {
    expect(bandFor(0)).toBe('tracking_sheet');
    expect(bandFor(39)).toBe('tracking_sheet');
    expect(bandFor(40)).toBe('needs_work');
    expect(bandFor(69)).toBe('needs_work');
    expect(bandFor(70)).toBe('controllable');
    expect(bandFor(89)).toBe('controllable');
    expect(bandFor(90)).toBe('fit_for_control');
  });
});

describe('clean schedule', () => {
  it('produces no critical or high findings and a high score', () => {
    const r = reviewSchedule(input(cleanSchedule(), { resources: people, floatByTask: new Map([['a', 0], ['b', 0], ['c', 0], ['d', 0]]) }));
    expect(r.counts.critical).toBe(0);
    expect(r.counts.high).toBe(0);
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.band).toBe('fit_for_control');
  });

  it('is deterministic', () => {
    const a = reviewSchedule(input(cleanSchedule(), { resources: people }));
    const b = reviewSchedule(input(cleanSchedule(), { resources: people }));
    expect(a).toEqual(b);
  });
});

describe('R03 / R01 / R02 — logic', () => {
  it('R03 fires once when nothing is linked and suppresses R01/R02', () => {
    seq = 0;
    const tasks = [1, 2, 3].map(i => task({ name: `Task ${i}`, startDate: '2026-10-01', endDate: `2026-10-0${i + 1}`, description: 'x', assignedTo: 'r1' }));
    const { findings, skipped } = evaluateRules(input(tasks));
    expect(rule(findings, 'R03')).toHaveLength(1);
    expect(rule(findings, 'R01')).toHaveLength(0);
    expect(skipped.map(s => s.ruleId).sort()).toEqual(['R01', 'R02', 'R15', 'R16', 'R20']);
  });

  it('R01 excludes the earliest task and R02 excludes the last and milestones', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'First', startDate: '2026-10-01', endDate: '2026-10-02' });
    const b = task({ id: 'b', name: 'Second', startDate: '2026-10-03', endDate: '2026-10-04', dependencies: [{ dependencyId: 'a' }] });
    const c = task({ id: 'c', name: 'Orphan', startDate: '2026-10-05', endDate: '2026-10-06' });
    const d = task({ id: 'd', name: 'Last', startDate: '2026-10-07', endDate: '2026-10-08', dependencies: [{ dependencyId: 'b' }] });
    const { findings } = evaluateRules(input([a, b, c, d]));
    expect(rule(findings, 'R01')[0].taskIds).toEqual(['c']);
    // a feeds b, b feeds d, d is last; c feeds nothing
    expect(rule(findings, 'R02')[0].taskIds).toEqual(['c']);
    // Once predecessors exist (the Phase 2 import goal) the critical R03 clears.
    expect(rule(findings, 'R03')).toHaveLength(0);
  });
});

describe('R04 / R05 — milestones', () => {
  it('flags a named gate with duration and an unflagged milestone name', () => {
    seq = 0;
    const gate = task({ name: 'Gate 1 – Inception Report Review & Acceptance (MILESTONE - 1)', startDate: '2026-07-22', endDate: '2026-07-31' });
    const { findings } = evaluateRules(input([gate, task({ name: 'Other', startDate: '2026-08-01', endDate: '2026-08-02', dependencies: [{ dependencyId: gate.id }] })]));
    expect(rule(findings, 'R04')).toHaveLength(1);
    expect(rule(findings, 'R04')[0].message).toContain('10 days');
    expect(rule(findings, 'R05')[0].taskIds).toEqual([gate.id]);
  });

  it('does not treat review or sign-off work as a milestone', () => {
    seq = 0;
    const work = task({ name: 'SSD Part-1 Review & Sign-Off', startDate: '2026-08-25', endDate: '2026-09-15' });
    const { findings } = evaluateRules(input([work]));
    expect(rule(findings, 'R04')).toHaveLength(0);
    expect(rule(findings, 'R05')).toHaveLength(0);
  });
});

describe('R06 / R07 — dates', () => {
  it('R06 flags a task before the project start', () => {
    seq = 0;
    const early = task({ name: 'Kick-Off', startDate: '2026-06-12', endDate: '2026-06-18' });
    const { findings } = evaluateRules(input([early]));
    expect(rule(findings, 'R06')[0].message).toContain('starts 2026-06-12, project starts 2026-07-06');
  });

  it('R07 groups three or more tasks with identical dates', () => {
    seq = 0;
    const same = [1, 2, 3].map(i => task({ name: `Config ${i}`, startDate: '2026-08-21', endDate: '2026-10-22' }));
    const { findings } = evaluateRules(input([...same, task({ name: 'Different', startDate: '2026-08-01', endDate: '2026-08-02' })]));
    expect(rule(findings, 'R07')).toHaveLength(1);
    expect(rule(findings, 'R07')[0].taskIds).toHaveLength(3);
  });
});

describe('R08 / R09 — status and progress', () => {
  it('flags completed at 0%, in-progress past end at 0%, pending with progress, and overdue open work', () => {
    seq = 0;
    const done0 = task({ name: 'Done zero', status: 'completed', progressPercentage: 0, startDate: '2026-07-06', endDate: '2026-07-10' });
    const late0 = task({ name: 'Late zero', status: 'in_progress', progressPercentage: 0, startDate: '2026-08-25', endDate: '2026-09-15' });
    const pend50 = task({ name: 'Pending fifty', status: 'pending', progressPercentage: 50, startDate: '2026-12-01', endDate: '2026-12-05' });
    const { findings } = evaluateRules(input([done0, late0, pend50]));
    expect(rule(findings, 'R08').map(f => f.taskIds[0]).sort()).toEqual([done0.id, late0.id, pend50.id].sort());
    expect(rule(findings, 'R09').map(f => f.taskIds[0])).toEqual([late0.id]);
  });
});

describe('R10 / R11 — ownership', () => {
  it('R10 groups unowned tasks; R11 flags organisation-style owners', () => {
    seq = 0;
    const org = { id: 'o1', name: 'DBJ', email: '', userId: null };
    const t1 = task({ name: 'A', assignedTo: 'DBJ', startDate: '2026-10-01', endDate: '2026-10-02' });
    const t2 = task({ name: 'B', startDate: '2026-10-03', endDate: '2026-10-04' });
    const t3 = task({ name: 'C', assignedTo: 'r1', startDate: '2026-10-05', endDate: '2026-10-06' });
    const { findings } = evaluateRules(input([t1, t2, t3], { resources: [...people, org] }));
    expect(rule(findings, 'R10')[0].taskIds).toEqual([t2.id]);
    expect(rule(findings, 'R10')[0].message).toBe('1 of 3 tasks have no owner.');
    expect(rule(findings, 'R11')[0].taskIds).toEqual([t1.id]);
    expect(rule(findings, 'R11')[0].message).toContain('DBJ is not linked to a person');
  });
});

describe('R12 / R13 / R28 — durations', () => {
  it('R12 spots estimates that disagree and hours that look like days', () => {
    seq = 0;
    const t = task({ name: 'Study', startDate: '2026-07-23', endDate: '2026-08-20', estimatedDays: 1, estimatedDurationHours: 29 });
    const { findings } = evaluateRules(input([t]));
    const f = rule(findings, 'R12')[0];
    expect(f.taskIds).toEqual([t.id]);
    expect(f.message).toContain('hours probably hold days');
  });

  it('R13 flags a task over 44 working days', () => {
    seq = 0;
    const long = task({ name: 'Core LMS Configuration', startDate: '2026-08-21', endDate: '2026-10-22', estimatedDays: 45 });
    const { findings } = evaluateRules(input([long]));
    expect(rule(findings, 'R13')[0].taskIds).toEqual([long.id]);
  });

  it('R28 flags a sub-day estimate spanning multiple working days', () => {
    seq = 0;
    const t = task({ name: 'Kick-off', startDate: '2026-10-05', endDate: '2026-10-09', estimatedDays: 0.5 });
    const { findings } = evaluateRules(input([t]));
    expect(rule(findings, 'R28')).toHaveLength(1);
  });
});

describe('R14 / R17 — constraints and lags', () => {
  it('flags hard constraints and long lags', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'A', startDate: '2026-10-01', endDate: '2026-10-02', constraintType: 'MSO' });
    const b = task({ id: 'b', name: 'B', startDate: '2026-10-20', endDate: '2026-10-21', dependencies: [{ dependencyId: 'a', lagDays: 15 }] });
    const { findings } = evaluateRules(input([a, b]));
    expect(rule(findings, 'R14')[0].taskIds).toEqual(['a']);
    expect(rule(findings, 'R17')[0].taskIds).toEqual(['b']);
  });
});

describe('R15 / R16 / R20 — float rules need logic', () => {
  it('are skipped without float data and fire with it', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'A', startDate: '2026-10-01', endDate: '2026-10-02' });
    const gate = task({ id: 'g', name: 'Gate 2', isMilestone: true, startDate: '2026-10-03', endDate: '2026-10-03', dependencies: [{ dependencyId: 'a' }] });
    const loose = task({ id: 'l', name: 'Loose', startDate: '2026-10-05', endDate: '2026-10-06', dependencies: [{ dependencyId: 'a' }] });
    const without = evaluateRules(input([a, gate, loose]));
    expect(without.skipped.map(s => s.ruleId)).toEqual(expect.arrayContaining(['R15', 'R16', 'R20']));

    const withFloat = evaluateRules(input([a, gate, loose], { floatByTask: new Map([['a', 0], ['g', -3], ['l', 60]]) }));
    expect(rule(withFloat.findings, 'R15')[0].taskIds).toEqual(['g']);
    expect(rule(withFloat.findings, 'R16')[0].taskIds).toEqual(['l']);
    expect(rule(withFloat.findings, 'R20')[0].taskIds).toEqual(['g']);
  });
});

describe('R18 / R19 — baselines', () => {
  it('R18 when no baseline; R19 when more than 20% of tasks drifted over 5 days', () => {
    seq = 0;
    const a = task({ id: 'a', name: 'A', startDate: '2026-10-15', endDate: '2026-10-16' });
    const b = task({ id: 'b', name: 'B', startDate: '2026-10-17', endDate: '2026-10-18', dependencies: [{ dependencyId: 'a' }] });
    expect(ids(evaluateRules(input([a, b], { baselineCount: 0 })).findings)).toContain('R18');
    const drift = evaluateRules(input([a, b], {
      baselineCount: 1,
      latestBaselineTasks: [{ taskId: 'a', startDate: '2026-10-01', endDate: '2026-10-02' }, { taskId: 'b', startDate: '2026-10-17', endDate: '2026-10-18' }],
    }));
    expect(rule(drift.findings, 'R19')[0].taskIds).toEqual(['a']);
    expect(rule(drift.findings, 'R19')[0].severity).toBe('info');
  });
});

describe('R21 — over-allocation', () => {
  it('groups by resource and lists the overlapping tasks', () => {
    seq = 0;
    const t1 = task({ name: 'X', assignedTo: 'JV', startDate: '2026-10-01', endDate: '2026-10-10' });
    const t2 = task({ name: 'Y', assignedTo: 'JV', startDate: '2026-10-01', endDate: '2026-10-10', dependencies: [{ dependencyId: t1.id, dependencyType: 'SS' }] });
    const { findings } = evaluateRules(input([t1, t2], {
      overAllocations: [{ resourceName: 'JV', date: '2026-10-01', demand: 16, capacity: 8 }, { resourceName: 'JV', date: '2026-10-02', demand: 24, capacity: 8 }],
    }));
    const f = rule(findings, 'R21')[0];
    expect(f.taskIds.sort()).toEqual([t1.id, t2.id].sort());
    expect(f.message).toContain('JV peaks at 300%');
  });
});

describe('R22 / R23 / R25 / R26 / R27 — hygiene', () => {
  it('R22 flags legend rows and cell references in tasks and resources', () => {
    seq = 0;
    const legend = task({ name: 'Delayed', description: 'Ahead', startDate: '2026-07-06', endDate: '2026-07-07' });
    const { findings } = evaluateRules(input([legend, task({ name: 'Real', startDate: '2026-08-01', endDate: '2026-08-02', dependencies: [{ dependencyId: legend.id }] })], {
      resources: [{ id: 'x', name: 'DBJ & JV+D9:D27', email: '', userId: null }],
    }));
    const f = rule(findings, 'R22')[0];
    expect(f.taskIds).toEqual([legend.id]);
    expect(f.message).toContain("'DBJ & JV+D9:D27'");
  });

  it('R23 fires above 8 leaf tasks with no summaries, and is high severity (raised in 1.2)', () => {
    seq = 0;
    const nine = Array.from({ length: 9 }, (_, i) => task({ name: `T${i}`, startDate: '2026-10-01', endDate: `2026-10-${String(2 + (i % 20)).padStart(2, '0')}`, dependencies: i ? [{ dependencyId: `t${i}` }] : [] }));
    const r23 = rule(evaluateRules(input(nine)).findings, 'R23');
    expect(r23).toHaveLength(1);
    expect(r23[0].severity).toBe('high');
  });

  it('R23 does not fire at 8 or fewer leaf tasks', () => {
    seq = 0;
    const eight = Array.from({ length: 8 }, (_, i) => task({ name: `T${i}`, startDate: '2026-10-01', endDate: `2026-10-${String(2 + i).padStart(2, '0')}`, dependencies: i ? [{ dependencyId: `t${i}` }] : [] }));
    expect(ids(evaluateRules(input(eight)).findings)).not.toContain('R23');
  });

  it('R25 flags a summary with no children; R26 duplicate names; R27 missing or phase-code descriptions', () => {
    seq = 0;
    const phase = task({ name: 'T5', isSummary: true });
    const a = task({ name: 'Review & Sign-Off', description: 'T2', startDate: '2026-10-01', endDate: '2026-10-02' });
    const b = task({ name: 'review & sign-off ', description: '', startDate: '2026-10-03', endDate: '2026-10-04', dependencies: [{ dependencyId: a.id }] });
    const { findings } = evaluateRules(input([phase, a, b]));
    expect(rule(findings, 'R25')[0].taskIds).toEqual([phase.id]);
    expect(rule(findings, 'R26')[0].taskIds.sort()).toEqual([a.id, b.id].sort());
    expect(rule(findings, 'R27')[0].taskIds.sort()).toEqual([a.id, b.id].sort());
    expect(rule(findings, 'R27')[0].message).toBe('2 of 2 tasks have no description. An owner picking one up cold will not know what done looks like.');
  });
});

describe('R24 — stale', () => {
  it('flags in-progress tasks untouched for 14 days', () => {
    seq = 0;
    const stale = task({ name: 'Old', status: 'in_progress', progressPercentage: 20, startDate: '2026-09-01', endDate: '2026-12-01', updatedAt: '2026-08-20T00:00:00Z' });
    const { findings } = evaluateRules(input([stale]));
    expect(rule(findings, 'R24')[0].taskIds).toEqual([stale.id]);
  });
});

describe('scoring', () => {
  it('schedule-scoped rules deduct in full; task rules scale by affected fraction and cap', () => {
    const raw = [
      { ruleId: 'R03', rule: RULES.R03.name, severity: RULES.R03.severity, taskIds: [], message: '' },
      { ruleId: 'R10', rule: RULES.R10.name, severity: RULES.R10.severity, taskIds: ['a'], message: '' }, // 1 of 20 = 5% → quarter of 6 = 1.5
      { ruleId: 'R04', rule: RULES.R04.name, severity: RULES.R04.severity, taskIds: ['b'], message: '' },
      { ruleId: 'R04', rule: RULES.R04.name, severity: RULES.R04.severity, taskIds: ['c'], message: '' },
      { ruleId: 'R04', rule: RULES.R04.name, severity: RULES.R04.severity, taskIds: ['d'], message: '' },
      { ruleId: 'R04', rule: RULES.R04.name, severity: RULES.R04.severity, taskIds: ['e'], message: '' }, // 4 of 20 = 20% → full 12
      { ruleId: 'R27', rule: RULES.R27.name, severity: RULES.R27.severity, taskIds: ['a', 'b'], message: '' }, // info → 0
    ];
    const { score, findings } = scoreFindings(raw, 20);
    expect(score).toBe(100 - 25 - 1.5 - 12 + 0.5); // rounds 61.5 → 62
    expect(findings.find(f => f.ruleId === 'R27')!.pointsDeducted).toBe(0);
    expect(findings.filter(f => f.ruleId === 'R04').reduce((s, f) => s + f.pointsDeducted, 0)).toBe(12);
  });

  it('never goes below 0', () => {
    const raw = ['R03', 'R18', 'R23'].flatMap(id => Array.from({ length: 5 }, () => ({ ruleId: id, rule: RULES[id].name, severity: RULES[id].severity, taskIds: [] as string[], message: '' })));
    expect(scoreFindings([...raw, ...raw, ...raw], 1).score).toBeGreaterThanOrEqual(0);
  });
});

describe('golden: DBJ-style import', () => {
  function dbj(): ReviewTask[] {
    seq = 0;
    const names: Array<[string, string, string, string, string?, string?]> = [
      ['Kick-Off Meeting & Project Governance', 'T1', '2026-06-12', '2026-06-18', 'DBJ & JV', 'completed'],
      ['Onboarding / Customer Information Form', 'T1', '2026-06-19', '2026-06-25', 'DBJ', 'completed'],
      ['Desk Review Findings & Inception Report / Master Work Plan', 'T1', '2026-06-26', '2026-07-08', 'JV', 'completed'],
      ['Gate 1 – Task 1 Inception Report Review & Acceptance  (MILESTONE - 1)', 'T1', '2026-07-22', '2026-07-31', 'DBJ / JV', 'in_progress'],
      ['Detailed System Study & Gap Analysis', 'T2', '2026-07-23', '2026-08-20', 'DBJ & JV', 'completed'],
      ['Daily & Regulatory Reports + API Documentation', 'T2', '2026-08-21', '2026-09-17', 'DBJ', 'in_progress'],
      ['SSD Part-1 Review & Sign-Off', 'T2', '2026-08-25', '2026-09-15', undefined, 'in_progress'],
      ['Data Acquisition & Migration Preparation / Mock Migration Cyc-1', 'T2', '2026-09-18', '2026-10-15'],
      ['SSD Part-2 Review & Sign-Off', 'T2', '2026-09-25', '2026-10-10'],
      ['Core LMS Configuration & Module Setup (Internal JV)', 'T2', '2026-08-21', '2026-10-22', undefined, 'in_progress'],
      ['System Integration (LMS <-> CRM & LMS <-> GP) Configuration', 'T2', '2026-08-21', '2026-10-22', undefined, 'in_progress'],
      ['D2.0–D2.5 Submission', 'T2', '2026-10-23', '2026-10-30'],
      ['Gate 2 – Task 2 Final Acceptance (MILESTONE- 2)', 'T2', '2026-11-01', '2026-11-06'],
      ['Test Plans & Test Cases Finalized / Submitted', 'T3', '2026-11-07', '2026-11-13'],
      ['Hardware / Cloud Environment Configuration', 'T3', '2026-11-14', '2026-11-20'],
      ['Data Mock Migration Cycle 2', 'T3', '2026-11-21', '2026-12-04'],
      ['System Integration Testing (SIT)', 'T3', '2026-12-05', '2026-12-11'],
      ['Deployment of the LMS in the DBJ UAT Environment /Mock Migration Cycle 3', 'T3', '2026-12-12', '2026-12-25'],
      ['SIT Defect Remediation & Regression Testing', 'T3', '2026-12-26', '2026-12-27'],
      ['Live Disaster-Recovery Failover Test', 'T3', '2026-12-28', '2026-12-30'],
      ['Client User Acceptance Testing (UAT)', 'T3', '2027-01-04', '2027-01-20'],
      ['Gate 3 – UAT Sign-off & Task 3 Final Acceptance', 'T3', '2027-01-22', '2027-01-22'],
      ['Bug / Issue Resolution & Stabilisation', 'T4', '2027-01-23', '2027-02-12'],
      ['Training, Manuals, Knowledge Transfer & DR Approach', 'T4', '2027-01-29', '2027-02-18'],
      ['Go-Live Execution / Production Cutover', 'T4', '2027-02-19', '2027-02-25'],
      ['Gate 4 – Task 4 Final Acceptance (MILESTONE - 3) GO-LIVE', 'T4', '2027-02-19', '2027-02-25'],
      ['Post-Go-Live Support', 'PG', '2027-02-26', '2027-03-12'],
      ['Hypercare, Knowledge Transfer & Formal Project Closure', 'PG', '2027-03-13', '2027-03-20'],
      ['Delayed', 'Ahead', '2026-07-06', '2026-07-07', 'Completed'],
    ];
    return names.map(([name, desc, s, e, owner, status]) => task({
      name, description: desc, startDate: s, endDate: e, assignedTo: owner, status: status ?? 'pending',
      estimatedDays: 1, estimatedDurationHours: calendarDaySpan(s, e), progressPercentage: 0,
    }));
  }

  it('scores as a tracking sheet and names the structural gaps', () => {
    const r = reviewSchedule(input(dbj(), {
      baselineCount: 0,
      resources: [
        { id: 'a', name: 'DBJ', email: '', userId: null },
        { id: 'b', name: 'JV', email: '', userId: null },
        { id: 'c', name: 'DBJ / JV', email: '', userId: null },
        { id: 'd', name: 'DBJ & JV', email: '', userId: null },
        { id: 'e', name: 'Completed', email: '', userId: null },
        { id: 'f', name: 'DBJ & JV+D9:D27', email: '', userId: null },
      ],
    }));
    expect(r.band).toBe('tracking_sheet');
    expect(r.score).toBeLessThan(20);
    const found = ids(r.findings);
    // R07 does not fire: only two DBJ tasks share identical dates (the threshold is three).
    for (const must of ['R03', 'R04', 'R05', 'R06', 'R08', 'R09', 'R10', 'R11', 'R12', 'R13', 'R18', 'R22', 'R23', 'R27']) {
      expect(found, `expected ${must}`).toContain(must);
    }
    expect(r.skippedRules.map(s => s.ruleId).sort()).toEqual(['R01', 'R02', 'R15', 'R16', 'R20']);
    // Gate 1 spans 10 days
    expect(rule(r.findings, 'R04').some(f => f.message.includes('10 days'))).toBe(true);
    // Kick-off before project start
    expect(rule(r.findings, 'R06').some(f => f.message.includes('2026-06-12'))).toBe(true);
    expect(rule(r.findings, 'R07')).toHaveLength(0);
    // Findings sorted by severity
    const order = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as Record<string, number>;
    for (let i = 1; i < r.findings.length; i++) {
      expect(order[r.findings[i].severity]).toBeGreaterThanOrEqual(order[r.findings[i - 1].severity]);
    }
  });
});


// ---------------------------------------------------------------------------
// 1.2 — project-type profiles, summary-task checks
// ---------------------------------------------------------------------------

describe('1.2 project-type profiles and summary checks', () => {
  const link = (id: string) => [{ dependencyId: id, dependencyType: 'FS', lagDays: 0 }];
  const typed = (tasks: ReviewTask[], projectType: string, methodology = 'waterfall', over: Partial<ReviewInput> = {}) =>
    input(tasks, { project: { startDate: '2026-07-06', endDate: '2027-07-06', projectType, methodology }, ...over });

  /** A complete SDLC plan: every phase and milestone present, linked, sized well */
  function sdlcPlan(): ReviewTask[] {
    seq = 0;
    const rows: Array<[string, string, string, boolean?]> = [
      ['Requirements workshops', '2026-10-01', '2026-10-09'],
      ['Requirements sign-off', '2026-10-12', '2026-10-12', true],
      ['Solution design', '2026-10-13', '2026-10-23'],
      ['Build API', '2026-10-26', '2026-11-06'],
      ['System testing', '2026-11-09', '2026-11-13'],
      ['UAT sign-off', '2026-11-16', '2026-11-16', true],
      ['Deploy to production', '2026-11-17', '2026-11-18'],
      ['Go-live', '2026-11-19', '2026-11-19', true],
    ];
    return rows.map(([name, st, en, ms], i) => task({ id: `p${i}`, name, startDate: st, endDate: en, isMilestone: !!ms, assignedTo: 'r1', description: 'x', dependencies: i ? link(`p${i - 1}`) : [] }));
  }

  it('bumps the rules version', () => {
    expect(reviewSchedule(input([])).rulesVersion).toBe('1.2');
  });

  it('a complete IT/SDLC plan raises no phase or milestone findings', () => {
    const f = evaluateRules(typed(sdlcPlan(), 'it')).findings;
    expect(ids(f)).not.toContain('R31');
    expect(ids(f)).not.toContain('R32');
  });

  it('R31 names the SDLC phases that are missing', () => {
    const plan = sdlcPlan().filter(t => !/testing|deploy/i.test(t.name));
    const r31 = rule(evaluateRules(typed(plan, 'it')).findings, 'R31');
    expect(r31).toHaveLength(1);
    expect(r31[0].message).toContain('an IT project run as Waterfall (SDLC)');
    expect(r31[0].message).toContain('No task looks like Testing');
  });

  it('R32 names the missing key milestones, and only counts milestone tasks', () => {
    // "UAT" appears in a normal task name only; that is not a milestone
    const plan = sdlcPlan().filter(t => t.name !== 'UAT sign-off');
    plan.push(task({ name: 'Prepare UAT scripts', startDate: '2026-11-02', endDate: '2026-11-03', dependencies: link('p3') }));
    const r32 = rule(evaluateRules(typed(plan, 'it')).findings, 'R32');
    expect(r32).toHaveLength(1);
    expect(r32[0].message).toContain('UAT sign-off');
    expect(r32[0].severity).toBe('low');
  });

  it('Agile IT expects sprints, and a project with sprints defined counts as having them', () => {
    const plan = sdlcPlan();
    const without = rule(evaluateRules(typed(plan, 'it', 'agile')).findings, 'R31');
    expect(without[0].message).toContain('Sprints');
    const withSprints = rule(evaluateRules(typed(plan, 'it', 'agile', { sprintCount: 3 })).findings, 'R31');
    expect(withSprints.map(f => f.message).join(' ')).not.toContain('No task looks like Sprints');
  });

  it('App Development expects a beta; Web Design expects content', () => {
    const app = rule(evaluateRules(typed(sdlcPlan(), 'app_development')).findings, 'R32');
    expect(app[0].message).toContain('Beta / TestFlight');
    const web = rule(evaluateRules(typed(sdlcPlan(), 'web_design')).findings, 'R31');
    expect(web[0].message).toContain('Content');
  });

  it('types without a profile and tiny plans get no phase checks', () => {
    expect(ids(evaluateRules(typed(sdlcPlan(), 'construction')).findings)).not.toContain('R31');
    expect(ids(evaluateRules(typed(sdlcPlan().slice(0, 3), 'it')).findings)).not.toContain('R31');
  });

  it('R13 uses the project type limit: 12 working days is fine generally, too long for web/app', () => {
    seq = 0;
    // 20 tasks, two of them 12 working days (10%, above the 5% gate)
    const plan = Array.from({ length: 20 }, (_, i) => task({ id: `w${i}`, name: `Step ${i}`, startDate: '2026-10-05', endDate: i < 2 ? '2026-10-20' : '2026-10-06', dependencies: i ? link(`w${i - 1}`) : [] }));
    expect(ids(evaluateRules(input(plan)).findings)).not.toContain('R13');
    expect(ids(evaluateRules(typed(plan, 'it')).findings)).not.toContain('R13');
    const web = rule(evaluateRules(typed(plan, 'web_application')).findings, 'R13');
    expect(web).toHaveLength(1);
    expect(web[0].message).toContain('longer than 10 working days');
  });

  it('R13 ignores level-of-effort work such as recurring status reporting', () => {
    seq = 0;
    const plan = Array.from({ length: 20 }, (_, i) => task({ id: `l${i}`, name: i < 2 ? `Weekly status report and RAID review (recurring) ${i}` : `Step ${i}`, startDate: '2026-10-05', endDate: i < 2 ? '2026-12-20' : '2026-10-06', dependencies: i ? link(`l${i - 1}`) : [] }));
    expect(ids(evaluateRules(typed(plan, 'app_development')).findings)).not.toContain('R13');
  });

  it('R29 flags a summary task that carries its own links', () => {
    seq = 0;
    const phase = task({ id: 'ph', name: 'Phase 1', isSummary: true, startDate: '2026-10-01', endDate: '2026-10-10' });
    const kid = task({ id: 'k1', name: 'Work', parentTaskId: 'ph', startDate: '2026-10-01', endDate: '2026-10-10' });
    const after = task({ id: 'af', name: 'Later', startDate: '2026-10-12', endDate: '2026-10-13', dependencies: link('ph') });
    const r29 = rule(evaluateRules(input([phase, kid, after])).findings, 'R29');
    expect(r29).toHaveLength(1);
    expect(r29[0].taskIds).toEqual(['ph']);
  });

  it('R30 flags a summary whose dates do not cover its tasks', () => {
    seq = 0;
    const phase = task({ id: 'ph', name: 'Phase 1', isSummary: true, startDate: '2026-10-05', endDate: '2026-10-10' });
    const early = task({ id: 'k1', name: 'Starts early', parentTaskId: 'ph', startDate: '2026-10-01', endDate: '2026-10-06' });
    const r30 = rule(evaluateRules(input([phase, early])).findings, 'R30');
    expect(r30).toHaveLength(1);
    expect(r30[0].message).toContain('2026-10-01 to 2026-10-06');
    phase.startDate = '2026-10-01'; phase.endDate = '2026-10-06';
    expect(ids(evaluateRules(input([phase, early])).findings)).not.toContain('R30');
  });
});
