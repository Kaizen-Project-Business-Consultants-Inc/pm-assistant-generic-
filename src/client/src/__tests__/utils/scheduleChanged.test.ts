import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import {
  refreshAfterScheduleChange, refreshAfterPlansChange, projectOfSchedule, seedIfOlder, SCHEDULE_DERIVED_KEYS, PROJECT_DERIVED_KEYS,
} from '../../utils/scheduleChanged';

/**
 * U38 (2026-10-18): after Apply in Propose fixes the links were saved, but the schedule didn't
 * show them and the critical path still said "link your tasks first" — Apply refreshed only the
 * task list and the review, and the app never refetches on mount.
 */
describe('refreshAfterScheduleChange', () => {
  const client = () => new QueryClient({ defaultOptions: { queries: { staleTime: 600_000, refetchOnMount: false, retry: false } } });
  const watch = async (qc: QueryClient, queryKey: unknown[]) => {
    let fetches = 0;
    const unsubscribe = new QueryObserver(qc, { queryKey, queryFn: async () => ++fetches }).subscribe(() => {});
    await vi.waitFor(() => expect(qc.getQueryData(queryKey)).toBe(1)); // first load finished
    return { unsubscribe, fetches: () => fetches };
  };

  it('refetches the views on screen, drops the others, leaves other plans and projects alone', async () => {
    const qc = client();
    const onScreen = await watch(qc, ['criticalPath', 's1']);
    qc.setQueryData(['tasks', 's1'], ['t1']);
    qc.setQueryData(['tasks', 's1', 'overview'], ['t1']);
    qc.setQueryData(['network-diagram', 's1'], {});
    qc.setQueryData(['epic-children', 's1', 'e1'], {});
    qc.setQueryData(['sCurve', 'p1'], {});
    qc.setQueryData(['resource-usage', 'p1'], {});
    qc.setQueryData(['project-summary', 'p1'], {});
    qc.setQueryData(['tasks', 's2'], ['other plan']);
    qc.setQueryData(['sCurve', 'p2'], { other: 'project' });
    qc.setQueryData(['evmForecastAI', 'p1'], { ai: true });

    refreshAfterScheduleChange(qc, { scheduleId: 's1', projectId: 'p1' });

    await vi.waitFor(() => expect(qc.getQueryData(['criticalPath', 's1'])).toBe(2));
    for (const key of [['tasks', 's1'], ['tasks', 's1', 'overview'], ['network-diagram', 's1'], ['epic-children', 's1', 'e1'], ['sCurve', 'p1'], ['resource-usage', 'p1'], ['project-summary', 'p1']]) {
      expect(qc.getQueryData(key)).toBeUndefined();
    }
    expect(qc.getQueryData(['tasks', 's2'])).toEqual(['other plan']);
    expect(qc.getQueryData(['sCurve', 'p2'])).toEqual({ other: 'project' });
    // fetching the AI forecast again costs an AI call
    expect(qc.getQueryData(['evmForecastAI', 'p1'])).toEqual({ ai: true });
    onScreen.unsubscribe();
  });

  it('never downloads the project summary again: on screen it is only marked out of date', async () => {
    const qc = client();
    const summary = await watch(qc, ['project-summary', 'p1']);
    refreshAfterScheduleChange(qc, { scheduleId: 's1', projectId: 'p1' });
    await new Promise(r => { setTimeout(r, 20); });
    expect(summary.fetches()).toBe(1);
    expect(qc.getQueryState(['project-summary', 'p1'])?.isInvalidated).toBe(true);
    summary.unsubscribe();
  });

  it('without a project, only the plan is refreshed', () => {
    const qc = client();
    qc.setQueryData(['criticalPath', 's1'], {});
    qc.setQueryData(['evm', 'p1'], { kept: true });
    refreshAfterScheduleChange(qc, { scheduleId: 's1', projectId: undefined });
    expect(qc.getQueryData(['criticalPath', 's1'])).toBeUndefined();
    expect(qc.getQueryData(['evm', 'p1'])).toEqual({ kept: true });
  });

  it('covers every view worked out from the plan', () => {
    for (const k of ['tasks', 'criticalPath', 'network-diagram', 'burndown', 'histogram', 'schedule-review', 'schedule-changes', 'baselineComparison', 'scenarios', 'epic-children']) {
      expect(SCHEDULE_DERIVED_KEYS).toContain(k);
    }
    for (const k of ['project-summary', 'schedules', 'evm', 'sCurve', 'workload', 'resource-usage', 'resource-forecast', 'health-history']) {
      expect(PROJECT_DERIVED_KEYS).toContain(k);
    }
  });
});

