import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useColumnState } from '../../hooks/useColumnState';
import { ScheduleToolbar } from '../../pages/ProjectDetailPage/schedule-tab/ScheduleToolbar';

function Toolbar({ showFilters, hasActiveFilters }: { showFilters: boolean; hasActiveFilters: boolean }) {
  const columnState = useColumnState('test-schedule');
  return (
    <MemoryRouter>
      <ScheduleToolbar
        viewMode="table"
        tasksCount={5}
        searchQuery=""
        onSearchChange={vi.fn()}
        onToggleFilters={vi.fn()}
        showFilters={showFilters}
        hasActiveFilters={hasActiveFilters}
        activeFilterCount={hasActiveFilters ? 2 : 0}
        columnState={columnState}
        overflowMenu={null}
        onExportCSV={vi.fn()}
        filteredCount={5}
        totalCount={5}
      />
    </MemoryRouter>
  );
}

const renderToolbar = (showFilters: boolean, hasActiveFilters: boolean) =>
  render(<Toolbar showFilters={showFilters} hasActiveFilters={hasActiveFilters} />);

describe('Table Filters button follows the panel, not the filters', () => {
  it('is on while the panel is open', () => {
    renderToolbar(true, false);
    expect(screen.getByRole('button', { name: /Filters/ })).toHaveAttribute('aria-pressed', 'true');
  });
  it('is off when the panel is closed, even with filters set (the badge shows the count)', () => {
    renderToolbar(false, true);
    const btn = screen.getByRole('button', { name: /Filters/ });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    expect(btn).toHaveTextContent('2');
  });
});
