// @vitest-environment happy-dom
/**
 * Code-health item 4, phase 4 batch B (2026-10-05): ScheduleGantt's task mutations / undo-redo
 * moved into schedule-tab/useScheduleMutations.ts, then ScheduleGantt itself into
 * schedule-tab/ScheduleWorkspace.tsx. Neither move may change the page, so this renders the whole
 * Schedule tab in several states and compares container.innerHTML, byte for byte, with fixtures
 * captured on origin/master c7082f09, BEFORE the moves.
 *
 * To re-capture (only ever on a commit whose DOM is known good): SCHEDULE_TAB_DOM_WRITE=1 npx vitest run scheduleTabDom
 * The happy-dom pin on line 1 makes it pass under the root config and src/client's (see domFixtures.ts).
 */
process.env.TZ = 'UTC';

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { join } from 'path';
import { expectSameDom as expectSameDomFixture } from './domFixtures';
import type { GanttTask } from '../../components/schedule/GanttChart';

// A realistic plan (same shape as ganttChartDom's): summaries, links with lag, a milestone,
// an unscheduled task, assignees, a late task and a blocked one.
const TASKS: GanttTask[] = [
  { id: 't1', name: 'Discovery', status: 'completed', priority: 'high', startDate: '2026-03-02', endDate: '2026-03-20', progressPercentage: 100, sortOrder: 10, isSummary: true },
  { id: 't2', name: 'Stakeholder interviews', status: 'completed', priority: 'medium', startDate: '2026-03-02', endDate: '2026-03-06', progressPercentage: 100, parentTaskId: 't1', assignedTo: 'r1', estimatedDays: 5, estimatedDurationHours: 40, sortOrder: 20 },
  { id: 't3', name: 'Requirements doc', status: 'in_progress', priority: 'high', startDate: '2026-03-02', endDate: '2026-03-10', progressPercentage: 40, parentTaskId: 't1', assignedTo: 'r2', sortOrder: 30,
    dependencies: [{ dependencyId: 't2', dependencyType: 'FS', lagDays: 0 }] },
  { id: 't4', name: 'Build', status: 'pending', priority: 'medium', startDate: '2026-03-23', endDate: '2026-04-24', progressPercentage: 0, sortOrder: 40, isSummary: true },
  { id: 't5', name: 'Backend', status: 'pending', priority: 'urgent', startDate: '2026-03-23', endDate: '2026-04-10', parentTaskId: 't4', assignedTo: 'r2', sortOrder: 50,
    dependencies: [{ dependencyId: 't3', dependencyType: 'FS', lagDays: 1 }], description: 'API + DB' },
  { id: 't6', name: 'Frontend', status: 'blocked', priority: 'low', startDate: '2026-03-30', endDate: '2026-04-24', parentTaskId: 't4', sortOrder: 60,
    dependencies: [{ dependencyId: 't5', dependencyType: 'SS', lagDays: 5 }] },
  { id: 't7', name: 'Go-live', status: 'pending', startDate: '2026-04-27', endDate: '2026-04-27', isMilestone: true, sortOrder: 70,
    dependencies: [{ dependencyId: 't6', dependencyType: 'FS', lagDays: 0 }] },
  { id: 't8', name: 'Unscheduled idea', status: 'pending', sortOrder: 80 },
];

const SCHEDULES = [
  { id: 's1', name: 'Website relaunch', startDate: '2026-03-02', endDate: '2026-05-01' },
  { id: 's2', name: 'Phase 2', startDate: '2026-05-04', endDate: '2026-07-01' },
];

const state = vi.hoisted(() => ({ canEdit: true, schedules: [] as unknown[] }));
const api = vi.hoisted(() => {
  const known: Record<string, (...a: unknown[]) => unknown> = {};
  return { known };
});
vi.mock('../../services/api', () => {
  // any API call the page makes that this test doesn't name answers {} (and is recorded)
  const apiService = new Proxy(api.known, {
    get(target, prop: string) {
      if (!(prop in target)) target[prop] = vi.fn(async () => ({}));
      return target[prop];
    },
  });
  return { apiService };
});

function setUpApi() {
  for (const k of Object.keys(api.known)) delete api.known[k];
  Object.assign(api.known, {
    getSchedules: vi.fn(async () => ({ schedules: state.schedules })),
    getTasks: vi.fn(async (sid: string) => ({ data: sid === 's1' ? TASKS.map(t => ({ ...t })) : [] })),
    getMyProjectRole: vi.fn(async () => ({ role: state.canEdit ? 'owner' : 'viewer', isManager: state.canEdit, canEdit: state.canEdit, canManageOwners: state.canEdit })),
    getNonWorkingDates: vi.fn(async () => ({ dates: ['2026-03-07', '2026-03-08', '2026-03-14', '2026-03-15', '2026-04-03'] })),
    getScenarios: vi.fn(async () => ({ scenarios: [{ id: 'sc1', name: 'Faster build' }] })),
    getCriticalPath: vi.fn(async () => ({ projectDuration: 41, criticalPathTaskIds: ['t2', 't3', 't5'], tasks: [{ taskId: 't6', totalFloat: 3 }] })),
    getBaselines: vi.fn(async () => ({ baselines: [{ id: 'b1', name: 'Baseline 1', createdAt: '2026-03-01', tasks: [{ taskId: 't5', startDate: '2026-03-16', endDate: '2026-04-03' }] }] })),
    getResources: vi.fn(async () => ({ resources: [
      { id: 'r1', name: 'Pat Manager', role: 'PM', userId: 'u1' },
      { id: 'r2', name: 'Sam Builder', role: 'Developer' },
    ] })),
    getGlobalResourceWorkload: vi.fn(async () => ({ workload: [] })),
    getScheduleReviewLatest: vi.fn(async () => ({
      id: 'rv1', scheduleId: 's1', score: 72, rulesVersion: '1.8', createdAt: '2026-03-11T10:00:00Z',
      findings: [
        { rule: 'R12', severity: 'high', title: 'Blocked task with successors', taskIds: ['t6'] },
        { rule: 'R3', severity: 'low', title: 'Unscheduled', taskIds: ['t8'] },
      ],
    })),
    updateTask: vi.fn(async () => ({ task: {} })),
    checkResourceLoad: vi.fn(async () => ({ resourceId: 'r2', resourceName: 'Sam Builder', overWeeks: [] })),
  });
}

