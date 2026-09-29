import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Task dates count WORKING days from the project calendar (user rule, 2026-09-29):
 * weekends and holidays are off unless the calendar marks a day as working. Moving a
 * date by "+ 86 400 000 ms" or "setDate(+n)" counts calendar days and silently puts
 * tasks on weekends — which is how most of the app worked until then.
 *
 * This is a ratchet. The files below still do calendar-day arithmetic (much of it is
 * legitimate: report windows, token expiry, "last 7 days" queries). A file may lose
 * entries, never gain them, and no new file may start. When you fix one, lower or
 * remove its number here. For task dates use utils/workingDays.ts (shiftWorking,
 * finishFor, onOrAfterWorking) with scheduleService.workingDayTest(scheduleId).
 * If a new use really is a calendar-day window (not a task date), add it here with a
 * one-line reason in the commit.
 */
const BASELINE: Record<string, number> = {
  "routes/admin/admin.ts": 1,
  "routes/admin/revenue.ts": 1,
  "routes/collaboration/portal.ts": 3,
  "routes/collaboration/workflows.ts": 6,
  "routes/core/exports.ts": 3,
  "routes/integrations/apiKeys.ts": 3,
  "routes/reporting/dashboardData.ts": 4,
  "routes/reporting/reportBuilder.ts": 6,
  "routes/resources/resources.ts": 3,
  "routes/resources/timeEntries.ts": 4,
  "routes/scheduling/monteCarlo.ts": 1,
  "services/aiContextBuilder.ts": 3,
  "services/AnalyticsSummaryService.ts": 2,
  "services/BurndownService.ts": 2,
  "services/dataProviders/weatherProviders.ts": 1,
  "services/FlowMetricsService.ts": 1,
  "services/InstantReportService.ts": 3,
  "services/integrations/GoogleCalendarAdapter.ts": 1,
  "services/lessonsLearned/index.ts": 1,
  "services/predictiveIntelligence.ts": 1,
  "services/ProjectStatusReportService.ts": 2,
  "services/RAIDReportService.ts": 1,
  "services/ReportScheduleService.ts": 4,
  "services/ResourceAvailabilityService.ts": 2,
  "services/ResourceLevelingService.ts": 1,
  "services/ResourceService.ts": 7,
  "services/ScheduleRecomputeService.ts": 1,
  "services/scheduleReview/rules.ts": 1,
  "services/ScheduleService.ts": 2,
  "services/scheduling/utilizationCoachingJob.ts": 3,
  "services/scheduling/weeklyReviewPackJob.ts": 1,
  "services/SCurveService.ts": 1,
  "services/SprintService.ts": 1,
  "services/StrategicRiskAnalysisService.ts": 3,
  "services/TimeAnomalyService.ts": 3,
  "services/TimeEntryService.ts": 2,
  "utils/constants.ts": 1,
  "utils/importHeuristics.ts": 1
};

const PATTERN = /86_?400_?000|\.set(?:UTC)?Date\(/g;

function counts(): Record<string, number> {
  const root = path.join(__dirname, '../..');
  const out: Record<string, number> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(full); continue; }
      if (!/\.ts$/.test(e.name) || /\.(test|spec)\.ts$/.test(e.name)) continue;
      const code = fs.readFileSync(full, 'utf-8').split('\n')
        .filter((l) => { const t = l.trimStart(); return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*'); })
        .join('\n');
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (/^utils\/(workingDays|calendarDate)\.ts$/.test(rel)) continue;
      const n = (code.match(PATTERN) || []).length;
      if (n) out[rel] = n;
    }
  };
  walk(root);
  return out;
}

describe('working-day guard (server)', () => {
  it('no file adds calendar-day date arithmetic', () => {
    const now = counts();
    const grew = Object.entries(now)
      .filter(([file, n]) => n > (BASELINE[file] ?? 0))
      .map(([file, n]) => `${file}: ${BASELINE[file] ?? 0} → ${n}`);
    expect(grew, 'Use utils/workingDays.ts for task dates (see this test file)').toEqual([]);
  });
});
