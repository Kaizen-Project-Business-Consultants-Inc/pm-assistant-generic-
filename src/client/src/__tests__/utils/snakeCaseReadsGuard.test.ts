import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * The server camelCases every JSON API response (plugins.ts preSerialization → toCamelCaseKeys,
 * recursively, INCLUDING MAP KEYS: a `{ in_review: 3 }` count map arrives as `{ inReview: 3 }`).
 * Screens that read snake_case names from API data get `undefined`: Goals showed every key result
 * as a top-level objective with no due date, Agent Proposals had no risk/confidence/agent/date,
 * every portal link read "Inactive", the PM activity feed showed every notification as unread with
 * no time, the what-if history crashed on Pin (fixed 2026-09-30); the dashboard Change Requests
 * widget left In Review requests out of "Awaiting Review" (fixed 2026-10-06). The admin pages have
 * their own zero-tolerance test, adminFieldNames.test.ts.
 *
 * A TIGHT RATCHET over EVERY client source file (since 2026-10-06; before, only a list was
 * checked). The reads that remain were audited one at a time and are FINE:
 *  - camelCase-first fallbacks (`p.endDate || p.end_date`) or snake-first with a camelCase
 *    fallback (`t.story_points ?? t.storyPoints`) — the snake half is just never used;
 *  - form objects the client builds itself (SprintPlanningPanel's create form);
 *  - local counter / style maps keyed by VALUES, which are not camelCased (ComplianceReport
 *    `counts.api_key`, ScheduleWorkspace `counts.at_risk`, `STATUS_STYLES.on_track`,
 *    `STATUS_COLORS.not_started`, `TIER_FEATURES.consultant_pro`);
 *  - text, not reads (`agent.scan_completed` event names, a comment in projectTypes.ts);
 *  - a library call (XLSX.utils.sheet_to_csv / sheet_to_json).
 * A file not listed must have NO snake_case reads; a listed count may never go up — a new read
 * must use the camelCase name the server actually sends. When you remove reads, lower the number
 * (the second test fails until you do, so a fixed file can't quietly regress).
 */
const BASELINE: Record<string, number> = {
  'pages/ProjectDetailPage/OverviewTab.tsx': 23, // all camelCase-first fallbacks
  'components/sprints/SprintPlanningPanel.tsx': 10, // 8 = its own create form; 2 = story_points ?? storyPoints
  'components/project/EditProjectModal.tsx': 10, // camelCase-first fallbacks
  'pages/ProjectDetailPage.tsx': 8, // camelCase-first fallbacks
  'pages/KPIDrillInPage.tsx': 5, // camelCase-first fallbacks (the overdue list sends dueDate)
  'components/pm/ActivityFeedPM.tsx': 4, // snake-first, camelCase fallback (link_type ?? linkType)
  'components/tasks/TaskListMobile.tsx': 3, // camelCase-first fallbacks
  'components/reports/ComplianceReport.tsx': 3, // local counter keyed by actor type values
  'utils/csvCleaner.ts': 2, // XLSX library calls
  'pages/ProjectsPM.tsx': 2, // snake-first, camelCase fallback
  'pages/ProjectDetailPage/schedule-tab/ScheduleWorkspace.tsx': 2, // local counter object
  'components/project/BudgetTab.tsx': 2, // camelCase-first fallbacks
  'components/intake/IntakeReviewPanel.tsx': 2, // snake-first, camelCase fallback
  'stores/aiChatStore.ts': 1, // camelCase-first fallback
  'pages/settings/WebhooksTab.tsx': 1, // event name text 'agent.scan_completed'
  'pages/UserGuidePage.tsx': 1, // event name text
  'pages/ScenarioModelingPage.tsx': 1, // camelCase-first fallback
  'pages/IntakeFormsPage.tsx': 1, // snake-first, camelCase fallback
  'pages/AccountBillingPage.tsx': 1, // local map keyed by tier VALUE
  'constants/projectTypes.ts': 1, // a comment
  'components/sprints/SprintBoard.tsx': 1, // snake-first, camelCase fallback
  'components/settings/ViewerInvitePanel.tsx': 1, // camelCase-first fallback
  'components/resources/ResourceUsageView.tsx': 1, // local style map keyed by status VALUE
  'components/project/SetupChecklist.tsx': 1, // camelCase-first fallback
  'components/project/ProjectBriefCard.tsx': 1, // camelCase-first fallback
  'components/dashboard/widgets/GoalsWidget.tsx': 1, // local style map keyed by status VALUE
};

const SRC = join(__dirname, '..', '..');
const SNAKE_READ = /[A-Za-z0-9\])]\??\.([a-z]+(?:_[a-z0-9]+)+)\b/g;

function snakeReads(file: string): string[] {
  const src = readFileSync(join(SRC, file), 'utf8');
  return [...src.matchAll(SNAKE_READ)].map(m => m[1]);
}

/** Every client source file, relative to src/ — not tests, not pages/admin (adminFieldNames.test.ts) */
function sourceFiles(dir = SRC, rel = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules' || r === 'pages/admin') continue;
      out.push(...sourceFiles(full, r));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      out.push(r);
    }
  }
  return out;
}

describe('screens read the camelCase field names the server sends (ratchet)', () => {
  const files = sourceFiles();

  it('actually scans the client source', () => {
    expect(files.length).toBeGreaterThan(300);
    expect(files).toContain('components/dashboard/widgets/ChangeRequestWidget.tsx');
  });

  it('no file has more snake_case reads than audited (unlisted files: none)', () => {
    const worse = files
      .map(f => ({ f, max: BASELINE[f] ?? 0, reads: snakeReads(f) }))
      .filter(({ reads, max }) => reads.length > max)
      .map(({ f, max, reads }) => `${f}: ${reads.length} (allowed ${max}) — ${[...new Set(reads)].join(', ')}`);
    expect(worse).toEqual([]);
  });

  it('the allowance is tight — lower a count when reads are removed', () => {
    const loose = Object.entries(BASELINE)
      .filter(([f, max]) => !files.includes(f) || snakeReads(f).length < max)
      .map(([f, max]) => `${f}: allowed ${max}, now ${files.includes(f) ? snakeReads(f).length : 'file gone'}`);
    expect(loose).toEqual([]);
  });
});
