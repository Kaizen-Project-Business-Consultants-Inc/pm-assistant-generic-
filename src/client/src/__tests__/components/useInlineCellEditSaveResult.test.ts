/**
 * useInlineCellEdit when the save says whether it worked (2026-10-05): the Schedule tab's
 * onTaskUpdate returns a promise of "saved?". The green "saved" flash and the "<field> saved"
 * read-out must wait for it, and must not appear at all when the save failed. An onTaskUpdate
 * that returns nothing keeps the old plain 300 ms timer (pinned by useInlineCellEdit.test.ts).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { announce } from '../../utils/announce';
import { useInlineCellEdit, TABLE_EDIT_RULES, GANTT_EDIT_RULES } from '../../components/schedule/shared/hooks/useInlineCellEdit';
import type { GanttTask } from '../../components/schedule/gantt/types';

const TASKS: GanttTask[] = [
  { id: 'a', name: 'A', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', sortOrder: 10 },
  { id: 'b', name: 'B', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-13', sortOrder: 20 },
];
const fieldValue = (t: GanttTask, f: string) => String((t as any)[f] ?? '');

function setup(onTaskUpdate: (id: string, d: Record<string, unknown>) => Promise<boolean>, rules = TABLE_EDIT_RULES) {
  return renderHook(() => useInlineCellEdit<string>({
    tasks: TASKS, onTaskUpdate, getTaskFieldValue: fieldValue, rowNumToTaskId: new Map([[1, 'a'], [2, 'b']]), rules,
  }));
}

beforeEach(() => { vi.useFakeTimers(); vi.mocked(announce).mockClear(); });
afterEach(() => { vi.useRealTimers(); });

/** A save the test settles by hand */
function deferred() {
  let settle!: (ok: boolean) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<boolean>((res, rej) => { settle = res; fail = rej; });
  return { promise, settle, fail };
}

describe('the "saved" flash waits for the save', () => {
  it.each([['Table', TABLE_EDIT_RULES], ['Gantt', GANTT_EDIT_RULES]])('%s: a save that comes back true flashes "saved" only then', async (_n, rules) => {
    const d = deferred();
    const { result } = setup(vi.fn(() => d.promise), rules);
    act(() => { result.current.saveEdit('a', 'name', 'A2'); });
    expect(result.current.savingCell).toEqual({ taskId: 'a', field: 'name' });
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(result.current.savedCell).toBe(null); // still saving: no "saved" yet
    expect(result.current.savingCell).toEqual({ taskId: 'a', field: 'name' });
    await act(async () => { d.settle(true); });
    expect(result.current.savingCell).toBe(null);
    expect(result.current.savedCell).toEqual({ taskId: 'a', field: 'name' });
    expect(announce).toHaveBeenCalledWith('name saved');
    await act(async () => { vi.advanceTimersByTime(1200); });
    expect(result.current.savedCell).toBe(null);
  });

  it('a fast save still shows "saving" for 300 ms first', async () => {
    const { result } = setup(vi.fn(() => Promise.resolve(true)));
    act(() => { result.current.saveEdit('a', 'name', 'A2'); });
    await act(async () => { vi.advanceTimersByTime(299); });
    expect(result.current.savedCell).toBe(null);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(result.current.savedCell).toEqual({ taskId: 'a', field: 'name' });
  });

  it.each([['resolves false', (d: ReturnType<typeof deferred>) => d.settle(false)], ['rejects', (d: ReturnType<typeof deferred>) => d.fail(new Error('x'))]])(
    'a save that %s never says "saved"', async (_n, finish) => {
      const d = deferred();
      const { result } = setup(vi.fn(() => d.promise));
      act(() => { result.current.saveEdit('a', 'status', 'done'); });
      await act(async () => { vi.advanceTimersByTime(300); finish(d); });
      await act(async () => { vi.advanceTimersByTime(2000); });
      expect(result.current.savingCell).toBe(null);
      expect(result.current.savedCell).toBe(null);
      expect(announce).not.toHaveBeenCalled();
    });

  it('a failed save does not stop another cell\'s "saving"', async () => {
    const first = deferred();
    const second = deferred();
    const update = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = setup(update);
    act(() => { result.current.saveEdit('a', 'name', 'A2'); });
    act(() => { result.current.saveEdit('b', 'name', 'B2'); });
    await act(async () => { vi.advanceTimersByTime(300); first.settle(false); });
    expect(result.current.savingCell).toEqual({ taskId: 'b', field: 'name' });
    await act(async () => { second.settle(true); });
    expect(result.current.savedCell).toEqual({ taskId: 'b', field: 'name' });
  });

  it('duration and predecessor edits wait too (no read-out, as before)', async () => {
    const d = deferred();
    const { result } = setup(vi.fn(() => d.promise));
    act(() => { result.current.saveEdit('b', 'dependency', '1'); });
    await act(async () => { vi.advanceTimersByTime(300); d.settle(false); });
    expect(result.current.savedCell).toBe(null);
    expect(result.current.depError).toBe(null);
  });
});

describe('timers after unmount (2026-10-05)', () => {
  it('a save handed off just before the grid goes away leaves no timer and flashes nothing', async () => {
    const onTaskUpdate = vi.fn(() => undefined as unknown as Promise<boolean>); // a plain void save
    const { result, unmount } = renderHook(() => useInlineCellEdit<string>({
      tasks: TASKS, onTaskUpdate, getTaskFieldValue: fieldValue, rowNumToTaskId: new Map(), rules: TABLE_EDIT_RULES,
    }));
    act(() => { result.current.saveEdit('a', 'name', 'A2'); });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(announce).not.toHaveBeenCalled();
  });

  it('a save still on its way when the grid goes away: no flash when it comes back', async () => {
    const d = deferred();
    const { result, unmount } = setup(vi.fn(() => d.promise));
    act(() => { result.current.saveEdit('a', 'name', 'A2'); });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => { d.settle(true); vi.advanceTimersByTime(5000); });
    expect(announce).not.toHaveBeenCalled();
  });
});
