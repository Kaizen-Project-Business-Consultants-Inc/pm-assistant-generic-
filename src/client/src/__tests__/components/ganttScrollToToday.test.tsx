// @vitest-environment happy-dom
/**
 * The Gantt scrolls to today when it opens a plan (and on a zoom change), not after every edit,
 * search keystroke or collapse (2026-10-11). It used to: the first date shown is worked out from
 * the rows, and the scroll-to-today ran whenever it was rebuilt. When the first date really moves
 * (a task now starts earlier), the scroll position moves with it so the same dates stay in view.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: () => vi.fn(async () => ({})) }),
}));

import { GanttChart, type GanttTask } from '../../components/schedule/GanttChart';
import { ZOOM_CONFIGS } from '../../components/schedule/gantt/types';

const TASKS: GanttTask[] = [
  { id: 'a', name: 'Alpha', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', sortOrder: 10 },
  { id: 'b', name: 'Bravo', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-13', sortOrder: 20 },
];

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mount(tasks: GanttTask[], scheduleId = 's-today') {
  const client = qc();
  const ui = (t: GanttTask[], sid: string) => (
    <QueryClientProvider client={client}><GanttChart tasks={t} scheduleName="Plan" scheduleId={sid} onTaskUpdate={vi.fn()} /></QueryClientProvider>
  );
  const utils = render(ui(tasks, scheduleId));
  const timeline = () => utils.container.querySelector('.flex-1.overflow-x-auto.overflow-y-auto') as HTMLElement;
  return { ...utils, timeline, update: (t: GanttTask[], sid = scheduleId) => utils.rerender(ui(t, sid)) };
}

// The test DOM does no layout: the timeline's widths are set here, and its ResizeObserver is
// fired by hand (`grow`)
const layout = { clientWidth: 800, scrollWidth: 100_000 };
let observers: Array<() => void> = [];
class FakeResizeObserver {
  private cb: () => void;
  constructor(cb: () => void) { this.cb = cb; }
  observe() { observers.push(this.cb); }
  disconnect() { observers = observers.filter(o => o !== this.cb); }
  unobserve() {}
}
const grow = () => { for (const cb of [...observers]) cb(); };

beforeEach(() => {
  localStorage.clear();
  layout.clientWidth = 800;
  layout.scrollWidth = 100_000;
  observers = [];
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => layout.clientWidth);
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(() => layout.scrollWidth);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('Gantt: scroll to today once per plan', () => {
  it('opens at today; an edit keeps the user\'s scroll position', () => {
    const { timeline, update } = mount(TASKS);
    const atToday = timeline().scrollLeft;
    expect(atToday).toBeGreaterThan(0); // the plan is in March, today is later
    timeline().scrollLeft = 120;
    update(TASKS.map(t => (t.id === 'a' ? { ...t, name: 'Alpha 2' } : t)));
    expect(timeline().scrollLeft).toBe(120);
    // a change that leaves the first date alone (a later end) keeps it too
    update(TASKS.map(t => (t.id === 'b' ? { ...t, endDate: '2026-03-20' } : t)));
    expect(timeline().scrollLeft).toBe(120);
  });

  it('a task now starting earlier: the view moves with the dates instead of jumping to today', () => {
    const { timeline, update } = mount(TASKS);
    const dayPx = ZOOM_CONFIGS.month.dayPx; // the Gantt's first zoom for a plan
    timeline().scrollLeft = 300;
    update(TASKS.map(t => (t.id === 'a' ? { ...t, startDate: '2026-02-23' } : t)));
    const moved = timeline().scrollLeft - 300;
    expect(moved).toBeCloseTo(7 * dayPx, 5);
  });

  it('another plan scrolls to today again', () => {
    const { timeline, update } = mount(TASKS);
    const atToday = timeline().scrollLeft;
    timeline().scrollLeft = 120;
    update(TASKS, 's-other');
    expect(timeline().scrollLeft).toBe(atToday);
  });
});

/**
 * Review 2026-10-11: the first run can come before the timeline has its full width (the browser
 * then keeps the scroll clamped short of today). The scroll to today is tried again as the
 * timeline grows, until it gets there — and only then counts as done, so later edits don't jump.
 */
describe('Gantt: scroll to today waits for the timeline to be wide enough', () => {
  it('not laid out yet: scrolled to today once the timeline grows; then an edit does not jump', () => {
    const full = mount(TASKS);
    const atToday = full.timeline().scrollLeft;
    expect(atToday).toBeGreaterThan(0);
    const others = observers.length; // the Gantt's other size watchers
    cleanup();
    observers = [];

    layout.scrollWidth = 0; // the first run: no width yet
    const { timeline, update } = mount(TASKS);
    timeline().scrollLeft = 0; // what the browser keeps (clamped)
    expect(observers.length).toBeGreaterThan(others); // waiting for the timeline to grow
    layout.scrollWidth = 100_000;
    grow();
    expect(timeline().scrollLeft).toBe(atToday);
    expect(observers).toHaveLength(others); // done: stops watching
    timeline().scrollLeft = 120;
    update(TASKS.map(t => (t.id === 'a' ? { ...t, name: 'Alpha 2' } : t)));
    grow();
    expect(timeline().scrollLeft).toBe(120);
  });

  it("still not wide enough: the user's own scroll ends the waiting, so it doesn't pull them back to today", () => {
    mount(TASKS);
    const others = observers.length;
    cleanup();
    observers = [];

    layout.scrollWidth = 0;
    const { timeline } = mount(TASKS);
    expect(observers.length).toBeGreaterThan(others);
    fireEvent.wheel(timeline());
    expect(observers).toHaveLength(others); // stopped watching
    timeline().scrollLeft = 40;
    grow();
    expect(timeline().scrollLeft).toBe(40);
  });
});
