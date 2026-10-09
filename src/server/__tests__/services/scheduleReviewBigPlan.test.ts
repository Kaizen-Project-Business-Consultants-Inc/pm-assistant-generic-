import { describe, it, expect } from 'vitest';
import { proposeFixesDeterministic } from '../../services/scheduleReview/fixProposer';
import { evaluateRules, type Finding, type ReviewInput, type ReviewTask, type ReviewResource } from '../../services/scheduleReview/rules';

/**
 * Big plans (thousands of tasks): the R02 "next step" pick and the R21 "whose tasks" lookup
 * used to filter (and sort) the whole plan once per task / per person. They now look up from
 * an index built once. These tests compare against the old way, on the same random plan.
 */

// Small seeded random, so a failure can be reproduced
function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

const day = (d?: string | null) => (d ? String(d).slice(0, 10) : '');
const ymdPlus = (n: number) => new Date(Date.UTC(2026, 0, 5) + n * 86400000).toISOString().slice(0, 10);

/** A plan whose parents are NOT tasks in the list, so every task is a leaf */
function bigPlan(n: number, seed: number): ReviewTask[] {
  const r = rng(seed);
  const tasks: ReviewTask[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.floor(r() * 400);
    const len = Math.floor(r() * 15);
    const noDates = r() < 0.05;
    const p = r();
    const parent = p < 0.1 ? null : p < 0.15 ? undefined : `phase-${Math.floor(r() * 30)}`;
    const deps: ReviewTask['dependencies'] = [];
    const links = Math.floor(r() * 3);
    if (i > 0) for (let k = 0; k < links; k++) deps.push({ dependencyId: `t${Math.floor(r() * i)}` });
    tasks.push({
      id: `t${i}`,
      name: `Task ${i}`,
      status: 'pending',
      startDate: noDates ? null : ymdPlus(start),
      endDate: noDates ? null : ymdPlus(start + len),
      parentTaskId: parent,
      sortOrder: Math.floor(r() * (n / 2)), // ties on purpose: plan order must break them
      // by name, by resource id (two people share a name: res-a and res-a2) and by login
      assignedTo: r() < 0.7 ? [`Alice`, `alice`, ` Bob `, 'res-c', 'user-d', 'Dana', 'res-a', 'res-a2'][Math.floor(r() * 8)] : null,
      dependencies: deps,
    });
  }
  return tasks;
}

/** The R02 pick exactly as it was written before 2026-10-09 */
function oldR02Picks(leaves: ReviewTask[], byId: Map<string, ReviewTask>, taskIds: string[]) {
  const out: Array<[string, string]> = [];
  for (const taskId of taskIds) {
    const t = byId.get(taskId);
    const tEnd = day(t?.endDate);
    if (!t || !tEnd) continue;
    const upstream = new Set<string>();
    const stack = [t.id];
    while (stack.length) {
      for (const d of byId.get(stack.pop()!)?.dependencies || []) {
        if (!upstream.has(d.dependencyId)) { upstream.add(d.dependencyId); stack.push(d.dependencyId); }
      }
    }
    const next = leaves
      .filter(c => c.id !== t.id && !upstream.has(c.id) && day(c.startDate) > tEnd)
      .sort((a, b) =>
        Number(b.parentTaskId === t.parentTaskId) - Number(a.parentTaskId === t.parentTaskId)
        || day(a.startDate).localeCompare(day(b.startDate))
        || (a.sortOrder ?? 0) - (b.sortOrder ?? 0))[0];
    if (next) out.push([next.id, t.id]);
  }
  return out;
}

