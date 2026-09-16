import { createRef } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { GanttToolbar } from '../../components/schedule/gantt/GanttToolbar';
import { DEFAULT_VISIBLE_KEYS, COLUMN_DEFS } from '../../components/schedule/tableColumns';
import type { ColumnState } from '../../hooks/useColumnState';
import type { ColumnKey, ColumnGroup } from '../../components/schedule/tableColumns';

const toggleColumn = vi.fn<(key: ColumnKey) => void>();
const toggleGroup = vi.fn<(group: ColumnGroup, visible: boolean) => void>();

function makeColumnState(): ColumnState {
  return {
    visibleKeys: new Set(DEFAULT_VISIBLE_KEYS),
    columnOrder: [],
    colWidths: {},
    visibleColumns: COLUMN_DEFS.filter(c => DEFAULT_VISIBLE_KEYS.has(c.key)),
    toggleColumn,
    toggleGroup,
    setVisibleKeys: vi.fn(),
    setColumnOrder: vi.fn(),
    setColWidths: vi.fn(),
    moveColumn: vi.fn(),
    cpmNeeded: false,
  };
}

function renderToolbar(columnState?: ColumnState) {
  return render(
    <GanttToolbar
      scheduleName="Test schedule"
      onAddTask={() => {}}
      rowCount={3}
      baseRowCount={3}
      parentTaskCount={0}
      collapsedCount={0}
      expandAll={() => {}}
      collapseAll={() => {}}
      zoom="week"
      setZoom={() => {}}
      handleZoomToFit={() => {}}
      searchQuery=""
      setSearchQuery={() => {}}
      searchInputRef={createRef<HTMLInputElement>()}
      showFilters={false}
      setShowFilters={() => {}}
      activeFilterCount={0}
      setPendingDeleteIds={() => {}}
      columnState={columnState}
      orderedColumns={[]}
      ganttVisibleCols={new Set()}
      toggleColVisibility={() => {}}
      moveColumn={() => {}}
      setGanttVisibleCols={() => {}}
      setGanttColOrder={() => {}}
      tasks={[]}
      showOverallocation={false}
      setShowOverallocation={() => {}}
      overallocatedCount={0}
      showMinimap={false}
      setShowMinimap={() => {}}
      handleLoadView={() => {}}
      panelMode="split"
      setPanelMode={() => {}}
      sortField={null}
      sortDirection={null}
    />
  );
}

describe('GanttToolbar column picker', () => {
  afterEach(() => {
    cleanup();
    toggleColumn.mockClear();
    toggleGroup.mockClear();
  });

  it('shows the shared column picker when a shared columnState is provided', () => {
    renderToolbar(makeColumnState());
    const button = screen.getByTitle('Choose columns');
    expect(button).toBeInTheDocument();
    expect(screen.queryByTitle('Show/hide columns')).not.toBeInTheDocument();
  });

  it('opens the shared picker and lists the column groups', () => {
    renderToolbar(makeColumnState());
    fireEvent.click(screen.getByTitle('Choose columns'));
    expect(screen.getByText('Standard')).toBeInTheDocument();
    expect(screen.getByText('Scheduling (CPM)')).toBeInTheDocument();
  });

  it('toggles a column through the shared state', () => {
    renderToolbar(makeColumnState());
    fireEvent.click(screen.getByTitle('Choose columns'));
    const firstCheckbox = screen.getAllByRole('checkbox')[0];
    fireEvent.click(firstCheckbox);
    expect(toggleColumn.mock.calls.length + toggleGroup.mock.calls.length).toBeGreaterThan(0);
  });

  it('places Columns directly after Filter and before Add Task, matching Table view', () => {
    renderToolbar(makeColumnState());
    const filter = screen.getByTitle('Filter tasks');
    const columns = screen.getByTitle('Choose columns');
    const add = screen.getByText('Add Task');
    // DOCUMENT_POSITION_FOLLOWING (4): the argument comes after the node
    expect(filter.compareDocumentPosition(columns) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(columns.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('falls back to the legacy built-in picker when no shared columnState is provided', () => {
    renderToolbar(undefined);
    expect(screen.getByTitle('Show/hide columns')).toBeInTheDocument();
    expect(screen.queryByTitle('Choose columns')).not.toBeInTheDocument();
  });
});
