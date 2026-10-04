import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Rules kept in two places — the screen (src/client) and the server (src/server) — that must give
 * the same answer. Each block feeds BOTH copies the same broad table of cases and fails if any
 * answer differs, so changing one copy without the other fails here until both match.
 * (Code-health review item 2, 2026-10-04. TESTING_GUIDE.md "Rules kept in two places" lists them.)
 */

vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []) } }));
vi.mock('../../services/domainEvents', () => ({ rateCardChanged: vi.fn() }));

// Server copies
import { computeScheduleRowNumbers } from '../../utils/scheduleRowNumbers';
import * as serverWD from '../../utils/workingDays';
import { CalendarService, calendarService, type CalendarSpec } from '../../services/CalendarService';
import { needsEscalationPrompt as serverEscalation } from '../../utils/escalationPrompt';
import { analyzeReadingLevel as serverReading } from '../../utils/readingLevel';
import { ratesOn, type RateCardEntry } from '../../services/RateCardService';
import { PROJECT_TYPES } from '../../constants/projectTypes';
// Screen copies
import { buildRowNumberMap, type GanttTask } from '../../../client/src/components/schedule/gantt/types';
import * as clientWD from '../../../client/src/utils/workingDays';
import { needsEscalationPrompt as clientEscalation } from '../../../client/src/utils/escalationPrompt';
import { analyzeReadingLevel as clientReading } from '../../../client/src/utils/readingLevel';
import { cardRateOn } from '../../../client/src/utils/rateCard';
import { PROJECT_TYPE_OPTIONS } from '../../../client/src/constants/projectTypes';

/** Collect every disagreement, so a failure lists all of them, not just the first */
function mismatches<C>(cases: C[], server: (c: C) => unknown, client: (c: C) => unknown) {
  const out: Array<{ case: C; server: unknown; client: unknown }> = [];
  for (const c of cases) {
    const s = server(c);
    const k = client(c);
    if (JSON.stringify(s) !== JSON.stringify(k)) out.push({ case: c, server: s, client: k });
  }
  return out;
}

/** Small deterministic random generator, so the generated cases are the same every run */
function rng(seed: number) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}

