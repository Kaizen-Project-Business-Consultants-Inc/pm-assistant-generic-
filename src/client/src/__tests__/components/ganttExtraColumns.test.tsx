/**
 * The Gantt grid can show every Table column (2026-11-03). The columns once found only in the
 * Table are off until ticked in the shared Columns menu, show the Table's values, and the money
 * ones stay hidden from roles that see no pay rates.
 */
import { createRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GanttToolbar } from '../../components/schedule/gantt/GanttToolbar';
import { GanttLeftPanelHeader } from '../../components/schedule/gantt/GanttLeftPanelHeader';
import { GanttLeftPanelRow } from '../../components/schedule/gantt/GanttLeftPanelRow';
import { useGanttColumns } from '../../components/schedule/gantt/hooks/useGanttColumns';
import { buildExtraColumnCtx, extraCell, MONEY_COLUMN_KEYS } from '../../components/schedule/gantt/extraColumns';
import { COLUMN_DEFS, DEFAULT_VISIBLE_KEYS, type ColumnKey } from '../../components/schedule/tableColumns';
import { TABLE_TO_GANTT_KEY } from '../../components/schedule/columnKeyMap';
import type { GanttTask } from '../../components/schedule/gantt/types';
import type { ColumnState } from '../../hooks/useColumnState';
import { useAuthStore, type User } from '../../stores/authStore';

afterEach(() => {
  cleanup();
  useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false });
});

const signIn = (role: string) => useAuthStore.setState({
  user: { id: 'u1', username: 'x', email: 'x@x', fullName: 'X', role, emailVerified: true, organization: { id: 'o', name: 'Co', slug: 'co', isOwner: false } } as User,
  isAuthenticated: true, isLoading: false,
});

const ADDED_KEYS = Object.keys(TABLE_TO_GANTT_KEY).filter(k => ['wbs', 'budgetAllocated', 'actualCost', 'baselineCost', 'budgetVariance', 'critical', 'earlyStart', 'freeFloat', 'constraintType', 'startVariance'].includes(k)) as ColumnKey[];

function columnState(extraOn: ColumnKey[] = []): ColumnState {
  const visibleKeys = new Set<ColumnKey>([...DEFAULT_VISIBLE_KEYS, ...extraOn]);
  return {
    visibleKeys, columnOrder: [], colWidths: {}, visibleColumns: COLUMN_DEFS.filter(c => visibleKeys.has(c.key)),
    toggleColumn: vi.fn(), toggleGroup: vi.fn(), setVisibleKeys: vi.fn(), setColumnOrder: vi.fn(), setColWidths: vi.fn(),
    moveColumn: vi.fn(), cpmNeeded: false,
  };
}

function openPicker() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <GanttToolbar
        scheduleName="S" onAddTask={() => {}} rowCount={1} baseRowCount={1} parentTaskCount={0} collapsedCount={0}
        expandAll={() => {}} collapseAll={() => {}} zoom="week" setZoom={() => {}} handleZoomToFit={() => {}}
        searchQuery="" setSearchQuery={() => {}} searchInputRef={createRef<HTMLInputElement>()}
        showFilters={false} setShowFilters={() => {}} activeFilterCount={0} setPendingDeleteIds={() => {}}
        columnState={columnState()} orderedColumns={[]} ganttVisibleCols={new Set()} toggleColVisibility={() => {}}
        moveColumn={() => {}} setGanttVisibleCols={() => {}} setGanttColOrder={() => {}} tasks={[]}
        showOverallocation={false} setShowOverallocation={() => {}} overallocatedCount={0} anyoneAssigned
        showTimeline={false} setShowTimeline={() => {}} handleLoadView={() => {}} panelMode="split" setPanelMode={() => {}}
        sortField={null} sortDirection={null}
      />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByTitle('Choose columns'));
}

describe('Gantt column picker lists every Table column', () => {
  it('a PM sees every column of every group, including the ones once Table-only', () => {
    signIn('project_manager');
    openPicker();
    for (const g of ['Standard', 'Scheduling (CPM)', 'Baseline', 'Cost']) expect(screen.getByText(g)).toBeInTheDocument();
    for (const c of COLUMN_DEFS.filter(c => c.key !== 'rowNum' && c.key !== 'name')) {
      expect(screen.getAllByText(c.label).length, c.label).toBeGreaterThan(0);
    }
  });

  it('a team member does not see the money columns', () => {
    signIn('team_member');
    openPicker();
    expect(screen.queryByText('Budget')).not.toBeInTheDocument();
    expect(screen.queryByText('Actual Cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Baseline Cost')).not.toBeInTheDocument();
    expect(screen.queryByText('Cost Variance')).not.toBeInTheDocument();
    expect(screen.getByText('Early Start')).toBeInTheDocument();
  });
});

const task: GanttTask = {
  id: 't1', name: 'Build', status: 'pending', startDate: '2026-11-02', endDate: '2026-11-06', budgetAllocated: 1500, actualCost: 2000,
};

