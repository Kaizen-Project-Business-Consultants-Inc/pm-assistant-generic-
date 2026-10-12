import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { seedStatements, SAMPLE_FIX_FILES } from '../../services/SampleProjectService';

/**
 * Audit 2, numbers L4 (2026-10-11): T081 moved the sample's weekend dates without re-checking its
 * links. It only moves END dates back (no task starts on a weekend), which can't break a link —
 * but checking found one the seed itself broke: Phase 5 linked Finish-to-Start to Phase 4 while
 * starting three days before Phase 4 ends. T090 fixes it. This rebuilds the sample as a new
 * company gets it (seed, then every fix file) and checks every link the way the app's re-flow does
 * (ScheduleRecomputeService: working days, FS = the working day after the predecessor ends + lag).
 */
type Task = { start: string; end: string };

const DAY = 86_400_000;
const toDate = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const isWeekend = (d: Date) => d.getUTCDay() === 0 || d.getUTCDay() === 6;
/** n working days after (n < 0: before) a date, weekends skipped — the sample uses the default calendar */
function shiftWorking(s: string, n: number): string {
  let d = toDate(s);
  const step = n < 0 ? -1 : 1;
  for (let left = Math.abs(n); left > 0;) { d = new Date(d.getTime() + step * DAY); if (!isWeekend(d)) left--; }
  return iso(d);
}
/** T081's rule: a Saturday goes back 1 day, a Sunday 2 */
const fridayBefore = (s: string) => { const d = toDate(s).getUTCDay(); return d === 6 ? iso(new Date(toDate(s).getTime() - DAY)) : d === 0 ? iso(new Date(toDate(s).getTime() - 2 * DAY)) : s; };

function buildSample() {
  const tasks = new Map<string, Task>();
  const links = new Map<string, { succ: string; pred: string; type: string; lag: number }>();
  for (const stmt of seedStatements()) {
    if (/^INSERT IGNORE INTO tasks\b/.test(stmt)) {
      for (const m of stmt.matchAll(/\('(demo-t-[\w-]+)', 'demo-sch-1', '(?:[^']|'')*', '(?:[^']|'')*', '\w+', '\w+', '\w+', '(\d{4}-\d\d-\d\d)', '(\d{4}-\d\d-\d\d)'/g)) {
        tasks.set(m[1], { start: m[2], end: m[3] });
      }
    }
    if (/^INSERT IGNORE INTO task_dependencies\b/.test(stmt)) {
      for (const m of stmt.matchAll(/\('(demo-dep-\d+)', '([\w-]+)', '([\w-]+)', '(\w+)', (\d+)\)/g)) {
        links.set(m[1], { succ: m[2], pred: m[3], type: m[4], lag: Number(m[5]) });
      }
    }
  }
  const fixes = SAMPLE_FIX_FILES.map(f => readFileSync(f, 'utf-8')).join('\n');
  // T081: weekend starts and ends of sample tasks go back to the Friday before
  if (/UPDATE tasks SET start_date = DATE_SUB/.test(fixes)) for (const t of tasks.values()) t.start = fridayBefore(t.start);
  if (/UPDATE tasks SET end_date = DATE_SUB/.test(fixes)) for (const t of tasks.values()) t.end = fridayBefore(t.end);
  // link fixes: UPDATE task_dependencies SET dependency_type = 'X' [, lag_days = n] WHERE id = 'demo-dep-n' …
  for (const m of fixes.matchAll(/UPDATE task_dependencies SET dependency_type = '(\w+)'(?:, lag_days = (\d+))?\s+WHERE id = '(demo-dep-\d+)'/g)) {
    const l = links.get(m[3])!;
    l.type = m[1];
    if (m[2] !== undefined) l.lag = Number(m[2]);
  }
  return { tasks, links };
}

describe('the sample project honours its own links', () => {
  const { tasks, links } = buildSample();

  it('the rebuild found the sample (tasks and links parsed)', () => {
    expect(tasks.size).toBeGreaterThanOrEqual(25);
    expect(links.size).toBe(13);
    for (const l of links.values()) { expect(tasks.has(l.succ), l.succ).toBe(true); expect(tasks.has(l.pred), l.pred).toBe(true); }
  });

  it('every successor meets its link (FS / SS / FF / SF, lag in working days)', () => {
    const broken: string[] = [];
    for (const [id, l] of links) {
      const s = tasks.get(l.succ)!;
      const p = tasks.get(l.pred)!;
      const [need, got] = l.type === 'FS' ? [shiftWorking(p.end, l.lag + 1), s.start]
        : l.type === 'SS' ? [shiftWorking(p.start, l.lag), s.start]
        : l.type === 'FF' ? [shiftWorking(p.end, l.lag), s.end]
        : [shiftWorking(p.start, l.lag), s.end];
      if (got < need) broken.push(`${id} ${l.succ} ${l.type}+${l.lag} on ${l.pred}: needs ${need}, has ${got}`);
    }
    expect(broken).toEqual([]);
  });

  it('T090 is run on a reloaded sample, and changes only the untouched seed link and dates', () => {
    expect(SAMPLE_FIX_FILES.some(f => f.endsWith('T090_sample_links_respected.sql'))).toBe(true);
    const t090 = readFileSync(SAMPLE_FIX_FILES.find(f => f.endsWith('T090_sample_links_respected.sql'))!, 'utf-8');
    expect(t090).toMatch(/WHERE id = 'demo-dep-5' AND task_id = 'demo-t-p5' AND dependency_id = 'demo-t-p4'\s+AND dependency_type = 'FS' AND lag_days = 0/);
    // and only while both phases still have their seeded dates (a company that moved them keeps theirs)
    expect(t090).toMatch(/p5\.id = 'demo-t-p5' AND p5\.start_date = '2026-09-22'/);
    expect(t090).toMatch(/p4\.id = 'demo-t-p4' AND p4\.start_date = '2026-08-11'\s+AND p4\.end_date IN \('2026-09-25', '2026-09-26'\)/);
    // the seeded dates it checks for are the sample's real ones (after T081)
    expect(tasks.get('demo-t-p5')!.start).toBe('2026-09-22');
    expect(tasks.get('demo-t-p4')).toEqual({ start: '2026-08-11', end: '2026-09-25' });
    // one statement, and idempotent: it only acts on the FS link it turns into FF
    expect(t090.match(/^UPDATE /gm)).toHaveLength(1);
    expect(t090).toMatch(/SET dependency_type = 'FF'[\s\S]*AND dependency_type = 'FS'/);
  });
});
