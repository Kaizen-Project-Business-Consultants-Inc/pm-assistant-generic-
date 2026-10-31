/**
 * Indent / outdent in the right-click menus (Gantt and Table), the "nothing to move" notice and the
 * Gantt selection line (2026-10-30). The menus are real menus (role=menu / menuitem) with the keyboard
 * on them; Outdent / Indent show only when they would do something.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, renderHook, act } from '@testing-library/react';
import { GanttContextMenu } from '../../components/schedule/gantt/GanttContextMenu';
import { TableContextMenu } from '../../components/schedule/table/TableContextMenu';
import { useIndentTasks, IndentNotice } from '../../components/schedule/shared/hooks/useIndentTasks';
import type { GanttTask } from '../../components/schedule/gantt/types';

const t = (id: string, name: string, parentTaskId?: string): GanttTask =>
  ({ id, name, status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', parentTaskId } as GanttTask);
const TASKS = [t('p', 'Phase'), t('a', 'A', 'p'), t('b', 'B')];

function gantt(indentItems?: { outdent: boolean; indent: boolean }) {
  const onIndent = vi.fn();
  const onClose = vi.fn();
  render(
    <GanttContextMenu
      contextMenu={{ x: 1, y: 1, task: TASKS[1], rowIdx: 1 }} selectedIds={new Set()} someSelected={false}
      onInsertAfter={vi.fn()} onTaskClick={vi.fn()} onDeleteTask={vi.fn()}
      indentItems={indentItems} onIndent={indentItems ? onIndent : undefined}
      onClose={onClose} setPendingDeleteIds={vi.fn()}
    />,
  );
  return { onIndent, onClose };
}

describe('Gantt right-click menu', () => {
  it('is a menu of menuitems, with the focus on the first item', () => {
    gantt({ outdent: true, indent: true });
    expect(screen.getByRole('menu', { name: 'Row menu' })).toBeTruthy();
    const items = screen.getAllByRole('menuitem');
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(document.activeElement).toBe(items[0]);
  });

  it('shows Outdent and Indent when both apply, and hands the choice on and closes', () => {
    const { onIndent, onClose } = gantt({ outdent: true, indent: true });
    fireEvent.click(screen.getByRole('menuitem', { name: /Outdent/ }));
    expect(onIndent).toHaveBeenLastCalledWith('outdent');
    expect(onClose).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', { name: /Indent/ }));
    expect(onIndent).toHaveBeenLastCalledWith('indent');
  });

  it('hides the one that would do nothing', () => {
    gantt({ outdent: false, indent: true });
    expect(screen.queryByRole('menuitem', { name: /Outdent/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /Indent/ })).toBeTruthy();
  });

  it('shows neither in a read-only plan', () => {
    gantt(undefined);
    expect(screen.queryByRole('menuitem', { name: /ndent/ })).toBeNull();
  });

  it('arrow keys move between the items; Tab closes the menu', () => {
    const { onClose } = gantt({ outdent: true, indent: true });
    const items = screen.getAllByRole('menuitem');
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(menu, { key: 'End' });
    expect(document.activeElement).toBe(items[items.length - 1]);
    fireEvent.keyDown(menu, { key: 'Tab' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Table right-click menu', () => {
  function table(indentItems: { outdent: boolean; indent: boolean }) {
    const onIndent = vi.fn();
    render(
      <TableContextMenu
        x={1} y={1} task={TASKS[1]} selectedIds={new Set()} onTaskClick={vi.fn()}
        indentItems={indentItems} onIndent={onIndent} onDelete={vi.fn()} onClose={vi.fn()}
      />,
    );
    return onIndent;
  }

  it('shows the items that apply and hands the choice on', () => {
    const onIndent = table({ outdent: true, indent: false });
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Indent/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: /Outdent/ }));
    expect(onIndent).toHaveBeenCalledWith('outdent');
  });
});

describe('useIndentTasks + IndentNotice', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('moves: hands the plan and its message to the page, no notice', () => {
    const onMoveTasks = vi.fn(async () => {});
    const { result } = renderHook(() => useIndentTasks({ rowTasks: TASKS, allTasks: TASKS, onMoveTasks }));
    act(() => result.current.move?.('outdent', ['a']));
    expect(onMoveTasks).toHaveBeenCalledWith({ direction: 'outdent', ids: ['a'], underTaskId: undefined, message: 'Outdented "A" to the top level.' });
    expect(result.current.notice).toBe('');
  });

  it('nothing to move: no save, and a visible status line says why', () => {
    const onMoveTasks = vi.fn(async () => {});
    const { result, rerender } = renderHook(() => useIndentTasks({ rowTasks: TASKS, allTasks: TASKS, onMoveTasks }));
    act(() => result.current.move?.('outdent', ['p']));
    act(() => { vi.advanceTimersByTime(50); });
    expect(onMoveTasks).not.toHaveBeenCalled();
    expect(result.current.notice).toBe('Nothing to outdent: "Phase" is already at the top level.');
    rerender();
    render(<IndentNotice notice={result.current.notice} />);
    expect(screen.getByRole('status').textContent).toContain('Nothing to outdent: "Phase" is already at the top level.');
  });

  it('Indent on the first row says there is nothing above', () => {
    const { result } = renderHook(() => useIndentTasks({ rowTasks: TASKS, allTasks: TASKS, onMoveTasks: vi.fn(async () => {}) }));
    act(() => result.current.move?.('indent', ['p']));
    act(() => { vi.advanceTimersByTime(50); });
    expect(result.current.notice).toBe('Nothing above to indent under.');
  });

  it('indent hands the heading it chose (the row above) to the page', () => {
    const onMoveTasks = vi.fn(async () => {});
    const { result } = renderHook(() => useIndentTasks({ rowTasks: TASKS, allTasks: TASKS, onMoveTasks }));
    act(() => result.current.move?.('indent', ['b']));
    expect(onMoveTasks).toHaveBeenCalledWith({ direction: 'indent', ids: ['b'], underTaskId: 'a', message: 'Indented "B" under "A".' });
  });

  it('sorted or grouped list: Indent is refused with the reason, Outdent still works', () => {
    const onMoveTasks = vi.fn(async () => {});
    const { result } = renderHook(() => useIndentTasks({ rowTasks: TASKS, allTasks: TASKS, onMoveTasks, inPlanOrder: false }));
    act(() => result.current.move?.('indent', ['b']));
    act(() => { vi.advanceTimersByTime(50); });
    expect(onMoveTasks).not.toHaveBeenCalled();
    expect(result.current.notice).toMatch(/sorted, grouped or filtered/);
    act(() => result.current.move?.('outdent', ['a']));
    expect(onMoveTasks).toHaveBeenCalledTimes(1);
  });

  it('a failed save is already said by the page: no unhandled rejection here', async () => {
    const onMoveTasks = vi.fn(() => Promise.reject(new Error('no')));
    const { result } = renderHook(() => useIndentTasks({ rowTasks: TASKS, allTasks: TASKS, onMoveTasks }));
    act(() => result.current.move?.('indent', ['b']));
    await act(async () => { await Promise.resolve(); });
    expect(onMoveTasks).toHaveBeenCalled();
  });

  it('read-only (no way to move): no move function', () => {
    const { result } = renderHook(() => useIndentTasks({ rowTasks: TASKS, allTasks: TASKS }));
    expect(result.current.move).toBeUndefined();
  });
});

describe('menu focus', () => {
  it('after the keyboard was used, closing puts the focus back where it was; Tab is not passed on', () => {
    const before = document.createElement('button');
    document.body.appendChild(before);
    before.focus();
    const view = render(
      <GanttContextMenu
        contextMenu={{ x: 1, y: 1, task: TASKS[1], rowIdx: 1 }} selectedIds={new Set()} someSelected={false}
        onTaskClick={vi.fn()} indentItems={{ outdent: true, indent: true }} onIndent={vi.fn()}
        onClose={vi.fn()} setPendingDeleteIds={vi.fn()}
      />,
    );
    expect(document.activeElement).not.toBe(before);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    act(() => { document.activeElement!.dispatchEvent(tab); });
    expect(tab.defaultPrevented).toBe(true);
    view.unmount();
    expect(document.activeElement).toBe(before);
    before.remove();
  });
});