function Harness({ state, userRole }: { state: ColumnState; userRole: string }) {
  signIn(userRole);
  const cols = useGanttColumns({ scheduleId: 's1', columnState: state });
  const ctx = buildExtraColumnCtx(
    { cpmData: { tasks: [{ taskId: 't1', ES: 0, EF: 4, LS: 0, LF: 4, duration: 5, totalFloat: 0, freeFloat: 2, isCritical: true }] } },
    [task],
  );
  const noop = vi.fn();
  return (
    <QueryClientProvider client={new QueryClient()}>
    <div role="grid">
      <GanttLeftPanelHeader
        orderedColumns={cols.orderedColumns} isColVisible={cols.isColVisible} getColWidth={cols.getColWidth}
        sortField={null} sortDirection={null} allSelected={false} hasOnBulkUpdate={false} hasOnTaskClick={false}
        ganttColDrag={cols.ganttColDrag} handleHeaderSort={noop} handleColResizeStart={noop} autoFitGanttColumn={noop}
        toggleSelectAll={noop} minRowWidth={cols.minRowWidth} ganttKeyToTableKey={cols.ganttKeyToTableKey} moveColumn={noop}
        columnState={state}
      />
      <GanttLeftPanelRow
        task={task} level={0} rowIdx={0} ariaRowIndex={2} isActive={false} isSelected={false} isParent={false} isCollapsed={false}
        editingField={null} focusedField={null} editValue="" savedField={null} pasteFlashField={null} depErrorMsg={null}
        rowDragTargetHere={false} isRowDragSource={false} someSelected={false} orderedColumns={cols.orderedColumns}
        isColVisible={cols.isColVisible} getColWidth={cols.getColWidth} minRowWidth={cols.minRowWidth} shouldVirtualize={false}
        rowNumMap={new Map([['t1', 1]])} successorMap={new Map()} extraCtx={ctx} taskById={new Map([['t1', task]])}
        sortField={null} hasOnBulkUpdate={false} hasOnTaskReorder={false} hasOnTaskClick={false} hasOnTaskUpdate={false}
        hasOnInsertAfter={false} hasOnDeleteTask={false} onRowClick={noop} onRowDoubleClick={noop} onRowContextMenu={noop}
        onRowDragStart={noop} onRowDragOver={noop} onRowDrop={noop} onRowDragEnd={noop} toggleSelect={noop} toggleCollapse={noop}
        onCellClick={noop} onEditValueChange={noop} onSaveEdit={noop} onKeyDown={noop} onSelectChange={noop} onDateChange={noop}
        onCancelEditing={noop} setNotesPopup={noop} setPendingDeleteIds={noop} getDepHealth={() => 'satisfied'}
      />
    </div>
    </QueryClientProvider>
  );
}

const headers = () => screen.queryAllByRole('columnheader').map(h => h.textContent?.trim());

describe('Gantt grid: the added columns', () => {
  it('are off by default: nobody changes their Gantt until they tick one', () => {
    for (const k of ADDED_KEYS) expect(DEFAULT_VISIBLE_KEYS.has(k), k).toBe(false);
    render(<Harness state={columnState()} userRole="project_manager" />);
    for (const label of ['Critical', 'WBS', 'Budget', 'Early Start', 'Free Slack']) expect(headers()).not.toContain(label);
  });

  it('ticking one shows its header and the Table value in the row', () => {
    render(<Harness state={columnState(['critical', 'freeFloat', 'wbs', 'budgetVariance'])} userRole="project_manager" />);
    expect(headers()).toEqual(expect.arrayContaining(['Critical', 'Free Slack', 'WBS', 'Cost Var']));
    const row = screen.getAllByRole('row').find(r => r.textContent?.includes('Build'))!;
    const cells = within(row).getAllByRole('gridcell').map(c => c.textContent);
    expect(cells).toEqual(expect.arrayContaining(['Yes', '2d', '1', '$500']));
  });

  it('money columns stay hidden from a role that sees no pay rates, even when ticked', () => {
    render(<Harness state={columnState(['budgetAllocated', 'actualCost', 'budgetVariance', 'baselineCost', 'wbs'])} userRole="team_member" />);
    expect(headers()).toContain('WBS');
    for (const label of ['Budget', 'Actual Cost', 'Cost Var', 'Base Cost']) expect(headers()).not.toContain(label);
  });
});

describe('extraCell', () => {
  const ctx = buildExtraColumnCtx({}, [task]);
  it('shows a dash where the Table does, and the Table money format', () => {
    expect(extraCell('critical', task, ctx).text).toBe('—');
    expect(extraCell('actualStartDate', task, ctx).text).toBe('—');
    expect(extraCell('constraintType', task, ctx).text).toBe('ASAP');
    expect(extraCell('budgetAllocated', task, ctx).text).toBe('$1,500');
    expect(extraCell('budgetVariance', task, ctx)).toEqual({ text: '$500', tone: 'bad' });
  });
  it('lists the money keys the picker hides', () => {
    expect([...MONEY_COLUMN_KEYS].sort()).toEqual(['actualCost', 'baselineCost', 'budgetAllocated', 'budgetVariance']);
  });
});
