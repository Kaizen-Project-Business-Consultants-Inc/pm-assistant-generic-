import { describe, it, expect, vi } from 'vitest';

/**
 * Built-in templates must pass Kovarti's own Schedule Review (2026-10-01: a new project from the
 * Web Application template scored 50, "Needs work" — tasks feeding nothing, a 5-day "Go-Live"
 * milestone). Each template is laid out the way applying it lays it out (working days from a
 * Monday, FS/SS links, children no earlier than their phase) and reviewed with the real rules.
 */
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []), queryControlPlane: vi.fn(async () => []) } }));
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { TemplateService } from '../../services/TemplateService';
import { reviewSchedule, ReviewTask } from '../../services/scheduleReview/rules';
import { weekdaysOnly, onOrAfterWorking, shiftWorking, finishFor, utcDay, ymdOf } from '../../utils/workingDays';

const START = utcDay('2026-10-05');

function layOut(template: any): ReviewTask[] {
  const byRef = new Map<string, any>(template.tasks.map((t: any) => [t.refId, t]));
  const done = new Map<string, { start: Date; end: Date }>();
  const place = (t: any): { start: Date; end: Date } => {
    if (done.has(t.refId)) return done.get(t.refId)!;
    let start = shiftWorking(onOrAfterWorking(START, weekdaysOnly), Math.max(0, Math.round(t.offsetDays || 0)), weekdaysOnly);
    const dep = t.dependencyRefId ? byRef.get(t.dependencyRefId) : null;
    if (dep) {
      const d = place(dep);
      if ((t.dependencyType || 'FS') === 'FS') start = shiftWorking(d.end, 1, weekdaysOnly);
      else if (t.dependencyType === 'SS') start = d.start;
    }
    const parent = t.parentRefId ? byRef.get(t.parentRefId) : null;
    if (parent) { const p = place(parent); if (start < p.start) start = p.start; }
    start = onOrAfterWorking(start, weekdaysOnly);
    const end = t.isMilestone ? start : finishFor(start, t.estimatedDays, weekdaysOnly);
    const r = { start, end };
    done.set(t.refId, r);
    return r;
  };
  template.tasks.forEach((t: any) => place(t));
  // A phase spans its tasks (the app rolls summary dates up from the children)
  for (const t of [...template.tasks].reverse()) {
    if (!t.isSummary) continue;
    const kids = template.tasks.filter((c: any) => c.parentRefId === t.refId).map((c: any) => done.get(c.refId)!).filter(Boolean);
    if (kids.length) done.set(t.refId, {
      start: new Date(Math.min(...kids.map(k => k.start.getTime()))),
      end: new Date(Math.max(...kids.map(k => k.end.getTime()))),
    });
  }
  return template.tasks.map((t: any, i: number) => {
    const { start, end } = done.get(t.refId)!;
    return {
      id: t.refId, name: t.name, description: t.description, status: 'pending',
      startDate: ymdOf(start), endDate: ymdOf(end), estimatedDays: t.isMilestone ? 0 : t.estimatedDays,
      isMilestone: !!t.isMilestone, isSummary: !!t.isSummary, parentTaskId: t.parentRefId ?? null, sortOrder: i + 1,
      dependencies: t.dependencyRefId ? [{ dependencyId: t.dependencyRefId, dependencyType: t.dependencyType || 'FS', lagDays: 0 }] : [],
    } as ReviewTask;
  });
}

const templates: any[] = (TemplateService as any).templates;
const review = (t: any) => reviewSchedule({
  schedule: { id: 's' }, project: { projectType: t.projectType, methodology: t.defaultMethodology ?? 'waterfall' },
  tasks: layOut(t), baselineCount: 1, today: utcDay('2026-09-01'),
});

describe('built-in templates pass Schedule Review', () => {
  it('prints every template\'s score (for the report)', () => {
    for (const t of templates) {
      const r = review(t);
      console.log(`${String(r.score).padStart(3)} ${r.band.padEnd(12)} ${t.name} — ${r.findings.map(f => `${f.ruleId}(${f.severity})`).join(' ')}`);
    }
    expect(templates.length).toBeGreaterThan(5);
  });

  // Owners (R10) can't be named in a template — they're assigned when the project is set up
  const realFindings = (t: any) => review(t).findings.filter(f => f.ruleId !== 'R10');

  it('Web Application Development is fit for control, with nothing to fix but owners', () => {
    const t = templates.find(x => x.name === 'Web Application Development');
    expect(review(t).band).toBe('fit_for_control');
    expect(realFindings(t)).toEqual([]);
  });

  it('no built-in template gets worse than it is today (ratchet — raise as templates are fixed)', () => {
    // Score floors on 2026-10-01. The others still need multi-predecessor support to stop
    // "tasks feed nothing" (R02) — tracked as a follow-up.
    const FLOOR: Record<string, number> = {
      'Web Application Development': 94,
    };
    for (const t of templates) {
      const min = FLOOR[t.name] ?? 50;
      expect([t.name, review(t).score >= min]).toEqual([t.name, true]);
    }
  });
});
