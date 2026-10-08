/**
 * Made-up but realistic plans for the speed tests ("performance budgets"), 2026-10-08.
 *
 * Deterministic: the same (n, seed) always gives the same plan, so timings compare run to run.
 *
 *   phases (~1 per 250 tasks) → summaries (~1 per 25 tasks) → leaf tasks (~10% milestones)
 *   ~1.2 links per leaf (≈80% FS, 10% SS, 8% FF, 2% SF; ~15% with a 1–3 working-day lag),
 *   always to an earlier task that finishes before it starts, so the plan is consistent —
 *   except ~3% of tasks that start a few days too early (so a re-flow has real work to do).
 *   Mon–Fri calendar with 10 public holidays a year. The plan spans ~2 years whatever n is
 *   (more tasks = more parallel work, as in a large programme), so doubling n doubles the work.
 *   60 resources (5 of them generic roles); every non-milestone leaf has an owner, ~20% a second
 *   person; bookings of 8–40 h/week. Tasks are spread over 5 plans (schedules s0–s4, projects p0–p4),
 *   each running the whole ~2 years (workstream s belongs to plan s mod 5).
 *
 * Not a test file (no .test.ts) — imported by the *.perf.test.ts files next to it, and by the
 * client speed tests.
 */

export const DAY_MS = 86_400_000;
export const PLAN_START = '2026-01-05'; // a Monday
export const TODAY = '2026-10-08';
const SPAN_WORKING_DAYS = 500; // ~2 years

/** Small fast seeded random (mulberry32) */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOLIDAYS = new Set([
  '2026-01-01', '2026-02-16', '2026-04-03', '2026-05-18', '2026-07-01', '2026-08-03', '2026-09-07', '2026-10-12', '2026-12-25', '2026-12-28',
  '2027-01-01', '2027-02-15', '2027-03-26', '2027-05-24', '2027-07-01', '2027-08-02', '2027-09-06', '2027-10-11', '2027-12-27', '2027-12-28',
  '2028-01-03', '2028-02-21', '2028-04-14', '2028-05-22', '2028-07-03', '2028-08-07', '2028-09-04', '2028-10-09', '2028-12-25', '2028-12-26',
]);
export const isWorkingYmd = (ymd: string): boolean => {
  if (HOLIDAYS.has(ymd)) return false;
  const dow = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
};
/** The project calendar as the server's IsWorking (UTC-midnight Date → worked?) */
export const isWorking = (d: Date): boolean => isWorkingYmd(d.toISOString().slice(0, 10));

/** Working day k (0 = the plan start) → 'YYYY-MM-DD' */
const workingDayDates: string[] = (() => {
  const out: string[] = [];
  for (let t = Date.parse(`${PLAN_START}T00:00:00Z`); out.length < SPAN_WORKING_DAYS + 200; t += DAY_MS) {
    const ymd = new Date(t).toISOString().slice(0, 10);
    if (isWorkingYmd(ymd)) out.push(ymd);
  }
  return out;
})();
const dateAt = (k: number) => workingDayDates[Math.max(0, k)];

export interface PerfDep { dependencyId: string; dependencyType: 'FS' | 'SS' | 'FF' | 'SF'; lagDays: number }
export interface PerfTask {
  id: string;
  name: string;
  scheduleId: string;
  status: string;
  priority: string;
  startDate: string;
  endDate: string;
  estimatedDays: number;
  estimatedDurationHours: number | null;
  progressPercentage: number;
  isMilestone: boolean;
  isSummary: boolean;
  parentTaskId: string | null;
  assignedTo: string | null;
  assignments: Array<{ resourceId: string; allocationPct: number }>;
  dependencies: PerfDep[];
  constraintType: string;
  constraintDate?: string;
  actualStartDate: string | null;
  actualEndDate: string | null;
  sortOrder: number;
  description: string | null;
  updatedAt: string;
  taskType?: string;
}
export interface PerfResource {
  id: string; name: string; role: string; email: string; userId: string | null;
  isGeneric: boolean; isActive: boolean; capacityHoursPerWeek: number; costRateHourly: number;
  calendarTemplateId: null; skills: never[];
}
export interface PerfBooking {
  id: string; resourceId: string; taskId: string; scheduleId: string;
  hoursPerWeek: number; startDate: string; endDate: string; source: string;
}
export interface PerfPlan {
  tasks: PerfTask[];
  resources: PerfResource[];
  bookings: PerfBooking[];
  scheduleIds: string[];
  projectOf: Record<string, { id: string; name: string }>;
}

