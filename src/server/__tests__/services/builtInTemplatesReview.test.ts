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
import { weekdaysOnly, onOrAfterWorking, shiftWorking, finishFor, utcDay, ymdOf, workingDaysAfter } from '../../utils/workingDays';

const START = utcDay('2026-10-05');

/** The main predecessor, then any more (as applying the template links them) */
const links = (t: any) => [
  ...(t.dependencyRefId ? [{ dependencyId: t.dependencyRefId, dependencyType: t.dependencyType || 'FS', lagDays: 0 }] : []),
  ...(t.moreDependencies ?? []).map((d: any) => ({ dependencyId: d.refId, dependencyType: d.dependencyType || 'FS', lagDays: d.lagDays || 0 })),
];

function layOut(template: any): ReviewTask[] {
  const byRef = new Map<string, any>(template.tasks.map((t: any) => [t.refId, t]));
  const done = new Map<string, { start: Date; end: Date }>();
  const place = (t: any): { start: Date; end: Date } => {
    if (done.has(t.refId)) return done.get(t.refId)!;
    let start = shiftWorking(onOrAfterWorking(START, weekdaysOnly), Math.max(0, Math.round(t.offsetDays || 0)), weekdaysOnly);
    links(t).forEach((l, i) => {
      const dep = byRef.get(l.dependencyId);
      if (!dep) return;
      const d = place(dep);
      const earliest = l.dependencyType === 'FS' ? shiftWorking(d.end, 1 + l.lagDays, weekdaysOnly)
        : l.dependencyType === 'SS' ? shiftWorking(d.start, l.lagDays, weekdaysOnly) : null;
      if (earliest && (i === 0 || earliest > start)) start = earliest;
    });
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
      dependencies: links(t),
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
      if (process.env.TEMPLATE_DETAIL) for (const f of r.findings.filter(f => f.ruleId !== 'R10')) console.log(`      ${f.ruleId}: ${f.message} [${f.taskIds.join(',')}]`);
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
    // Score floors on 2026-10-01, after every template was fixed: links on tasks not phases,
    // every task feeds something (extra predecessors), milestones are zero-day outcomes. What
    // is left below 94 is R13 (long tasks) — that is each industry's content, left as it is.
    const FLOOR: Record<string, number> = {
      'System Implementation Engagement': 88,
      'Discovery and Assessment Engagement': 94,
      'Process Improvement Engagement': 94,
      'PMO / Project Management Support Engagement': 94,
      'Web Application Development': 94,
      'Cloud Migration': 90,
      'System Upgrade / ERP Implementation': 90,
      'Commercial Building Construction': 88,
      'Residential Construction': 94,
      'Utilities Infrastructure': 88,
      'Telecom Network Deployment': 94,
      'Highway Construction': 88,
      'Bridge Construction': 88,
      'Generic PMI Project': 94,
      'Agile/Scrum Sprint Project': 94,
      'Marketing Campaign': 94,
      'Product Launch': 94,
      'Office Relocation': 94,
    };
    for (const t of templates) {
      const min = FLOOR[t.name] ?? 50;
      expect([t.name, review(t).score >= min]).toEqual([t.name, true]);
    }
  });

  it("each template's length covers its plan — the schedule's end date comes from it (2026-10-02)", () => {
    for (const t of templates) {
      const tasks = layOut(t);
      const last = tasks.map(x => x.endDate!).sort().pop()!;
      const span = 1 + workingDaysAfter(START, utcDay(last), weekdaysOnly);
      expect([t.name, t.estimatedDurationDays >= span, span]).toEqual([t.name, true, span]);
    }
  });
});