describe('refreshAfterPlansChange', () => {
  const client = () => new QueryClient({ defaultOptions: { queries: { staleTime: 600_000, refetchOnMount: false, retry: false } } });

  it("a project's calendar: every plan of that project, not other projects' plans", () => {
    const qc = client();
    qc.setQueryData(['schedules', 'p1'], { schedules: [{ id: 's1' }, { id: 's2' }] });
    qc.setQueryData(['tasks', 's1'], []);
    qc.setQueryData(['criticalPath', 's2'], {});
    qc.setQueryData(['tasks', 's9'], ['other project']);
    refreshAfterPlansChange(qc, { projectId: 'p1' });
    expect(qc.getQueryData(['tasks', 's1'])).toBeUndefined();
    expect(qc.getQueryData(['criticalPath', 's2'])).toBeUndefined();
    expect(qc.getQueryData(['tasks', 's9'])).toEqual(['other project']);
  });

  it('a company holiday: every plan and project', () => {
    const qc = client();
    qc.setQueryData(['tasks', 's9'], []);
    qc.setQueryData(['evm', 'p9'], {});
    refreshAfterPlansChange(qc, { projectId: undefined });
    expect(qc.getQueryData(['tasks', 's9'])).toBeUndefined();
    expect(qc.getQueryData(['evm', 'p9'])).toBeUndefined();
  });
});

describe('seedIfOlder (the project page summary)', () => {
  it('fills an empty key, and an older one, but never overwrites a newer edit', () => {
    const qc = new QueryClient();
    seedIfOlder(qc, ['tasks', 's1'], ['from summary'], 1000);
    expect(qc.getQueryData(['tasks', 's1'])).toEqual(['from summary']);
    expect(qc.getQueryState(['tasks', 's1'])?.dataUpdatedAt).toBe(1000);
    qc.setQueryData(['tasks', 's1'], ['newer edit'], { updatedAt: 2000 });
    seedIfOlder(qc, ['tasks', 's1'], ['old summary'], 1000);
    expect(qc.getQueryData(['tasks', 's1'])).toEqual(['newer edit']);
    seedIfOlder(qc, ['tasks', 's1'], ['newer summary'], 3000);
    expect(qc.getQueryData(['tasks', 's1'])).toEqual(['newer summary']);
  });
});

describe('projectOfSchedule', () => {
  it('finds the project that owns a plan from the cached plan lists', () => {
    const qc = new QueryClient();
    qc.setQueryData(['schedules', 'p1'], { schedules: [{ id: 's1' }] });
    qc.setQueryData(['schedules', 'p2'], { schedules: [{ id: 's2' }] });
    expect(projectOfSchedule(qc, 's2')).toBe('p2');
    expect(projectOfSchedule(qc, 'nope')).toBeUndefined();
  });
});

describe('guard: whole-plan changes refresh the plan', () => {
  it('every call that changes a whole plan is followed by the refresh, right where it is made', () => {
    const root = join(__dirname, '../..');
    // Propose fixes Apply/Undo, History undo, imports, Auto-reschedule, levelling, replacing a
    // person, bulk links, grouping, bulk delete, promoting a scenario, working calendar, company
    // and client holidays, Team Planner moves, meeting changes, and Mjuzi's link/date tools
    const changes = new RegExp(
      "apiService\\.(applyScheduleFixes|undoScheduleFixProposal|undoScheduleChange|importStructured|importTasks|acceptRescheduleProposal"
      + "|applyResourceLeveling|replaceResource|bulkLinkTasks|groupTasks|bulkDeleteTasks|promoteScenario|applyWorkingCalendar"
      + "|applyCompanyHoliday|changeClientCalendar|plannerMove|applyMeetingChanges)\\("
      + "|'(clear_all_dependencies|set_dependency|remove_dependency|cascade_reschedule)'",
      'g',
    );
    // a brand-new plan made with the project: nothing of it is cached yet, and the page opens fresh;
    // Mjuzi's reply view only names the tools to word what was done (the chat store refreshes, U57)
    const exempt = new Set(['components/templates/TemplatePicker.tsx', 'components/ai/ActionOutcome.tsx']);
    const WINDOW = 20; // the refresh must come at most this many lines after the call
    const missing: string[] = [];
    const check = (rel: string, src: string) => {
      // local names for the refresh, e.g. `const planChanged = useCallback(() => refreshAfterScheduleChange(`
      const aliases = [...src.matchAll(/const (\w+) = (?:useCallback\(\s*)?\(\) => refreshAfter(?:Schedule|Plans)Change\(/g)].map(m => m[1]);
      const refreshCall = new RegExp(`\\b(?:${['refreshAfterScheduleChange', 'refreshAfterPlansChange', ...aliases].join('|')})\\(`);
      const lines = src.split('\n');
      for (const m of src.matchAll(changes)) {
        const line = src.slice(0, m.index).split('\n').length - 1;
        if (!refreshCall.test(lines.slice(line, line + WINDOW + 1).join('\n'))) missing.push(`${rel}:${line + 1} ${m[0]}`);
      }
    };
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          if (name !== '__tests__' && name !== 'apiAreas') walk(path);
        } else if (/\.tsx?$/.test(name)) {
          const rel = relative(root, path).split('\\').join('/');
          if (!exempt.has(rel)) check(rel, readFileSync(path, 'utf8'));
        }
      }
    };
    walk(root);
    expect(missing).toEqual([]);
  });
});
