import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePredecessorText, planPredecessorEdit } from '../../components/schedule/predecessorEdit';

// Rows 1..4 → tasks a..d
const rows = new Map<number, string>([[1, 'a'], [2, 'b'], [3, 'c'], [4, 'd']]);

describe('planPredecessorEdit — typing or pasting a Predecessors cell', () => {
  it('turns row numbers into the dependencies update (FS, no lag by default)', () => {
    expect(planPredecessorEdit('2', 'd', rows)).toEqual({
      ok: true, patch: { dependencies: [{ dependencyId: 'b', dependencyType: 'FS', lagDays: 0 }] },
    });
  });

  it('reads link types and lags, in any case, with spaces', () => {
    const r = planPredecessorEdit('1SS+2d, 2 ff -1, 3sf', 'd', rows);
    expect(r).toEqual({ ok: true, patch: { dependencies: [
      { dependencyId: 'a', dependencyType: 'SS', lagDays: 2 },
      { dependencyId: 'b', dependencyType: 'FF', lagDays: -1 },
      { dependencyId: 'c', dependencyType: 'SF', lagDays: 0 },
    ] } });
  });

  it('reads back exactly what the cell shows (copy → paste round trip)', () => {
    // The cell shows "1,2SS+3d,3FF-1d"
    const r = planPredecessorEdit('1,2SS+3d,3FF-1d', 'd', rows);
    expect(r.ok && r.patch.dependencies.map(d => `${d.dependencyId}${d.dependencyType}${d.lagDays}`))
      .toEqual(['aFS0', 'bSS3', 'cFF-1']);
  });

  it('a blank cell removes every predecessor', () => {
    expect(planPredecessorEdit('  ', 'd', rows)).toEqual({ ok: true, patch: { dependencies: [] } });
  });

  it('refuses rows that do not exist, the task itself, duplicates and bad text', () => {
    expect(planPredecessorEdit('9', 'd', rows)).toEqual({ ok: false, message: 'Row 9 not found' });
    expect(planPredecessorEdit('4', 'd', rows)).toEqual({ ok: false, message: 'Cannot reference self' });
    expect(planPredecessorEdit('1,1SS', 'd', rows)).toEqual({ ok: false, message: 'Duplicate: row 1' });
    const bad = planPredecessorEdit('after design', 'd', rows);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/Invalid format/);
  });

  it('refuses more than 20 predecessors', () => {
    const many = new Map<number, string>(Array.from({ length: 22 }, (_, i) => [i + 1, `t${i + 1}`]));
    const text = Array.from({ length: 21 }, (_, i) => String(i + 1)).join(',');
    expect(planPredecessorEdit(text, 'x', many)).toEqual({ ok: false, message: 'Max 20 predecessors' });
  });

  it('parsePredecessorText gives the same answer the plan is built from', () => {
    expect(parsePredecessorText('2SS', 'd', rows)).toEqual({ deps: [{ taskId: 'b', type: 'SS', lag: 0 }] });
  });
});

// Oct 2026: pasting into a Predecessors cell sent the raw text ("3SS") as the task's
// dependency, which the server can't use. Typing and pasting, in both views, must go
// through the one parser and send the same `dependencies` update.
describe('Gantt and Table use the one Predecessors rule', () => {
  const SCHEDULE = join(__dirname, '../../components/schedule');
  for (const file of ['GanttChart.tsx', 'TableView.tsx']) {
    const src = readFileSync(join(SCHEDULE, file), 'utf8');
    it(`${file} calls planPredecessorEdit for typing and pasting`, () => {
      expect(src).toContain("from './predecessorEdit'");
      expect((src.match(/planPredecessorEdit\(/g) || []).length).toBeGreaterThanOrEqual(2);
    });
    it(`${file} has no parser of its own and never pastes the raw text`, () => {
      expect(src).not.toMatch(/parsePredecessorInput/);
      expect(src).not.toMatch(/\(FS\|FF\|SS\|SF\)/);
      expect(src).not.toMatch(/'dependency' \? 'dependencies'/);
    });
  }
});
