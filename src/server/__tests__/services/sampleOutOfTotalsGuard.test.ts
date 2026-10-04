import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { isExamplePerson, SAMPLE_ID_PREFIX } from '../../utils/sampleData';

/**
 * Promise to the user: "While the sample is loaded it never counts: portfolio and dashboard totals,
 * budgets and earned value, capacity and workload, Team Planner, briefing, alerts and reports all
 * leave the sample out." (2026-10-03 sweep.)
 *
 * Every place below adds up across a company's projects (or people) and must keep its sample
 * exclusion — `COALESCE(p.is_demo, 0) = 0` / `is_demo = 1` in SQL, `isDemo` in JS, or
 * `isExamplePerson` for the sample's example people. `min` is how many exclusions the file had
 * when it was fixed: dropping one fails here. Project LISTS deliberately still include the sample
 * (it must stay openable) — they are not on this list.
 */
const SERVER = join(__dirname, '..', '..');
const EXCLUSION = /is_demo|isDemo|isExamplePerson|NOT_SAMPLE|demo-%/g;

const AGGREGATES: Array<{ file: string; min: number; what: string }> = [
  // already excluding before the sweep
  { file: 'database/ResourceRepository.ts', min: 2, what: 'workload / histogram / forecast bookings' },
  { file: 'services/TeamPlannerService.ts', min: 2, what: 'Team Planner' },
  { file: 'services/NotificationService.ts', min: 1, what: 'notifications' },
  { file: 'services/proactiveAlertService.ts', min: 1, what: 'proactive alerts' },
  // fixed 2026-10-03
  { file: 'services/DailyBriefingService.ts', min: 20, what: 'Morning Briefing (every section)' },
  { file: 'routes/reporting/dashboardData.ts', min: 7, what: 'dashboard widgets' },
  { file: 'routes/reporting/portfolio.ts', min: 3, what: 'portfolio overview, resources, analytics (EVM/budget)' },
  { file: 'services/AnalyticsSummaryService.ts', min: 3, what: 'dashboard tiles / analytics summary' },
  { file: 'services/ReportBuilderService.ts', min: 4, what: 'report builder + scheduled reports' },
  { file: 'services/aiContextBuilder.ts', min: 1, what: 'portfolio context (AI dashboard, anomalies, cross-project)' },
  { file: 'services/aiActionExecutor.ts', min: 5, what: 'Mjuzi portfolio summary / overdue / high-risk tools' },
  { file: 'services/NLQueryService.ts', min: 2, what: 'NL query portfolio stats' },
  { file: 'services/NarrativeService.ts', min: 1, what: 'portfolio narrative' },
  { file: 'services/predictiveIntelligence.ts', min: 1, what: 'AI dashboard weather pick' },
  { file: 'services/scheduling/scanOrchestrator.ts', min: 1, what: 'agent scans' },
  { file: 'services/scheduling/weeklyReviewPackJob.ts', min: 1, what: 'weekly review pack' },
  { file: 'services/TaskAssignmentService.ts', min: 1, what: 'project allocations for all people' },
  { file: 'services/ResourceOptimizerService.ts', min: 2, what: 'bottleneck forecast / skill match (example people)' },
  { file: 'routes/resources/resources.ts', min: 1, what: 'capacity by role (example people)' },
  { file: 'database/ProjectRepository.ts', min: 1, what: 'trial project count' },
];

describe('the sample project never counts in totals (guard)', () => {
  for (const { file, min, what } of AGGREGATES) {
    it(`${file} keeps its sample exclusion — ${what}`, () => {
      const src = readFileSync(join(SERVER, file), 'utf8');
      expect((src.match(EXCLUSION) ?? []).length).toBeGreaterThanOrEqual(min);
    });
  }

  it('every Morning Briefing and dashboard-widget section joins projects without the sample', () => {
    for (const file of ['services/DailyBriefingService.ts', 'routes/reporting/dashboardData.ts']) {
      const joins = readFileSync(join(SERVER, file), 'utf8').split('\n').filter((l) => /JOIN projects p ON/.test(l));
      expect(joins.length).toBeGreaterThan(0);
      expect(joins.filter((l) => !l.includes('COALESCE(p.is_demo, 0) = 0'))).toEqual([]);
    }
  });

  it('the trial project limit does not count the sample', () => {
    const src = readFileSync(join(SERVER, 'database/ProjectRepository.ts'), 'utf8');
    const count = src.slice(src.indexOf('async countByUser'), src.indexOf('async findByUserIdPaginated'));
    expect(count).toContain('COALESCE(p.is_demo, 0) = 0');
    expect(count).not.toContain('OR p.is_demo = 1');
  });
});

describe('isExamplePerson', () => {
  it("is true only for the sample's seeded people", () => {
    expect(SAMPLE_ID_PREFIX).toBe('demo-');
    expect(isExamplePerson({ id: 'demo-res-1' })).toBe(true);
    expect(isExamplePerson({ id: '3f2a-uuid' })).toBe(false);
    expect(isExamplePerson({ id: 'res-demo-1' })).toBe(false);
  });
});