// ---------------------------------------------------------------------------
// 1. Task row numbers: client buildRowNumberMap ↔ server computeScheduleRowNumbers
// ---------------------------------------------------------------------------
describe('row numbers — screen and server number every task the same', () => {
  type T = { id: string; parentTaskId?: string; sortOrder?: number; startDate?: string; createdAt?: string };
  const asGantt = (list: T[]) => list.map(t => ({ ...t, name: t.id, status: 'pending' }) as GanttTask);
  const compare = (list: T[]) => ({
    server: Object.fromEntries(computeScheduleRowNumbers(list.map(t => ({ ...t })))),
    client: Object.fromEntries(buildRowNumberMap(asGantt(list))),
  });

  const handmade: Array<[string, T[]]> = [
    ['flat, sortOrder from 1', [{ id: 'c', sortOrder: 3 }, { id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 2 }]],
    ['flat, sortOrder from 0', [{ id: 'b', sortOrder: 1 }, { id: 'a', sortOrder: 0 }]],
    ['children restart sortOrder under each parent', [
      { id: 'phase1', sortOrder: 0 }, { id: 'phase2', sortOrder: 1 },
      { id: 'p1-b', parentTaskId: 'phase1', sortOrder: 1 }, { id: 'p1-a', parentTaskId: 'phase1', sortOrder: 0 },
      { id: 'p2-a', parentTaskId: 'phase2', sortOrder: 0 }, { id: 'p1-a-x', parentTaskId: 'p1-a', sortOrder: 0 },
    ]],
    ['sortOrder tie → start date, undated first', [
      { id: 'late', sortOrder: 0, startDate: '2026-10-09' }, { id: 'early', sortOrder: 0, startDate: '2026-10-05' },
      { id: 'undated', sortOrder: 0 },
    ]],
    ['undated before an old (pre-1970) date', [
      { id: 'old', sortOrder: 0, startDate: '1969-12-31' }, { id: 'undated', sortOrder: 0 },
    ]],
    ['start date with a time part counts as its day', [
      { id: 'b', sortOrder: 0, startDate: '2026-10-05T00:00:00.000Z', createdAt: '2026-01-02 00:00:00' },
      { id: 'a', sortOrder: 0, startDate: '2026-10-05', createdAt: '2026-01-01 00:00:00' },
    ]],
    ['same sortOrder and date → creation time, then id', [
      { id: 'z', sortOrder: 2, startDate: '2026-10-05', createdAt: '2026-09-01 10:00:00' },
      { id: 'y', sortOrder: 2, startDate: '2026-10-05', createdAt: '2026-09-01 09:00:00' },
      { id: 'x', sortOrder: 2, startDate: '2026-10-05', createdAt: '2026-09-01 10:00:00' },
      { id: 'w', sortOrder: 2, startDate: '2026-10-05' },
    ]],
    ['everything tied → id order', [{ id: 'b' }, { id: 'a' }, { id: 'c' }]],
    ['missing sortOrder counts as 0; negatives first', [
      { id: 'none' }, { id: 'neg', sortOrder: -1 }, { id: 'one', sortOrder: 1 }, { id: 'zero', sortOrder: 0 },
    ]],
    ['parent missing from the list → shown at top level', [
      { id: 'orphan', parentTaskId: 'gone', sortOrder: 0 }, { id: 'top', sortOrder: 1 },
    ]],
    ['parent cycle in bad data is left out by both', [
      { id: 'a', parentTaskId: 'b' }, { id: 'b', parentTaskId: 'a' }, { id: 'self', parentTaskId: 'self' }, { id: 'ok', sortOrder: 5 },
    ]],
    ['deep nesting', [
      { id: 'l1', sortOrder: 0 }, { id: 'l2', parentTaskId: 'l1' }, { id: 'l3', parentTaskId: 'l2' },
      { id: 'l4', parentTaskId: 'l3' }, { id: 'l1b', sortOrder: 1 }, { id: 'l2b', parentTaskId: 'l1', sortOrder: 1 },
    ]],
    ['empty plan', []],
  ];

  it.each(handmade)('%s', (_name, list) => {
    const { server, client } = compare(list);
    expect(client).toEqual(server);
  });

  it('200 generated plans with ties, gaps, undated tasks and nesting', () => {
    const r = rng(42);
    const bad: unknown[] = [];
    for (let p = 0; p < 200; p++) {
      const n = 1 + Math.floor(r() * 25);
      const list: T[] = [];
      for (let i = 0; i < n; i++) {
        const t: T = { id: `t${Math.floor(r() * 1000)}-${i}` };
        if (i > 0 && r() < 0.5) t.parentTaskId = list[Math.floor(r() * i)].id;
        if (r() < 0.85) t.sortOrder = Math.floor(r() * 4);
        if (r() < 0.7) t.startDate = `2026-${String(1 + Math.floor(r() * 3)).padStart(2, '0')}-${String(1 + Math.floor(r() * 3)).padStart(2, '0')}`;
        if (r() < 0.7) t.createdAt = `2026-09-0${1 + Math.floor(r() * 2)} 10:00:00`;
        list.push(t);
      }
      const { server, client } = compare(list);
      const key = (m: Record<string, number>) => JSON.stringify(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)));
      if (key(server) !== key(client)) bad.push({ list, server, client });
    }
    expect(bad).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Working days: client utils/workingDays.ts ↔ server utils/workingDays.ts + CalendarService
// ---------------------------------------------------------------------------
describe('working days — screen and server count and move dates the same', () => {
  const RANGE = { from: '2026-01-01', to: '2027-12-31' };
  const specs: Array<[string, CalendarSpec | null]> = [
    ['no calendar loaded (Mon–Fri)', null],
    ['Mon–Fri + project days off, company holidays, extra working days', {
      workingDays: [1, 2, 3, 4, 5],
      holidays: new Set(['2026-10-12', '2026-12-25', '2026-11-11']),             // Thanksgiving, Christmas, a day that is also a company holiday
      working: new Set(['2026-10-17', '2026-12-28', '2026-11-11', '2027-01-01']), // a Saturday; a company holiday worked anyway; a day off that "wins"
      company: new Set(['2026-12-28', '2026-11-11', '2027-01-01', '2026-12-31']),
    }],
    ['six-day week (Mon–Sat)', { workingDays: [1, 2, 3, 4, 5, 6], holidays: new Set(['2026-10-31']), working: new Set(), company: new Set() }],
    ['Sun–Wed', { workingDays: [0, 1, 2, 3], holidays: new Set(), working: new Set(['2026-10-15']), company: new Set(['2026-10-18']) }],
  ];

  /** The screen's calendar, built the way the app builds it: the server's non-working dates for a range */
  async function both(spec: CalendarSpec | null) {
    if (!spec) return { cal: null, isW: serverWD.weekdaysOnly };
    vi.spyOn(calendarService, 'calendarSpec').mockResolvedValueOnce(spec);
    const nonWorking = await calendarService.getNonWorkingDates('p1', RANGE.from, RANGE.to);
    const check = await calendarService.workingDayChecker('p1', spec);
    return { cal: { nonWorking: new Set(nonWorking), ...RANGE }, isW: (d: Date) => check(serverWD.ymdOf(d)) };
  }

  const days = (from: string, n: number) => Array.from({ length: n }, (_, i) => clientWD.addCalendarDays(from, i)!);
  const starts = days('2026-10-01', 100);               // Oct–early Jan: weekends, every special day above
  const ends = (s: string) => [s, ...[1, 2, 4, 6, 9, 15, 31].map(n => clientWD.addCalendarDays(s, n)!)];
  const d = serverWD.utcDay;

  it.each(specs)('%s: which days are worked', async (_n, spec) => {
    const { cal, isW } = await both(spec);
    expect(mismatches(days('2026-09-25', 140), x => isW(d(x)), x => clientWD.isWorkingDay(x, cal))).toEqual([]);
    // Same for CalendarService.isWorking on the calendar-date string itself
    if (spec) expect(mismatches(days('2026-09-25', 140), x => CalendarService.isWorking(x, spec), x => clientWD.isWorkingDay(x, cal))).toEqual([]);
  });

  it.each(specs)('%s: working days from start to end, both counted (the Duration column)', async (_n, spec) => {
    const { cal, isW } = await both(spec);
    const cases = starts.flatMap(s => ends(s).map(e => [s, e] as const));
    expect(mismatches(cases, ([s, e]) => serverWD.workingDaysBetween(s, e, isW), ([s, e]) => clientWD.workingDaysBetween(s, e, cal))).toEqual([]);
    // The server's CPM duration is the same number whenever the span holds a working day
    const spans = cases.filter(([s, e]) => (clientWD.workingDaysBetween(s, e, cal) ?? 0) > 0);
    expect(mismatches(spans,
      ([s, e]) => serverWD.taskWorkingDuration({ startDate: s, endDate: e }, isW),
      ([s, e]) => clientWD.workingDaysBetween(s, e, cal))).toEqual([]);
  });

  it.each(specs)('%s: finish date for N working days (typing a Duration)', async (_n, spec) => {
    const { cal, isW } = await both(spec);
    const cases = starts.flatMap(s => [1, 2, 3, 5, 10, 20, 1.5, 2.5, 4.01].map(n => [s, n] as const));
    expect(mismatches(cases,
      ([s, n]) => serverWD.ymdOf(serverWD.finishFor(d(s), n, isW)),
      ([s, n]) => clientWD.finishAfterWorkingDays(s, n, cal))).toEqual([]);
  });

  it.each(specs)('%s: first working day on or after a date', async (_n, spec) => {
    const { cal, isW } = await both(spec);
    expect(mismatches(starts, s => serverWD.ymdOf(serverWD.onOrAfterWorking(d(s), isW)), s => clientWD.nextWorkingDay(s, cal))).toEqual([]);
  });

  it.each(specs)('%s: moving N working days forward or back', async (_n, spec) => {
    const { cal, isW } = await both(spec);
    const cases = starts.flatMap(s => [-15, -6, -5, -2, -1, 0, 1, 2, 3, 5, 7, 15].map(n => [s, n] as const));
    expect(mismatches(cases,
      ([s, n]) => serverWD.ymdOf(serverWD.shiftWorking(d(s), n, isW)),
      ([s, n]) => clientWD.shiftWorkingDays(s, n, cal))).toEqual([]);
  });

  it('calendar-day arithmetic', () => {
    const cases = days('2026-02-20', 20).flatMap(s => [-400, -31, -1, 0, 1, 10, 365].map(n => [s, n] as const));
    expect(mismatches(cases, ([s, n]) => serverWD.addCalendarDays(s, n), ([s, n]) => clientWD.addCalendarDays(s, n))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 3. "Escalate to sponsor?" prompt: client utils/escalationPrompt.ts ↔ server utils/escalationPrompt.ts
// ---------------------------------------------------------------------------
describe('sponsor escalation prompt — screen and server ask on the same items', () => {
  it('every combination of type, severity, status, escalated and "Not now"', () => {
    const cases: any[] = [];
    for (const type of ['risk', 'issue', 'action', 'decision', 'assumption', 'dependency'])
      for (const severity of ['critical', 'high', 'medium', 'low', 'Critical', undefined])
        for (const status of ['open', 'in_progress', 'monitoring', 'closed', 'resolved', 'cancelled', 'reversed', 'mitigated'])
          for (const escalatedAt of [null, undefined, '2026-10-03T10:00:00Z'])
            for (const escalationPromptDismissedAt of [null, '2026-10-03T10:00:00Z'])
              cases.push({ type, severity, status, escalatedAt, escalationPromptDismissedAt });
    expect(mismatches(cases, c => serverEscalation(c), c => clientEscalation(c))).toEqual([]);
    expect(cases.some(c => clientEscalation(c))).toBe(true); // the table does reach the "ask" answer
  });
});

// ---------------------------------------------------------------------------
// 4. Rate in force on a day: client utils/rateCard.ts cardRateOn ↔ server RateCardService.ratesOn
// ---------------------------------------------------------------------------
describe('rate card — screen and server pick the same rate for a role on a day', () => {
  it('case and spaces in roles, several start dates, before the first rate, on the day it starts', () => {
    const card: RateCardEntry[] = [
      { id: '1', role: 'Developer', hourlyRate: 80, overtimeRate: null, effectiveFrom: '2026-01-01' },
      { id: '2', role: 'developer ', hourlyRate: 90, overtimeRate: 130, effectiveFrom: '2026-07-01' },
      { id: '3', role: 'DEVELOPER', hourlyRate: 95, overtimeRate: null, effectiveFrom: '2027-01-01' },
      { id: '4', role: 'Tester', hourlyRate: 60, overtimeRate: null, effectiveFrom: '2026-03-15' },
      { id: '5', role: 'Project Manager', hourlyRate: 110, overtimeRate: null, effectiveFrom: '2026-10-04' },
    ];
    const cases = ['Developer', ' developer', 'DEVELOPER ', 'Tester', 'tester', 'Project manager', 'Architect', '']
      .flatMap(role => ['2025-12-31', '2026-01-01', '2026-03-14', '2026-03-15', '2026-06-30', '2026-07-01', '2026-10-03', '2026-10-04', '2026-12-31', '2027-01-01', '2030-01-01']
        .map(day => [role, day] as const));
    expect(mismatches(cases,
      ([role, day]) => ratesOn({ role, costRateHourly: null, overtimeRateHourly: null, useRateCard: true }, day, card).standard,
      ([role, day]) => cardRateOn(role, day, card as any)?.hourlyRate ?? null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. Reading level (project brief): client utils/readingLevel.ts ↔ server utils/readingLevel.ts
// ---------------------------------------------------------------------------
describe('reading level — screen and server score text the same', () => {
  it('plain, dense, empty, punctuation-only and odd text', () => {
    const texts = [
      '', '   ', '...', 'Hello.', 'The cat sat on the mat.',
      'We will deliver the loan origination system by Q3. Testing starts in July!',
      'Notwithstanding the aforementioned interdependencies, the organisational transformation necessitates comprehensive stakeholder realignment.',
      'Is it done? Yes! Ship it.', 'no punctuation at all just words running on and on',
      'Re-estimate the e-commerce API (v2) — 3 days, maybe 4?', 'Ünïcödé naïve café résumé.', 'a\n\nb\tc. d',
    ];
    expect(mismatches(texts, t => serverReading(t), t => clientReading(t))).toEqual([]);
  });

  it('300 generated texts spread across every score band', () => {
    const r = rng(7);
    const words = ['plan', 'the', 'team', 'will', 'deliver', 'integration', 'organisational', 'a', 'requirement', 'is',
      'stakeholder', 'go', 'testing', 'by', 'unbelievably', 'complicated', 'we', 'review', 'it', 'documentation', 'ok', 'religious'];
    const texts = Array.from({ length: 300 }, () => {
      const sentences = 1 + Math.floor(r() * 4);
      return Array.from({ length: sentences }, () =>
        Array.from({ length: 2 + Math.floor(r() * 18) }, () => words[Math.floor(r() * words.length)]).join(' ') + (r() < 0.8 ? '.' : '?')).join(' ');
    });
    const levels = new Set(texts.map(t => serverReading(t).level));
    expect(levels.size).toBe(3); // the table reaches easy, moderate and advanced
    expect(mismatches(texts, t => serverReading(t), t => clientReading(t))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 6. Project types: one list in five places (server, screen, MCP server, database ENUM)
// ---------------------------------------------------------------------------
describe('project types — the same list everywhere', () => {
  const root = join(__dirname, '../../../..');
  const sorted = (a: readonly string[]) => [...a].sort();

  it('the screen offers exactly the types the server accepts', () => {
    expect(sorted(PROJECT_TYPE_OPTIONS.map(o => o.value))).toEqual(sorted(PROJECT_TYPES));
  });

  it('the MCP server (separate package) accepts the same types', () => {
    const src = readFileSync(join(root, 'mcp-server/src/tools/projects.ts'), 'utf8');
    const enums = [...src.matchAll(/projectType:\s*z\.enum\(\[([^\]]*)\]\)/g)].map(m => [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1]));
    expect(enums.length).toBeGreaterThan(0);
    for (const e of enums) expect(sorted(e)).toEqual(sorted(PROJECT_TYPES));
  });

  it('the latest database ENUM (last tenant migration that changes it) holds the same types', () => {
    const dir = join(root, 'src/server/database/tenant-migrations');
    const changes = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
      .map(f => readFileSync(join(dir, f), 'utf8').match(/ALTER TABLE projects\s+MODIFY\s+(?:COLUMN\s+)?project_type\s+ENUM\(([^)]*)\)/i))
      .filter((m): m is RegExpMatchArray => !!m);
    expect(changes.length).toBeGreaterThan(0);
    const latest = changes[changes.length - 1][1];
    expect(sorted([...latest.matchAll(/'([^']+)'/g)].map(x => x[1]))).toEqual(sorted(PROJECT_TYPES));
  });
});