const NAMES = ['Design', 'Build', 'Review', 'Test', 'Migrate', 'Configure', 'Document', 'Deploy', 'Train', 'Approve'];
const AREAS = ['payments', 'login', 'reports', 'data feed', 'API', 'portal', 'search', 'billing', 'audit log', 'dashboard'];

export function makePlan(n: number, seed = 42, resourceCount = 60): PerfPlan {
  const rnd = seededRandom(seed);
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const phaseCount = Math.max(4, Math.ceil(n / 250));
  const summaryCount = Math.max(phaseCount, Math.ceil(n / 25));
  const leafCount = n - phaseCount - summaryCount;
  const scheduleIds = ['s0', 's1', 's2', 's3', 's4'];

  // Resources
  const resources: PerfResource[] = Array.from({ length: resourceCount }, (_, i) => {
    const generic = i >= resourceCount - 5;
    return {
      id: `r${i}`, name: generic ? `Generic Role ${i}` : `Person ${String(i).padStart(2, '0')}`, role: pick(['Developer', 'Analyst', 'Tester', 'Designer']),
      email: `person${i}@example.org`, userId: generic ? null : `u${i}`, isGeneric: generic, isActive: true,
      capacityHoursPerWeek: 40, costRateHourly: 50 + (i % 7) * 10, calendarTemplateId: null, skills: [],
    };
  });
  const people = resources.filter(r => !r.isGeneric);

  // Leaves first (they drive dates), then summaries and phases roll up from them
  const leaves: PerfTask[] = [];
  const startOff: number[] = [];
  const endOff: number[] = [];
  for (let i = 0; i < leafCount; i++) {
    const milestone = rnd() < 0.1;
    const s = Math.floor((i / leafCount) * (SPAN_WORKING_DAYS - 30)) + Math.floor(rnd() * 6);
    const dur = milestone ? 0 : 1 + Math.floor(rnd() * 15);
    startOff.push(s);
    endOff.push(milestone ? s : s + dur - 1);
    leaves.push({
      id: `t${i}`, name: milestone ? `Milestone: ${pick(AREAS)} sign-off ${i}` : `${pick(NAMES)} ${pick(AREAS)} ${i}`,
      scheduleId: '', status: 'pending', priority: pick(['low', 'medium', 'medium', 'high', 'urgent']),
      startDate: '', endDate: '', estimatedDays: dur, estimatedDurationHours: milestone ? null : dur * 8,
      progressPercentage: 0, isMilestone: milestone, isSummary: false, parentTaskId: null,
      assignedTo: null, assignments: [], dependencies: [], constraintType: 'ASAP',
      actualStartDate: null, actualEndDate: null, sortOrder: 0, description: rnd() < 0.5 ? 'Agreed with the client in the kick-off.' : null,
      updatedAt: '2026-09-01T10:00:00Z',
    });
  }

  // Links: ~1.2 per leaf, to an earlier task that finishes before this one starts
  for (let i = 20; i < leafCount; i++) {
    const r = rnd();
    const want = r < 0.15 ? 0 : r < 0.7 ? 1 : r < 0.95 ? 2 : 3;
    const chosen = new Set<number>();
    for (let tries = 0; chosen.size < want && tries < 12; tries++) {
      const j = i - 1 - Math.floor(rnd() * 60);
      if (j < 0 || chosen.has(j) || endOff[j] >= startOff[i]) continue;
      chosen.add(j);
      const tr = rnd();
      const type: PerfDep['dependencyType'] = tr < 0.8 ? 'FS' : tr < 0.9 ? 'SS' : tr < 0.98 ? 'FF' : 'SF';
      const room = startOff[i] - endOff[j] - 1;
      const lag = rnd() < 0.15 ? Math.min(room, 1 + Math.floor(rnd() * 3)) : 0;
      leaves[i].dependencies.push({ dependencyId: `t${j}`, dependencyType: type, lagDays: Math.max(0, lag) });
    }
  }

  // ~3% start a few days too early (a link they break); ~1% carry a start-no-earlier-than date
  for (let i = 0; i < leafCount; i++) {
    if (leaves[i].dependencies.length && rnd() < 0.03) {
      const back = 1 + Math.floor(rnd() * 5);
      startOff[i] -= back;
      endOff[i] -= back;
    }
    const t = leaves[i];
    t.startDate = dateAt(startOff[i]);
    t.endDate = dateAt(endOff[i]);
    if (rnd() < 0.01) { t.constraintType = 'SNET'; t.constraintDate = dateAt(startOff[i] + 2); }
    // Progress against "today"
    if (t.endDate < TODAY) {
      if (rnd() < 0.8) { t.status = 'completed'; t.progressPercentage = 100; t.actualStartDate = t.startDate; t.actualEndDate = t.endDate; }
      else { t.status = 'in_progress'; t.progressPercentage = 60; t.actualStartDate = t.startDate; }
    } else if (t.startDate <= TODAY) {
      t.status = 'in_progress'; t.progressPercentage = 30; t.actualStartDate = t.startDate;
    }
    // People
    if (!t.isMilestone && rnd() < 0.97) {
      const owner = rnd() < 0.05 ? resources[resourceCount - 1 - Math.floor(rnd() * 5)] : pick(people);
      t.assignedTo = owner.id;
      t.assignments.push({ resourceId: owner.id, allocationPct: 100 });
      if (rnd() < 0.2) {
        const second = pick(people);
        if (second.id !== owner.id) t.assignments.push({ resourceId: second.id, allocationPct: 50 });
      }
    }
  }

  // Hierarchy: contiguous runs of leaves under summaries, summaries under phases
  const phases: PerfTask[] = [];
  const summaries: PerfTask[] = [];
  const rollup = (id: string, name: string, kids: PerfTask[], parent: string | null, scheduleId: string): PerfTask => ({
    ...leaves[0], id, name, scheduleId, parentTaskId: parent, isSummary: true, isMilestone: false, dependencies: [], assignments: [], assignedTo: null,
    startDate: kids.reduce((m, k) => (k.startDate < m ? k.startDate : m), kids[0].startDate),
    endDate: kids.reduce((m, k) => (k.endDate > m ? k.endDate : m), kids[0].endDate),
    status: kids.every(k => k.status === 'completed') ? 'completed' : kids.some(k => k.status !== 'pending') ? 'in_progress' : 'pending',
    actualStartDate: null, actualEndDate: null, constraintType: 'ASAP', constraintDate: undefined, estimatedDays: 0, estimatedDurationHours: null,
  });
  const perSummary = Math.ceil(leafCount / summaryCount);
  const summariesPerPhase = Math.ceil(summaryCount / phaseCount);
  for (let p = 0; p < phaseCount; p++) {
    const phaseId = `ph${p}`;
    const scheduleId = scheduleIds[p % scheduleIds.length];
    const phaseKids: PerfTask[] = [];
    for (let s = p * summariesPerPhase; s < Math.min(summaryCount, (p + 1) * summariesPerPhase); s++) {
      const kids = leaves.slice(s * perSummary, Math.min(leafCount, (s + 1) * perSummary));
      if (kids.length === 0) continue;
      const sumId = `sm${s}`;
      // plans are workstreams that run the whole programme: summary s belongs to plan s mod 5
      const sumSchedule = scheduleIds[s % scheduleIds.length];
      for (const k of kids) { k.parentTaskId = sumId; k.scheduleId = sumSchedule; }
      const sum = rollup(sumId, `${pick(AREAS)} workstream ${s}`, kids, phaseId, sumSchedule);
      summaries.push(sum);
      phaseKids.push(sum);
    }
    if (phaseKids.length) phases.push(rollup(phaseId, `Phase ${p + 1}: ${pick(['Discovery', 'Design', 'Build', 'Test', 'Rollout'])}`, phaseKids, null, scheduleId));
  }

  // Plan order: phase, its summaries, their leaves
  const tasks: PerfTask[] = [];
  const kidsOf = new Map<string, PerfTask[]>();
  for (const t of [...summaries, ...leaves]) {
    if (!t.parentTaskId) continue;
    if (!kidsOf.has(t.parentTaskId)) kidsOf.set(t.parentTaskId, []);
    kidsOf.get(t.parentTaskId)!.push(t);
  }
  const walk = (t: PerfTask) => { tasks.push(t); for (const k of kidsOf.get(t.id) ?? []) walk(k); };
  phases.forEach(walk);
  tasks.forEach((t, i) => { t.sortOrder = i + 1; });

  // Bookings (what the repository's findEffectiveAssignments returns): one per person and task
  const bookings: PerfBooking[] = [];
  for (const t of leaves) {
    for (const a of t.assignments) {
      bookings.push({
        id: `b-${a.resourceId}-${t.id}`, resourceId: a.resourceId, taskId: t.id, scheduleId: t.scheduleId,
        hoursPerWeek: Math.round((a.allocationPct / 100) * (8 + Math.floor(rnd() * 33))), startDate: t.startDate, endDate: t.endDate, source: 'task',
      });
    }
  }

  const projectOf: Record<string, { id: string; name: string }> = {};
  scheduleIds.forEach((s, i) => { projectOf[s] = { id: `p${i}`, name: `Programme project ${i}` }; });
  return { tasks, resources, bookings, scheduleIds, projectOf };
}