describe('Schedule Review on a big plan', () => {
  const r02Finding = (tasks: ReviewTask[]): Finding[] => [{
    ruleId: 'R02', rule: 'R02', severity: 'medium', message: '', pointsDeducted: 0,
    // every 5th task "feeds nothing", plus an unknown id and a duplicate
    taskIds: tasks.filter((_, i) => i % 5 === 0).map(t => t.id).concat(['nope', 't10']),
  }];

  // a few start days not in YYYY-MM-DD form (e.g. '2026-1-5'): the days no longer rise in plain
  // string order, so the code must take its slow path, which must pick the same
  const notIso = (tasks: ReviewTask[]) => tasks.map((t, i) =>
    (i % 37 === 0 && t.startDate ? { ...t, startDate: t.startDate.replace(/-0(\d)-0?(\d+)$/, '-$1-$2') } : t));

  it('R02 "feeds nothing" fixes: the same picks as the old filter-and-sort, on 800-task plans (fast and slow path)', () => {
    for (const tasks of [bigPlan(800, 1), bigPlan(800, 2), notIso(bigPlan(800, 3))]) {
      const byId = new Map(tasks.map(t => [t.id, t]));
      const findings = r02Finding(tasks);
      const fixes = proposeFixesDeterministic(findings, tasks);

      const r02Fixes = fixes.filter(f => f.reason.includes('feeds nothing'));
      const earlierIds = new Set(fixes.filter(f => !f.reason.includes('feeds nothing')).map(f => f.id));
      const expected: string[] = [];
      for (const [next, t] of oldR02Picks(tasks, byId, findings[0].taskIds)) {
        const id = `add_dependency:${next}:${t}`;
        if (earlierIds.has(id)) continue;
        earlierIds.add(id);
        expected.push(id);
      }
      expect(r02Fixes.map(f => f.id)).toEqual(expected);
      expect(expected.length).toBeGreaterThan(20);
    }
  });

  it('R02 "feeds nothing" fixes run quickly on a 5,000-task plan', () => {
    const tasks = bigPlan(5000, 11);
    const started = Date.now();
    const fixes = proposeFixesDeterministic(r02Finding(tasks), tasks);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(fixes.filter(f => f.reason.includes('feeds nothing')).length).toBeGreaterThan(100);
  });

  it('R21 over-allocated owner: same tasks per person as before, on 5,000 tasks', () => {
    const tasks = bigPlan(5000, 7);
    const resources: ReviewResource[] = [
      { id: 'res-a', name: 'Alice' },
      { id: 'res-a2', name: ' alice ' }, // same name: the first one wins, as .find did
      { id: 'res-b', name: 'Bob' },
      { id: 'res-c', name: 'Carol', userId: 'user-c' },
      { id: 'res-d', name: 'Dana', userId: 'user-d' },
    ];
    const overAllocations = [
      { resourceName: 'Alice', date: '2026-03-02', demand: 12, capacity: 8 },
      { resourceName: 'Carol', date: '2026-03-04', demand: 10, capacity: 8 },
      { resourceName: 'Dana', date: '2026-03-01', demand: 9, capacity: 8 },
      { resourceName: 'Bob', date: '2026-03-03', demand: 9, capacity: 8 },
      { resourceName: 'Dana', date: '2026-02-01', demand: 11, capacity: 8 },
    ];
    const input: ReviewInput = {
      schedule: { id: 's1', startDate: '2026-01-05', endDate: '2027-03-01' },
      tasks, resources, overAllocations, baselineCount: 1, today: new Date('2026-09-16T12:00:00Z'),
    } as unknown as ReviewInput;

    const started = Date.now();
    const { findings } = evaluateRules(input);
    const ms = Date.now() - started;

    // the old lookup, per person
    const expected = ['Alice', 'Carol', 'Dana', 'Bob'].map(name => {
      const lower = name.trim().toLowerCase();
      const res = resources.find(r => r.name.trim().toLowerCase() === lower);
      return tasks.filter(t => {
        const a = (t.assignedTo || '').trim();
        return a && (a.toLowerCase() === lower || (res && (a === res.id || a === res.userId)));
      }).map(t => t.id);
    });
    const r21 = findings.filter(f => f.ruleId === 'R21');
    expect(r21.map(f => f.taskIds)).toEqual(expected);
    expect(expected.every(ids => ids.length > 0)).toBe(true);
    expect(r21.find(f => f.message.startsWith('Dana'))!.message).toContain('between 2026-02-01 and 2026-03-01');
    expect(ms).toBeLessThan(5000);
  });
});
