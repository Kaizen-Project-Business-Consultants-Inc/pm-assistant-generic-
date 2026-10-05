import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Legibility guard (Sep 2026, after "I am concerned about the fonts"): readable text is
 * never smaller than 12px (Tailwind text-xs). Only fixed-size spots — initials in small
 * avatars, count badges in 16–20px circles, dense heatmap cells — may use 10–11px, and
 * nothing may go below 10px. Dark-mode secondary text uses gray-400, not gray-500 (3.2:1).
 */
const SRC = join(__dirname, '..', '..');
const SMALL_OK = new Set([
  'components/ui/Avatar.tsx', 'pages/ProjectDetailPage/RAIDTab.tsx', 'pages/ProjectDetailPage/schedule-tab/ScheduleToolbar.tsx',
  'components/dashboard/CustomizeDropdown.tsx', 'components/schedule/gantt/GanttTimelinePanel.tsx', 'components/sprints/StandupLogPanel.tsx',
  'components/project/ResourcesTab.tsx', 'components/resources/RoleCapacityView.tsx', 'components/resources/WorkloadHeatmap.tsx',
  'components/resources/AvailabilityCalendar.tsx', 'components/timetracking/UtilizationHeatmap.tsx',
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return n === '__tests__' ? [] : files(p);
    return /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe('type scale guard', () => {
  const all = files(SRC).map(f => ({ rel: relative(SRC, f).split('\\').join('/'), text: readFileSync(f, 'utf-8') }));

  it('never below 10px anywhere', () => {
    const bad = all.filter(f => /text-\[(?:[0-9]|[0-9]\.[0-9]+)px\]/.test(f.text)).map(f => f.rel);
    expect(bad).toEqual([]);
  });

  it('10–11px only in fixed-size spots', () => {
    const bad = all.filter(f => /text-\[1[01](?:\.[0-9]+)?px\]/.test(f.text) && !SMALL_OK.has(f.rel)).map(f => f.rel);
    expect(bad).toEqual([]);
  });

  it('dark-mode secondary text is readable (no dark:text-gray-500)', () => {
    expect(all.filter(f => /dark:text-gray-500\b/.test(f.text)).map(f => f.rel)).toEqual([]);
  });
});
