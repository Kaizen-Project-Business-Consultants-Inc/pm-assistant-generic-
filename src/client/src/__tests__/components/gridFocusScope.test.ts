/**
 * The Gantt grid's and the Table's keys only act while the user is working in the grid
 * (audit K1/K2, 2026-10-09; WCAG 2.1.2 No Keyboard Trap, 3.2.2 On Input).
 *
 * Before: one document keydown listener per view took Tab (and Delete, Ctrl+C/V/D, Alt+arrows)
 * wherever the focus was. After clicking a row, Tab on a toolbar button indented that task and the
 * focus could never leave; the Table swallowed every Tab on the page.
 *
 * Now (useGridFocusScope, shared by both views): a mouse press in the grid starts "working in
 * the grid"; a press or focus elsewhere, or Escape, ends it. Keys from outside the grid, or after
 * that, behave as anywhere else: Tab moves focus, nothing is changed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGridKeyboard } from '../../components/schedule/gantt/hooks/useGridKeyboard';
import { useTableKeyboard } from '../../components/schedule/table/hooks/useTableKeyboard';
import { useGridCellState } from '../../components/schedule/shared/hooks/useGridKeyboardPaste';
import { buildFlatRows, GANTT_COLUMNS, type GanttTask } from '../../components/schedule/gantt/types';
import type { EditableField as TableField } from '../../components/schedule/table/types';

const TASKS: GanttTask[] = [
  { id: 'p', name: 'Phase', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-20', sortOrder: 10, isSummary: true },
  { id: 'a', name: 'A', status: 'pending', startDate: '2026-03-02', endDate: '2026-03-06', parentTaskId: 'p', sortOrder: 20 },
  { id: 'b', name: 'B', status: 'pending', startDate: '2026-03-09', endDate: '2026-03-13', parentTaskId: 'p', sortOrder: 30 },
  { id: 'c', name: 'C', status: 'pending', startDate: '2026-03-16', endDate: '2026-03-20', sortOrder: 40 },
];

// The page: a toolbar (search box + button) and the task grid with a row checkbox
let page: {
  grid: HTMLElement; row: HTMLElement; box: HTMLInputElement; rowButton: HTMLButtonElement; sortHeader: HTMLElement;
  search: HTMLInputElement; button: HTMLButtonElement;
};
function buildPage() {
  document.body.innerHTML = '';
  const toolbar = document.createElement('div');
  const search = Object.assign(document.createElement('input'), { type: 'text' });
  const button = document.createElement('button');
  toolbar.append(search, button);
  const grid = document.createElement('div');
  grid.setAttribute('role', 'grid');
  const row = document.createElement('div');
  row.setAttribute('role', 'row');
  const box = Object.assign(document.createElement('input'), { type: 'checkbox' });
  const rowButton = document.createElement('button'); // e.g. the collapse chevron, Edit, Delete
  row.append(box, rowButton);
  const sortHeader = document.createElement('span'); // the Gantt's sortable column labels
  sortHeader.setAttribute('role', 'button');
  sortHeader.tabIndex = 0;
  grid.append(sortHeader, row);
  document.body.append(toolbar, grid);
  page = { grid, row, box, rowButton, sortHeader, search, button };
}
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

const mouseDown = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); });
const focusOn = (el: HTMLElement) => act(() => { el.focus(); });
function key(k: string, target: EventTarget = document.body, opts: KeyboardEventInit = {}) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  act(() => { target.dispatchEvent(e); });
  return e;
}

// ---------------------------------------------------------------------------------------------
// The two views, mounted with the same plan; `changed` lists every call that changes the plan
// ---------------------------------------------------------------------------------------------
interface View {
  name: string;
  mount: (o: { activeTaskId?: string | null; selected?: string[]; readOnly?: boolean; contextMenu?: boolean }) => {
    changed: () => unknown[];
    focusedCell: () => unknown;
    setContextMenu?: ReturnType<typeof vi.fn>;
  };
}

const gantt: View = {
  name: 'Gantt',
  mount: ({ activeTaskId = null, selected = [], readOnly = false }) => {
    const rows = buildFlatRows(TASKS);
    const fns = { onTaskUpdate: vi.fn(), onBulkUpdate: vi.fn(async () => {}), onTaskReorder: vi.fn(), onDuplicateTasks: vi.fn() };
    const hook = renderHook(() => useGridKeyboard({
      tasks: TASKS, rows, editingCell: null, activeTaskId,
      onTaskUpdate: readOnly ? undefined : fns.onTaskUpdate,
      onTaskReorder: fns.onTaskReorder, onTaskSelect: vi.fn(), onDuplicateTasks: fns.onDuplicateTasks,
      onBulkUpdate: fns.onBulkUpdate, startEditing: vi.fn(), getTaskFieldValue: (t, f) => String((t as unknown as Record<string, unknown>)[f] ?? ''),
      rowNumToTaskId: new Map(rows.map((r, i) => [i + 1, r.task.id])), workCalendar: null,
      someSelected: selected.length > 0, selectedIds: new Set(selected), setBulkMessage: vi.fn(),
      orderedColumns: GANTT_COLUMNS, isColVisible: () => true,
    }));
    return {
      changed: () => Object.values(fns).flatMap(f => f.mock.calls),
      focusedCell: () => hook.result.current.focusedCell,
    };
  },
};

const table: View = {
  name: 'Table',
  mount: ({ activeTaskId = null, selected = [], readOnly = false, contextMenu = false }) => {
    const fns = {
      onTaskUpdate: vi.fn(), onBulkUpdate: vi.fn(async () => {}), onDuplicateTasks: vi.fn(),
      handleBulkDelete: vi.fn(), handleDeleteTasks: vi.fn(),
    };
    const setContextMenu = vi.fn();
    const hook = renderHook(() => {
      const cell = useGridCellState<TableField>();
      useTableKeyboard({
        tasks: TASKS, visibleSorted: TASKS, visibleFieldOrder: ['name', 'status'], selectedIds: new Set(selected),
        activeTaskId, editingCell: null, ...cell, contextMenu: contextMenu ? { x: 1, y: 1 } : null, setContextMenu,
        onTaskUpdate: readOnly ? undefined : fns.onTaskUpdate, onBulkUpdate: readOnly ? undefined : fns.onBulkUpdate,
        onDuplicateTasks: fns.onDuplicateTasks, onTaskSelect: vi.fn(), startEditing: vi.fn(),
        getTaskFieldValue: () => '', handleBulkDelete: fns.handleBulkDelete, handleDeleteTasks: fns.handleDeleteTasks,
        showBulkSuccess: vi.fn(), workCalendar: null, rowNumToTaskId: new Map(),
      });
      return cell;
    });
    return {
      changed: () => Object.values(fns).flatMap(f => f.mock.calls),
      focusedCell: () => hook.result.current.focusedCell,
      setContextMenu,
    };
  },
};

for (const view of [gantt, table]) {
  describe(`${view.name}: Tab and the other grid keys only act inside the grid`, () => {
    it('after clicking a row, Tab on a toolbar button or in the search box moves on and changes nothing', () => {
      buildPage();
      const v = view.mount({ activeTaskId: 'c', selected: ['c'] });
      mouseDown(page.row);
      for (const el of [page.button, page.search]) {
        focusOn(el);
        for (const shiftKey of [false, true]) {
          const e = key('Tab', el, { shiftKey });
          expect(e.defaultPrevented, `${el.tagName} shift=${shiftKey}`).toBe(false);
        }
      }
      expect(v.changed()).toEqual([]);
    });

    it('Tab from the page body indents nothing until the user clicks in the grid', () => {
      buildPage();
      const v = view.mount({ activeTaskId: 'c' });
      expect(key('Tab').defaultPrevented).toBe(false);
      mouseDown(page.button); // a click outside the grid
      expect(key('Tab').defaultPrevented).toBe(false);
      expect(v.changed()).toEqual([]);
    });

    it('clicked in the grid with a selected row: Tab indents and Shift+Tab outdents, as before', () => {
      buildPage();
      const v = view.mount({ selected: ['c'] });
      mouseDown(page.row);
      const e = key('Tab'); // the browser focuses <body> after a click on a row
      expect(e.defaultPrevented).toBe(true);
      // (the Gantt sends one task as an update, the Table through the bulk update)
      expect(v.changed().length).toBe(1);
      // a click on a row checkbox counts as the grid too (the Gantt also takes Tab from the
      // checkbox itself, useGridKeyboard.test.ts; the Table leaves keys typed in any input alone)
      const v2 = view.mount({ activeTaskId: 'b' });
      mouseDown(page.box);
      expect(key('Tab', document.body, { shiftKey: true }).defaultPrevented).toBe(true);
      expect(v2.changed().length).toBe(1);
    });

    it('Escape leaves the grid: the next Tab moves on and changes nothing; a click back in resumes', () => {
      buildPage();
      const v = view.mount({ activeTaskId: 'c' });
      mouseDown(page.row);
      key('Escape');
      expect(key('Tab').defaultPrevented).toBe(false);
      expect(key('Tab', document.body, { shiftKey: true }).defaultPrevented).toBe(false);
      expect(v.changed()).toEqual([]);
      mouseDown(page.row);
      expect(key('Tab').defaultPrevented).toBe(true);
      expect(v.changed().length).toBe(1);
    });

    it('reaching the grid by Tab (no click) does not take Tab: the keyboard walks through', () => {
      buildPage();
      const v = view.mount({ activeTaskId: 'c' });
      focusOn(page.box);
      expect(key('Tab', page.box).defaultPrevented).toBe(false);
      expect(v.changed()).toEqual([]);
    });

    it('focus moving out of the grid (e.g. a dialog or the toolbar) ends it', () => {
      buildPage();
      const v = view.mount({ activeTaskId: 'c' });
      mouseDown(page.row);
      focusOn(page.button);
      act(() => { page.button.blur(); }); // focus back on <body>
      expect(key('Tab').defaultPrevented).toBe(false);
      expect(v.changed()).toEqual([]);
    });

    it('Delete, Ctrl+D, Ctrl+V and Alt+arrows outside the grid do nothing', () => {
      buildPage();
      const v = view.mount({ activeTaskId: 'b', selected: ['b'] });
      // never clicked in the grid, then a click on the toolbar
      for (const round of [0, 1]) {
        if (round) { mouseDown(page.row); mouseDown(page.button); }
        for (const [k, opts] of [['Delete', {}], ['d', { ctrlKey: true }], ['c', { ctrlKey: true }], ['v', { ctrlKey: true }],
          ['ArrowDown', { altKey: true }], ['ArrowUp', { altKey: true }], ['Enter', {}]] as Array<[string, KeyboardEventInit]>) {
          for (const target of [document.body, page.button]) {
            expect(key(k, target, opts).defaultPrevented, `${k} round ${round}`).toBe(false);
          }
        }
      }
      expect(v.changed()).toEqual([]);
      expect(v.focusedCell()).toBeNull();
    });

    it('a button or sort header inside the grid keeps its own Tab and Enter, even after a click', () => {
      buildPage();
      const v = view.mount({ activeTaskId: 'c', selected: ['c'] });
      for (const el of [page.rowButton, page.sortHeader]) {
        mouseDown(el);
        focusOn(el);
        for (const k of ['Tab', 'Enter', 'F2', 'Delete']) {
          expect(key(k, el).defaultPrevented, `${k} on ${el.tagName}`).toBe(false);
        }
        expect(key('Tab', el, { shiftKey: true }).defaultPrevented).toBe(false);
      }
      expect(v.changed()).toEqual([]);
      expect(v.focusedCell()).toBeNull();
    });

    it('Escape on a row checkbox leaves the grid too, so the keyboard is never stuck there', () => {
      buildPage();
      const v = view.mount({ activeTaskId: 'b' });
      mouseDown(page.box);
      focusOn(page.box);
      key('Escape', page.box);
      expect(key('Tab', page.box).defaultPrevented).toBe(false);
      expect(key('Tab').defaultPrevented).toBe(false);
      expect(v.changed()).toEqual([]);
    });

    it('Escape in a text field (cancelling an edit) does not leave the grid', () => {
      buildPage();
      const v = view.mount({ activeTaskId: 'b' });
      const edit = Object.assign(document.createElement('input'), { type: 'text' });
      page.row.append(edit);
      mouseDown(edit);
      key('Escape', edit);
      edit.remove(); // the edit closes; focus is back on <body>
      expect(key('Tab').defaultPrevented).toBe(true);
      expect(v.changed().length).toBe(1);
    });

    it('read-only plan: Tab is never taken, even in the grid', () => {
      buildPage();
      const v = view.mount({ activeTaskId: 'c', readOnly: true });
      mouseDown(page.row);
      expect(key('Tab').defaultPrevented).toBe(false);
      expect(v.changed()).toEqual([]);
    });

    it('in the grid with no row picked, Tab moves on as usual', () => {
      buildPage();
      view.mount({});
      mouseDown(page.row);
      expect(key('Tab').defaultPrevented).toBe(false);
    });
  });
}

describe('Table: Escape still closes the context menu wherever the focus is', () => {
  it('closes it from outside the grid, without leaving the grid', () => {
    buildPage();
    const v = table.mount({ activeTaskId: 'c', contextMenu: true });
    mouseDown(page.row);
    key('Escape', page.button);
    expect(v.setContextMenu).toHaveBeenCalledWith(null);
  });
});
