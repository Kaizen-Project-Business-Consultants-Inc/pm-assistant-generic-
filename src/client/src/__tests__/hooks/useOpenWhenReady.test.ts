import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useOpenWhenReady } from '../../hooks/useOpenWhenReady';

const report = { id: 'r1', title: 'Risk Assessment Report — Web App — Oct 19, 2026', reportType: 'risk-assessment' };
/** Announces like useWebSocket does; true when a page said it opened the report */
const announce = (detail: unknown) => {
  let handled = false;
  act(() => { handled = !window.dispatchEvent(new CustomEvent('ws:ai_report_ready', { detail, cancelable: true })); });
  return handled;
};

describe('useOpenWhenReady (UAT U44)', () => {
  it('opens a report this page asked for, once, and says it did', () => {
    const onReady = vi.fn();
    const { result } = renderHook(() => useOpenWhenReady(onReady));
    act(() => result.current('job-1'));

    expect(announce({ jobId: 'job-1', report })).toBe(true);
    expect(announce({ jobId: 'job-1', report })).toBe(false);

    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(report, false);
  });

  it('opens it when the announcement beat the reply with its job id', () => {
    const onReady = vi.fn();
    const { result } = renderHook(() => useOpenWhenReady(onReady));

    announce({ jobId: 'job-1', report });
    expect(onReady).not.toHaveBeenCalled();
    act(() => result.current('job-1'));

    expect(onReady).toHaveBeenCalledWith(report, false);
  });

  it('tells the page when another report is still on its way', () => {
    const onReady = vi.fn();
    const { result } = renderHook(() => useOpenWhenReady(onReady));
    act(() => { result.current('job-1'); result.current('job-2'); });

    announce({ jobId: 'job-1', report });
    announce({ jobId: 'job-2', report: { ...report, id: 'r2' } });

    expect(onReady.mock.calls.map(c => c[1])).toEqual([true, false]);
  });

  it('ignores reports asked for elsewhere and malformed messages', () => {
    const onReady = vi.fn();
    const { result } = renderHook(() => useOpenWhenReady(onReady));
    act(() => result.current('job-1'));

    expect(announce({ jobId: 'job-2', report })).toBe(false);
    announce({ jobId: 'job-1' });
    announce(undefined);

    expect(onReady).not.toHaveBeenCalled();
  });

  it('stops listening when the page closes', () => {
    const onReady = vi.fn();
    const { result, unmount } = renderHook(() => useOpenWhenReady(onReady));
    act(() => result.current('job-1'));
    unmount();

    expect(announce({ jobId: 'job-1', report })).toBe(false);
    expect(onReady).not.toHaveBeenCalled();
  });
});
