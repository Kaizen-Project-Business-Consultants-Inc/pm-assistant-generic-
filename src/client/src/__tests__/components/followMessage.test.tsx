import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { followMessage, cascadeMoves, rescheduledMoves } from '../../utils/followMessage';
import { UndoToast } from '../../components/schedule/UndoToast';

/** The message after a change that moved the tasks that follow (2026-11-28): the headline and one line for each task */
describe('followMessage', () => {
  const earlier = { taskId: 'b', name: 'Build screens', from: '2026-07-10', to: '2026-07-06', days: -4 };
  const later = { taskId: 'c', name: 'Test screens', from: '2026-07-17', to: '2026-07-20', days: 3 };
  const held = { taskId: 'd', name: 'Sign-off', reason: 'is completed', wouldStart: '2026-07-06' };

  it('says nothing when nothing moved and nothing was held', () => {
    expect(followMessage([], [])).toBeNull();
  });

  it('earlier, later and not moved, each in plain words', () => {
    expect(followMessage([earlier], [])!.headline).toBe('1 task moved earlier');
    expect(followMessage([later], [])!.headline).toBe('1 task moved later');
    expect(followMessage([earlier, later], [])!.headline).toBe('1 task moved earlier, 1 moved later');
    expect(followMessage([earlier, { ...earlier, taskId: 'e' }], [held])!.headline).toBe('2 tasks moved earlier, 1 not moved');
    expect(followMessage([], [held, { ...held, taskId: 'f' }])!.headline).toBe('2 tasks not moved');
  });

  it('one line for each task, with its row number, old and new start, and the reason a held task stayed', () => {
    const rows: Record<string, number> = { b: 6, c: 7, d: 8 };
    const m = followMessage([earlier, later], [held], id => rows[id])!;
    expect(m.lines).toEqual([
      { tag: 'EARLIER', text: '6 Build screens: 10 Jul → 6 Jul' },
      { tag: 'LATER', text: '7 Test screens: 17 Jul → 20 Jul' },
      { tag: 'NOT MOVED', text: '8 Sign-off is completed' },
    ]);
  });

  it('reads the two reply shapes (a saved date change, and the tasks a new link moved)', () => {
    expect(cascadeMoves([{ taskId: 'b', taskName: 'B', oldStartDate: '2026-07-10', newStartDate: '2026-07-06', deltaDays: -4 }])).toEqual([{ taskId: 'b', name: 'B', from: '2026-07-10', to: '2026-07-06', days: -4 }]);
    expect(rescheduledMoves([{ taskId: 'c', name: 'C', oldStart: null, newStart: '2026-07-20', movedDays: 0 }])).toEqual([{ taskId: 'c', name: 'C', from: null, to: '2026-07-20', days: 0 }]);
  });
});

describe('UndoToast', () => {
  const lines = [{ tag: 'EARLIER' as const, text: '6 Build screens: 10 Jul → 6 Jul' }, { tag: 'NOT MOVED' as const, text: '8 Sign-off is completed' }];

  it('Details opens the list, holds the toast open while it is shown, and a plain toast has no Details', () => {
    const onHold = vi.fn();
    render(<UndoToast text="Edit Task 5 · 1 task moved earlier" details={lines} onUndo={vi.fn()} onDismiss={vi.fn()} onHold={onHold} />);
    expect(screen.queryByText(/Build screens/)).toBeNull();
    const details = screen.getByRole('button', { name: /Details/ });
    expect(details).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(details);
    expect(details).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Build screens: 10 Jul → 6 Jul/)).toBeInTheDocument();
    expect(screen.getByText(/Sign-off is completed/)).toBeInTheDocument();
    expect(onHold).toHaveBeenLastCalledWith(true);
  });

  it('a toast with nothing to list shows no Details button; Undo and dismiss work', () => {
    const onUndo = vi.fn(); const onDismiss = vi.fn();
    render(<UndoToast text="Edit Task 5" details={null} onUndo={onUndo} onDismiss={onDismiss} onHold={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /Details/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
