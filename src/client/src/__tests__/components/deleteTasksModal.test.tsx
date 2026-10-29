/**
 * The delete question (2026-10-29): deleting a heading that has tasks under it asks whether the
 * tasks stay or go with it. Plain tasks keep the usual "are you sure". It is an alert dialog:
 * the first option has focus, Escape cancels, nothing is remembered.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
    expect(dlg.textContent).toContain('Either choice can be undone from History');
  });

  it('"heading only" confirms with keep; "and its task" confirms with delete', () => {
    const onConfirm = vi.fn();
    render(<DeleteTasksModal tasks={tasks} ids={['sum']} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Delete the heading only/ }));
    expect(onConfirm).toHaveBeenLastCalledWith('keep');
    fireEvent.click(screen.getByRole('button', { name: /Delete the heading and its 1 task/ }));
    expect(onConfirm).toHaveBeenLastCalledWith('delete');
  });

  it('the first option has focus; Escape and Cancel cancel without deleting', () => {
    const onConfirm = vi.fn(); const onCancel = vi.fn();
    render(<DeleteTasksModal tasks={tasks} ids={['sum']} onConfirm={onConfirm} onCancel={onCancel} />);
    expect(document.activeElement?.textContent).toContain('Delete the heading only');
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
