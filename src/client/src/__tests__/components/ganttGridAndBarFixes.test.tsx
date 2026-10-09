import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { readFileSync } from 'fs';
import { join } from 'path';

const api = vi.hoisted(() => ({
  getResources: vi.fn(async () => ({ resources: [
    { id: 'r1', name: 'QA Project Manager', role: 'PM' },
    { id: 'r2', name: 'QA Team Member', role: 'Developer' },
  ] })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { ResourcePickerDropdown } from '../../components/schedule/ResourcePickerDropdown';
import { GanttTimelineBar } from '../../components/schedule/gantt/GanttTimelineBar';

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

/**
 * Gantt grid, Assigned (2026-10-04): the people list opened INSIDE the cell, which clips
 * (`truncate`), so only a sliver of the search box showed and nobody could be picked.
 * `floating` opens it in a layer above the page, placed under the cell.
 */
describe('ResourcePickerDropdown — floating (the Gantt grid\'s Assigned cell)', () => {
  const renderInClippingCell = (props: Partial<React.ComponentProps<typeof ResourcePickerDropdown>> = {}) => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    wrap(
      <div data-testid="cell" style={{ overflow: 'hidden', width: 80, height: 20 }}>
        Someone
        <ResourcePickerDropdown floating value={null} onSelect={onSelect} onClear={vi.fn()} onClose={onClose} {...props} />
      </div>,
    );
    return { onSelect, onClose, cell: screen.getByTestId('cell') };
  };

  it('opens outside the clipping cell, as a fixed layer, with the search box focused', async () => {
    const { cell } = renderInClippingCell();
    const search = screen.getByPlaceholderText('Search resources...');
    expect(cell.contains(search)).toBe(false);
    const panel = search.closest('div.fixed') as HTMLElement;
    expect(panel).toBeTruthy();
    expect(panel.parentElement).toBe(document.body);
    expect(document.activeElement).toBe(search);
  });

  it('a person can be found and picked', async () => {
    const { onSelect } = renderInClippingCell();
    fireEvent.change(screen.getByPlaceholderText('Search resources...'), { target: { value: 'Team' } });
    const btn = await screen.findByRole('button', { name: /QA Team Member/ });
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith('r2', 'QA Team Member');
  });

  it('Escape closes it; a press outside closes it; a press on its own cell does not', async () => {
    const { onClose, cell } = renderInClippingCell();
    fireEvent.mouseDown(cell);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByPlaceholderText('Search resources...'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('without floating (the Table), it still opens inside its cell, as before', async () => {
    wrap(<div data-testid="cell"><ResourcePickerDropdown value={null} onSelect={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} /></div>);
    const search = screen.getByPlaceholderText('Search resources...');
    expect(screen.getByTestId('cell').contains(search)).toBe(true);
    await waitFor(() => expect(api.getResources).toHaveBeenCalled());
  });

  it('the Gantt grid uses the floating picker for Assigned', () => {
    const src = readFileSync(join(__dirname, '../../components/schedule/gantt/GanttLeftPanelRow.tsx'), 'utf8');
    expect(src).toMatch(/<ResourcePickerDropdown\s+floating/);
  });
});

/**
 * Gantt bars (2026-10-04): on a bar wide enough to show its name, the name label (covering the
 * whole bar, drawn after the progress handle) caught the press meant for the handle, so dragging
 * it moved the bar. The label now lets presses through to what is underneath.
 */
describe('GanttTimelineBar — the progress handle is reachable under the name label', () => {
  const task: any = { id: 't1', name: 'Build', status: 'in_progress', startDate: '2026-10-15', endDate: '2026-10-21', progressPercentage: 20 };
  const renderBar = (width: number) => {
    const onBarMouseDown = vi.fn();
    const onProgressMouseDown = vi.fn((e: React.MouseEvent) => e.stopPropagation());
    const { container } = wrap(
      <GanttTimelineBar
        task={task} idx={0} left={10} width={width} top={0} barH={20} pct={20}
        isCritical={false} isSelected={false} isOverallocated={false} isParent={false} isDragging={false}
        canDrag isDepDrawSource={false} floatDays={0} dayPx={40} colors={{ bg: '#eee', fill: '#333', text: '#000' }}
        taskById={new Map([['t1', task]])} rowNumMap={new Map([['t1', 1]])} getDepHealth={() => 'satisfied'}
        onBarMouseDown={onBarMouseDown} onBarClick={vi.fn()} onProgressMouseDown={onProgressMouseDown}
        hasOnTaskUpdate
      />,
    );
    return { container, onBarMouseDown, onProgressMouseDown };
  };

  it('the name label does not catch presses (pointer-events: none)', () => {
    const { container } = renderBar(200);
    const label = Array.from(container.querySelectorAll('span')).find(s => s.textContent === 'Build')!.parentElement!;
    expect(label.className).toContain('pointer-events-none');
    // the handle is there and starts a progress drag, not a bar move
    const handle = container.querySelector('div[title^="Progress:"]') as HTMLElement;
    expect(handle).toBeTruthy();
  });

  it('pressing the handle starts a progress drag, not a bar move', () => {
    const { container, onBarMouseDown, onProgressMouseDown } = renderBar(200);
    fireEvent.mouseDown(container.querySelector('div[title^="Progress:"]') as HTMLElement);
    expect(onProgressMouseDown).toHaveBeenCalledTimes(1);
    expect(onBarMouseDown).not.toHaveBeenCalled();
  });
});

/**
 * Table (2026-10-04): a task link (?task=…) didn't scroll a 100+ task plan to the row — the Table
 * virtualises, so an off-screen row doesn't exist to be scrolled to. The link now scrolls the table
 * to where the row sits first, then centres it once it has rendered.
 */
describe('TableView — a task link reaches an off-screen row in a long (virtualised) plan', () => {
  const src = readFileSync(join(__dirname, '../../components/schedule/TableView.tsx'), 'utf8');
  it('scrolls the table to the row\'s position when the row is not rendered yet', () => {
    const seek = src.slice(src.indexOf('const seek = () =>'), src.indexOf('frame = requestAnimationFrame(seek);\n    return'));
    expect(seek).toContain("row.scrollIntoView({ block: 'center' })");
    expect(seek).toMatch(/virtualRowsRef\.current\.rows\.findIndex\(t => t\.id === focusTaskId\)/);
    expect(seek).toMatch(/box\.scrollTop = Math\.max\(0, idx \* ROW_H/);
    expect(seek).toContain('setScrollTop(box.scrollTop)');
  });
  it('knows, on every render, whether rows are virtualised and in what order', () => {
    expect(src).toContain('virtualRowsRef.current = { on: useVirtualization, rows: visibleSorted };');
  });
});
