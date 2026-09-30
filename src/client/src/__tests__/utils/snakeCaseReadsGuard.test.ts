import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * The server camelCases every JSON API response (plugins.ts preSerialization → toCamelCaseKeys,
 * recursively, including map keys and nested JSON). Screens that read snake_case names from API
 * data get `undefined`: Goals showed every key result as a top-level objective with no due date,
 * Agent Proposals had no risk/confidence/agent/date, every portal link read "Inactive", the PM
 * activity feed showed every notification as unread with no time, the what-if history crashed on
 * Pin, and so on (fixed 2026-09-30; the admin pages have their own zero-tolerance test,
 * adminFieldNames.test.ts).
 *
 * A RATCHET, like the server's momentVsDayGuard: these files were audited one read at a time.
 * The snake_case reads that remain were verified FINE — a camelCase-first fallback
 * (`p.endDate || p.end_date`), a form object the client builds itself (GoalsPage, sprint create
 * form), a local counter object (ScheduleTab, ComplianceReport), a library call
 * (XLSX.utils.sheet_to_csv), or a snake-first read with a camelCase fallback. A count may go
 * down, never up — a new snake_case read in one of these files must read the camelCase name the
 * server actually sends. Files fixed to zero must stay at zero.
 */
const BASELINE: Record<string, number> = {
  'pages/GoalsPage.tsx': 0, // form now uses the server's camelCase names (goal create/edit/filter fixed)
  'pages/AgentProposalsPage.tsx': 0,
  'pages/ProjectDetailPage/OverviewTab.tsx': 24,
  'components/sprints/SprintPlanningPanel.tsx': 10,
  'pages/settings/AIContextTab.tsx': 0,
  'components/sprints/SprintList.tsx': 0,
  'components/intake/IntakeReviewPanel.tsx': 2,
  'components/project/EditProjectModal.tsx': 10,
  'components/pm/ActivityFeedPM.tsx': 4,
  'components/dashboard/widgets/AgentProposalsWidget.tsx': 0,
  'pages/ScenarioModelingPage.tsx': 1,
  'components/portal/PortalLinkManager.tsx': 0,
  'pages/ProjectDetailPage.tsx': 8,
  'pages/ProjectDetailPage/DocumentsTab.tsx': 0,
  'pages/IntakeFormsPage.tsx': 1,
  'pages/KPIDrillInPage.tsx': 5,
  'pages/ProjectDetailPage/SprintsTab.tsx': 0,
  'components/tasks/TaskListMobile.tsx': 3,
  'components/reports/ComplianceReport.tsx': 3,
  'utils/csvCleaner.ts': 2,
  'pages/ProjectsPM.tsx': 2,
  'pages/ProjectDetailPage/ScheduleTab.tsx': 2,
  'components/meeting/MeetingDetailPanel.tsx': 0,
  'stores/aiChatStore.ts': 1,
};

const SRC = join(__dirname, '..', '..');
const SNAKE_READ = /[A-Za-z0-9\])]\??\.([a-z]+(?:_[a-z0-9]+)+)\b/g;

function snakeReads(file: string): string[] {
  const src = readFileSync(join(SRC, file), 'utf8');
  return [...src.matchAll(SNAKE_READ)].map(m => m[1]);
}

describe('screens read the camelCase field names the server sends (ratchet)', () => {
  it('no audited file has more snake_case reads than on 2026-09-30', () => {
    const worse = Object.entries(BASELINE)
      .map(([f, max]) => ({ f, max, reads: snakeReads(f) }))
      .filter(({ reads, max }) => reads.length > max)
      .map(({ f, max, reads }) => `${f}: ${reads.length} (was ${max}) — ${[...new Set(reads)].join(', ')}`);
    expect(worse).toEqual([]);
  });
});
