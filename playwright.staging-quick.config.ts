import { defineConfig } from '@playwright/test';
import full from './playwright.staging-full.config';

/**
 * QUICK staging check (~2–3 min) — run after EVERY staging deploy (user decision, 2026-10-07).
 * Everything in the full suite except the two heavy schedule files (schedule-behaviour: 32 tests,
 * a 300-task plan, ~3 min; gantt-columns: ~35 s). pre-launch still opens the Gantt, Table and
 * every main tab.
 *
 * The FULL suite (playwright.staging-full.config.ts, ~10 min) is still required:
 *   - before EVERY prod release, and
 *   - on staging whenever a change touches the schedule screens (Gantt, Table, Kanban, their hooks).
 *
 * Usage: npx playwright test --config playwright.staging-quick.config.ts
 */
const HEAVY = ['schedule-behaviour.spec.ts', 'gantt-columns.spec.ts'];

export default defineConfig({
  ...full,
  testMatch: (full.testMatch as string[]).filter(f => !HEAVY.includes(f)),
});
