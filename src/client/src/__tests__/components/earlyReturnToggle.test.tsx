// @vitest-environment happy-dom
/**
 * Two components had a hook below an early return, the same crash as GanttChart's empty state
 * (2026-10-05): React throws "Rendered fewer/more hooks than expected" when a re-render takes the
 * other branch. WidgetGrid: the last widget switched off, or the first one on. EVMMetricTooltip:
 * metricKey changing between a known and an unknown metric. The hooks now come first.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { WidgetGrid } from '../../components/dashboard/WidgetGrid';
import { EVMMetricTooltip, type MetricValues } from '../../components/evm/EVMMetricTooltip';
import type { WidgetDef } from '../../components/dashboard/WidgetRegistry';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const hookErrors = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(c => /hooks|Rendered (fewer|more)/i.test(String(c[0])));

describe('WidgetGrid: widgets → none → widgets', () => {
  const WIDGETS: WidgetDef[] = [
    { id: 'w1', label: 'One', group: 'G', defaultOn: true, size: 'full' },
    { id: 'w2', label: 'Two', group: 'G', defaultOn: true, size: 'full' },
  ];
  const grid = (enabled: string[], onReorder = vi.fn()) => (
    <WidgetGrid widgets={WIDGETS} enabledIds={new Set(enabled)} widgetOrder={['w1', 'w2']} onReorder={onReorder} renderWidget={id => <div>widget {id}</div>} />
  );

  it('switching every widget off and on again does not crash, and moving still works', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender, container } = render(grid(['w1', 'w2']));
    expect(container.textContent).toContain('widget w1');
    expect(() => rerender(grid([]))).not.toThrow();
    expect(container.textContent).toContain('No widgets enabled');
    const onReorder = vi.fn();
    expect(() => rerender(grid(['w1', 'w2'], onReorder))).not.toThrow();
    expect(container.textContent).toContain('widget w2');
    fireEvent.click(container.querySelectorAll('button[aria-label="Move widget up"]')[1]);
    expect(onReorder).toHaveBeenCalledWith(['w2', 'w1']);
    expect(() => rerender(grid([]))).not.toThrow();
    expect(hookErrors(errors)).toEqual([]);
  });

  it('starting with none, then some, does not crash', () => {
    const { rerender, container } = render(grid([]));
    expect(() => rerender(grid(['w1']))).not.toThrow();
    expect(container.textContent).toContain('widget w1');
  });
});

describe('EVMMetricTooltip: known → unknown → known metric', () => {
  const VALUES: MetricValues = { BAC: 100, EV: 50, AC: 60, PV: 55, CPI: 0.83, SPI: 0.91, EAC: 120, ETC: 60, VAC: -20, TCPI: 1.25 };

  it('does not crash either way, and still shows the child', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender, container } = render(<EVMMetricTooltip metricKey="CPI" values={VALUES}><span>card</span></EVMMetricTooltip>);
    expect(container.textContent).toContain('card');
    expect(() => rerender(<EVMMetricTooltip metricKey="NOPE" values={VALUES}><span>card</span></EVMMetricTooltip>)).not.toThrow();
    expect(container.textContent).toBe('card');
    expect(() => rerender(<EVMMetricTooltip metricKey="CPI" values={VALUES}><span>card</span></EVMMetricTooltip>)).not.toThrow();
    expect(container.textContent).toContain('card');
    expect(hookErrors(errors)).toEqual([]);
  });
});
