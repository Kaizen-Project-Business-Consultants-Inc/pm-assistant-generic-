import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Anything that switches a setting on and off uses ToggleButton, so "on" looks the same everywhere
 * (filled teal + tick). Files below keep aria-pressed on purpose: tab-like groups where one choice
 * is always selected, colour pickers, or buttons that point at a row. The list only shrinks. Note: this only catches buttons that already carry aria-pressed or role="switch"; a toggle written without them is not caught.
 */
const ALLOWED = new Set([
  'components/ai/AIChatPanel.tsx', // listening state is red
  'components/dashboard/widgets/MorningBriefingWidget.tsx', // view switcher
  'components/documents/FolderPicker.tsx', // list selection
  'components/meeting/MeetingToRaidModal.tsx', // row select
  'components/pricing/PricingCards.tsx', // billing switcher
  'components/project/TimeTrackingTab.tsx', // tabs
  'components/projects/ProjectGroupManager.tsx', // colour swatches
  'components/resources/PoolSwitcher.tsx', // switcher
  'components/risks/AIScanReviewModal.tsx', // row select
  'components/risks/RaidSectionBar.tsx', // tabs
  'components/schedule/AutoReschedulePanel.tsx', // list selection
  'components/schedule/calendar/WorkingCalendarButton.tsx', // already solid when active
  'components/schedule/calendar/WorkingCalendarPanel.tsx', // day picker
  'components/schedule/review/reviewTaskPicking.tsx', // points at a row
  'components/schedule/review/ScheduleReviewPanel.tsx', // points at a row
  'components/schedule/gantt/GanttToolbar.tsx', // zoom and layout groups; red Critical path switch (red = critical bars, deliberately kept)
  'components/reports/ReportScheduleModal.tsx', // role=switch sliding switch in a form
  'pages/settings/AccessibilityTab.tsx', // role=switch sliding switches in settings
  'pages/admin/AdminAiUsagePage.tsx', // view switcher
  'pages/admin/AdminPricingPage.tsx', // sliding on/off switch (green), not a labelled button
  'pages/AiInboxPage.tsx', // view switcher (Edit first uses ToggleButton)
  'pages/ProjectDetailPage/schedule-tab/MobileScheduleView.tsx', // view switcher
  'pages/ProjectDetailPage/schedule-tab/QuickFilterPills.tsx', // already solid when active
  'pages/ProjectDetailPage/ScheduleTab.tsx', // view switcher
  'pages/ProjectDetailPage/SprintsTab.tsx', // view switcher
  'pages/ProjectsPM.tsx', // view switcher
  'pages/ResourceManagementPage.tsx', // tabs
  'pages/settings/ApiKeysTab.tsx', // scope picker
  'pages/WorkflowPage.tsx', // tabs
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== '__tests__') walk(p, out); }
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const MARK = /aria-pressed|role="switch"/;
const root = join(__dirname, '../../..');
const rel = (f: string) => relative(root, f).split('\\').join('/');

describe('toggle buttons share one look', () => {
  it('no new hand-styled aria-pressed button or switch', () => {
    const offenders = walk(root)
      .map(rel)
      .filter((r) => !r.endsWith('components/ui/ToggleButton.tsx'))
      .filter((r) => MARK.test(readFileSync(join(root, r), 'utf8')))
      .filter((r) => !ALLOWED.has(r));
    expect(offenders, 'use ToggleButton, or add the file to ALLOWED with the reason').toEqual([]);
  });

  it('every allowed file still exists and still has a toggle (the list only shrinks)', () => {
    const stale = [...ALLOWED].filter((r) => {
      try { return !MARK.test(readFileSync(join(root, r), 'utf8')); } catch { return true; }
    });
    expect(stale, 'remove these from ALLOWED').toEqual([]);
  });
});
