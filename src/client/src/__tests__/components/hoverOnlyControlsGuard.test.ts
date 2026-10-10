/**
 * Guard (audit 2 M1): a control that only appears on mouse hover (`opacity-0
 * group-hover:opacity-100`) must also appear when it gets keyboard focus — otherwise a keyboard
 * user tabs onto something invisible. Add `focus-visible:opacity-100` on the control, or
 * `focus-within:opacity-100` on a wrapper of controls. The names scanner can't see this.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import path from 'path';

const SRC = path.resolve(__dirname, '../..');

/** Files whose hover-only items are not keyboard controls, or are deferred (see each reason). */
const ALLOWED = new Map<string, string>([
  ['pages/PrelaunchLandingPage.tsx', 'decorative hover effects on marketing cards'],
  ['pages/ProjectDetailPage/OverviewTab.tsx', 'mouse-only drag handle (cards also reorder from the keyboard elsewhere); not focusable'],
  ['pages/admin/AdminUsersPage.tsx', 'decorative pencil icon next to an editable name'],
  // Schedule grid: being reworked for keyboard on another branch, and fixed in the DOM-identity
  // fixtures — deferred (audit 2 M1, listed in the report)
  ['components/schedule/gantt/GanttLeftPanelRow.tsx', 'deferred: schedule grid row actions'],
  ['components/schedule/TableView.tsx', 'deferred: schedule grid row actions'],
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : files(p);
    return p.endsWith('.tsx') ? [p] : [];
  });
}

describe('hover-only controls also show on keyboard focus', () => {
  it('no opacity-0 + group-hover:opacity-100 without a focus reveal', () => {
    const offenders: string[] = [];
    for (const file of files(SRC)) {
      const rel = path.relative(SRC, file).replace(/\\/g, '/');
      if (ALLOWED.has(rel)) continue;
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!/\bopacity-0\b/.test(line) || !/group-hover:opacity-100/.test(line)) return;
        if (/focus(-visible|-within)?:opacity-100/.test(line)) return;
        // Not a control: an icon component, a tooltip that ignores the pointer, or hidden from AT
        if (/^\s*<[A-Z]/.test(line) || /pointer-events-none|aria-hidden="true"/.test(line)) return;
        offenders.push(`${rel}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
