// @vitest-environment happy-dom
/**
 * The Gantt's and the Table's own bulk message ("Updated 2 tasks", "Some updates failed") clears
 * itself after 3 s. That timer used to outlive the view and set state after it was gone; it is
 * now cleared on unmount (useUnmountSafeTimeouts, 2026-10-05); the delay is still 3 s.
 */
process.env.TZ = 'UTC';

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: () => vi.fn(async () => ({})) }),
}));

// The Table's assignee picker, reduced to one "pick" button (the real one loads people)
vi.mock('../../components/schedule/ResourcePickerDropdown', () => ({
  ResourcePickerDropdown: ({ onSelect }: { onSelect: (id: string, name: string) => void }) => (
    <button type="button" onClick={() => onSelect('r9', 'Sam')}>pick</button>
  ),
}));

import { GanttChart, type GanttTask } from '../../components/schedule/GanttChart';
import { TableView } from '../../components/schedule/TableView';
import { useColumnState } from '../../hooks/useColumnState';

const TASKS: GanttTask[] = [
  { id: 'a', name: 'Plan', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', sortOrder: 10 },
  { id: 'b', name: 'Build', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-13', sortOrder: 20 },
];

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

function Table({ onBulkUpdate }: { onBulkUpdate: (ids: string[], f: string, v: string) => Promise<void> }) {
  const columnState = useColumnState('s-bulk-timer');
  return <TableView tasks={TASKS} scheduleId="s-bulk-timer" onTaskClick={() => {}} columnState={columnState} onBulkUpdate={onBulkUpdate} onTaskUpdate={() => {}} />;
}

/** Watch every 3 s timer: which were started, which were cleared */
function watchTimers() {
  const started = new Set<unknown>();
  const cleared = new Set<unknown>();
  const realSet = globalThis.setTimeout;
  const realClear = globalThis.clearTimeout;
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
    const id = realSet(fn, ms, ...rest);
    if (ms === 3000) started.add(id);
    return id;
  }) as typeof setTimeout);
  vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((id?: ReturnType<typeof setTimeout>) => {
    cleared.add(id);
    return realClear(id);
  }) as typeof clearTimeout);
  return { started, cleared };
}

async function bulkSetStatus(container: HTMLElement) {
  const all = container.querySelector('input[aria-label="Select all tasks"]') ?? container.querySelector('thead input[type="checkbox"]');
  expect(all).not.toBeNull();
  fireEvent.click(all!);
  const select = Array.from(container.querySelectorAll('select')).find(s => s.querySelector('option')?.textContent === 'Status...');
  expect(select).toBeDefined();
  fireEvent.change(select!, { target: { value: 'completed' } });
  const apply = Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'Apply');
  expect(apply).toBeDefined();
  await act(async () => { fireEvent.click(apply!); });
}

describe.each([
  ['Gantt', (onBulkUpdate: (ids: string[], f: string, v: string) => Promise<void>) =>
    <GanttChart tasks={TASKS} scheduleName="Plan" scheduleId="s1" onBulkUpdate={onBulkUpdate} onTaskUpdate={() => {}} />],
  ['Table', (onBulkUpdate: (ids: string[], f: string, v: string) => Promise<void>) => <Table onBulkUpdate={onBulkUpdate} />],
])('%s bulk message', (_name, view) => {
  it.each([
    ['success', async () => {}, /Updated 2 tasks/],
    ['failure', async () => { throw new Error('x'); }, /Some updates failed/],
  ])('%s: shown with its 3 s timer, and that timer is cleared on unmount', async (_k, impl, text) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const t = watchTimers();
    const { container, unmount } = render(wrap(view(vi.fn(impl))));
    await bulkSetStatus(container);
    await waitFor(() => expect(container.textContent).toMatch(text));
    expect(t.started.size).toBeGreaterThan(0);
    unmount();
    for (const id of t.started) expect(t.cleared.has(id)).toBe(true);
  });
});

describe('Table assignee picker: the "saved" tick waits for the save', () => {
  function AssigneeTable({ onTaskUpdate }: { onTaskUpdate: (id: string, d: Record<string, unknown>) => Promise<boolean> }) {
    const columnState = useColumnState('s-assignee');
    const tasks = TASKS.map(t => ({ ...t, assignedTo: t.id === 'a' ? 'Pat' : undefined }));
    return <TableView tasks={tasks} scheduleId="s-assignee" onTaskClick={() => {}} columnState={columnState} onTaskUpdate={onTaskUpdate} />;
  }
  const tick = (td: Element) => td.querySelector('.text-green-600');

  it.each([[true, 'shows'], [false, 'does not show']])('a save that comes back %s %s the tick', async (ok) => {
    const update = vi.fn(async () => ok);
    const { container } = render(wrap(<AssigneeTable onTaskUpdate={update} />));
    const cell = Array.from(container.querySelectorAll('td')).find(td => td.textContent === 'Pat')!;
    expect(cell).toBeDefined();
    fireEvent.click(cell);
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(b => b.textContent === 'pick')!);
    expect(update).toHaveBeenCalledWith('a', { assignedTo: 'r9' });
    await act(async () => { await new Promise(r => setTimeout(r, 400)); });
    if (ok) expect(tick(cell)).not.toBeNull();
    else expect(tick(cell)).toBeNull();
  });
});