/** Deep copy (services may write the in-memory dates back, e.g. the cascade) */
export const clonePlanTasks = (tasks: PerfTask[]): PerfTask[] =>
  tasks.map(t => ({ ...t, dependencies: t.dependencies.map(d => ({ ...d })), assignments: t.assignments.map(a => ({ ...a })) }));

/** A timed sample is at least this long: a faster call is timed as a batch of calls, then divided */
const MIN_SAMPLE_MS = 20;

/**
 * A timer for one case: the first, unmeasured call warms it up and sizes the batch (a call under
 * ~20 ms is timed `batch` times in a row and divided, so a sub-millisecond case is measured, not
 * timer noise). Each call of the returned function takes one sample (ms per call).
 */
async function sampler(fn: () => unknown): Promise<() => Promise<number>> {
  const t0 = performance.now();
  await fn();
  const once = performance.now() - t0;
  const batch = once >= MIN_SAMPLE_MS ? 1 : Math.min(200, Math.ceil(MIN_SAMPLE_MS / Math.max(once, 0.05)));
  return async () => {
    const t = performance.now();
    for (let k = 0; k < batch; k++) await fn();
    return (performance.now() - t) / batch;
  };
}

/**
 * A case's budget and its growth, in one go.
 *   - median: median time per call at `n` (of `runs` samples) — what the header tables record and
 *     the limits are set from (3× the median measured on an idle machine)
 *   - fastest: the fastest sample at `n` — what the tests compare with the limit. The tests run
 *     inside the full `npx vitest run` (every test file at once, often next to a browser test
 *     run), where a median can come out 3–5× slower than on an idle machine; the fastest of a
 *     few samples only needs one clean sample, so a busy machine doesn't fail the gate but a
 *     real slow-down (every sample slower) still does.
 *   - perDoubling: how much the time grows each time the work doubles, measured from n/4 to n
 *     (a 4× step keeps the two sizes far apart, so timing noise matters less) and expressed per
 *     doubling (√ of the 4× ratio): linear ≈ 2, n·log n ≈ 2.1, quadratic ≈ 4. Tests fail at 3.
 * Growth uses the FASTEST sample at each size: garbage collection and other work on the machine
 * only ever add time, so the fastest sample is the steadiest measure of the algorithm itself.
 * The samples alternate between the two sizes, so a slow patch on the machine (or a heap that
 * grows as the file runs) lands on both, not just on one. `n` must be a multiple of 4.
 */
export const MAX_GROWTH_PER_DOUBLING = 3;
export async function measure(run: (n: number) => () => unknown, n: number, runs = 5) {
  const sampleSmall = await sampler(run(n / 4));
  const sampleBig = await sampler(run(n));
  const small: number[] = [];
  const big: number[] = [];
  for (let i = 0; i < runs; i++) {
    small.push(await sampleSmall());
    big.push(await sampleBig());
  }
  small.sort((a, b) => a - b);
  big.sort((a, b) => a - b);
  return { median: big[Math.floor(runs / 2)], fastest: big[0], small: small[0], perDoubling: Math.sqrt(big[0] / Math.max(small[0], 0.001)) };
}

/** Print the measured numbers (visible with --reporter=verbose; used to fill the tables) */
export function report(label: string, values: Record<string, number>) {
  const parts = Object.entries(values).map(([k, v]) => `${k}=${Math.round(v * 100) / 100}`);
  console.log(`[perf] ${label}: ${parts.join(' ')}`);
}
