/**
 * Deleting a heading that has tasks under it (2026-11-19, like Microsoft Project): the tasks go with
 * it, and the dialog says how many. Plain tasks keep the usual "are you sure". It is an alert dialog:
 * Cancel has focus, Escape cancels.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { DeleteTasksModal } from '../../components/schedule/DeleteTasksModal';

const offsetParent = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return (this as HTMLElement).parentElement; } });
});
afterAll(() => { if (offsetParent) Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetParent); });
afterEach(() => { cleanup(); document.body.innerHTML = ''; });

const tasks = [
  { id: 'sum', name: 'test', parentTaskId: null },
  { id: 'kid', name: 'child', parentTaskId: 'sum' },
  { id: 'solo', name: 'Solo', parentTaskId: null },
];

describe('DeleteTasksModal', () => {
  it('a heading with a task under it asks, in an alert dialog named by its title', () => {
    render(<DeleteTasksModal tasks={tasks} ids={['sum']} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const dlg = screen.getByRole('alertdialog');
    expect(dlg.getAttribute('aria-labelledby')).toBeTruthy();
    expect(screen.getByRole('alertdialog', { name: 'Delete "test"?' })).toBeTruthy();
    expect(dlg.textContent).toContain('This heading has 1 task under it ("child").');
    expect(dlg.textContent).toContain('deleted with the heading');
    expect(dlg.textContent).toContain('Can be undone from History');
  });

  it('there is one way to delete a heading: with its tasks (no "heading only" button)', () => {
    const onConfirm = vi.fn();
    render(<DeleteTasksModal tasks={tasks} ids={['sum']} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /heading only/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete heading and 1 task' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith('delete');
  });

  it('Cancel has focus (the safe choice); Escape and Cancel cancel without deleting', async () => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<DeleteTasksModal tasks={tasks} ids={['sum']} onConfirm={onConfirm} onCancel={onCancel} />);
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Cancel')); // focus moves in on the next tick
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('a task with nothing under it gets the usual confirmation, no choice', () => {
    const onConfirm = vi.fn();
    render(<DeleteTasksModal tasks={tasks} ids={['solo']} onConfirm={onConfirm} onCancel={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByText(/heading only/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledWith('keep');
  });

  it('a heading deleted together with all its tasks is not asked about', () => {
    render(<DeleteTasksModal tasks={tasks} ids={['sum', 'kid']} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Are you sure you want to delete 2 tasks?')).toBeTruthy();
  });
});