import { ScheduleTab } from '../../pages/ProjectDetailPage/ScheduleTab';
import { useAuthStore } from '../../stores/authStore';

const FIXTURES = join(__dirname, '__fixtures__', 'scheduleTabDom');
const WRITE = process.env.SCHEDULE_TAB_DOM_WRITE === '1';
const expectSameDom = (name: string, html: string) => expectSameDomFixture(FIXTURES, name, html, WRITE);

let qc: QueryClient;

async function settle() {
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise(r => setTimeout(r, 0)); });
  await waitFor(() => expect(qc.isFetching()).toBe(0));
  await act(async () => { await new Promise(r => setTimeout(r, 0)); });
}

async function renderTab(url = '/project/p1?tab=schedule', props: Partial<Parameters<typeof ScheduleTab>[0]> = {}) {
  window.history.replaceState({}, '', url);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <ScheduleTab projectId="p1" projectName="Website" projectStartDate="2026-03-02" {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await settle();
  return utils;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-03-12T12:00:00Z'));
  localStorage.clear();
  state.canEdit = true;
  state.schedules = SCHEDULES;
  setUpApi();
  useAuthStore.setState({ user: { id: 'u1', username: 'pat', email: 'pat@example.com', fullName: 'Pat Manager', role: 'project_manager' } } as never);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); localStorage.clear(); window.history.replaceState({}, '', '/'); });

describe('Schedule tab DOM is byte-identical to the pre-move capture', () => {
  it('Gantt view, editor, two schedules', async () => {
    await renderTab();
    expectSameDom('gantt-editor', document.body.innerHTML);
  });

  it('Gantt view, read-only (viewer on the project)', async () => {
    state.canEdit = false;
    await renderTab();
    expectSameDom('gantt-readonly', document.body.innerHTML);
  });

  it('Table view, editor', async () => {
    localStorage.setItem('schedule-view-mode-p1', 'table');
    await renderTab();
    expectSameDom('table-editor', document.body.innerHTML);
  });

  it('Kanban view, editor', async () => {
    localStorage.setItem('schedule-view-mode-p1', 'kanban');
    await renderTab();
    expectSameDom('kanban-editor', document.body.innerHTML);
  });

  it('Calendar view, editor', async () => {
    localStorage.setItem('schedule-view-mode-p1', 'calendar');
    await renderTab();
    expectSameDom('calendar-editor', document.body.innerHTML);
  });

  it('a task link with a quick filter that hides the task clears the filters and says so', async () => {
    await renderTab('/project/p1?tab=schedule&qf=late&schedule=s1&task=t5');
    expectSameDom('task-link-filters-cleared', document.body.innerHTML);
  });

  it('dragging a bar moves it in place, saves, and shows the Undo toast', async () => {
    const { container } = await renderTab();
    const bar = Array.from(container.querySelectorAll<HTMLElement>('.group\\/bar')).find(el => el.style.cursor === 'grab')!;
    fireEvent.mouseDown(bar, { clientX: 100, clientY: 10 });
    fireEvent.mouseMove(document, { clientX: 220, clientY: 10 });
    fireEvent.mouseUp(document, { clientX: 220, clientY: 10 });
    await settle();
    expect(api.known.updateTask).toHaveBeenCalledTimes(1);
    expectSameDom('gantt-after-drag', document.body.innerHTML);
  });

  it('table view: filter bar open', async () => {
    localStorage.setItem('schedule-view-mode-p1', 'table');
    const { getAllByRole } = await renderTab();
    const filterBtn = getAllByRole('button').find(b => /filter/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || ''))!;
    fireEvent.click(filterBtn);
    await settle();
    expectSameDom('table-filters-open', document.body.innerHTML);
  });

  it('a task opened from the Gantt shows the edit form', async () => {
    const { container } = await renderTab();
    fireEvent.doubleClick(container.querySelector('[data-task-id="t5"]')!);
    await settle();
    expectSameDom('gantt-edit-modal', document.body.innerHTML);
  });

  it('no schedules yet: the empty state', async () => {
    state.schedules = [];
    await renderTab();
    expectSameDom('no-schedules', document.body.innerHTML);
  });
});
