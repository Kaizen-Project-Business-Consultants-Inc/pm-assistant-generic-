// @vitest-environment happy-dom
/**
 * Sprint Board failed saves (2026-10-05). A dragged card moves at once; if the status change
 * does not save it goes back to its column and a red message says so (it used to stay in the
 * new column for good). Story points that don't save say so too. Success is unchanged.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  getSprintBoard: vi.fn(),
  getBulkReadiness: vi.fn(async () => ({ readiness: {} })),
  updateTask: vi.fn(),
  updateSprintTaskPoints: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { announce } from '../../utils/announce';
import { SprintBoard } from '../../components/sprints/SprintBoard';

const board = (status: string) => ({ board: { scheduleId: 's1', tasks: [{ id: 'a', name: 'Alpha', status, priority: 'medium' }] } });
const NOPE = { response: { data: { message: 'Nope' } } };

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.getBulkReadiness.mockResolvedValue({ readiness: {} });
  api.getSprintBoard.mockResolvedValue(board('pending'));
  vi.mocked(announce).mockClear();
});
afterEach(() => { cleanup(); });

async function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(<QueryClientProvider client={qc}><SprintBoard sprintId="sp1" canEdit /></QueryClientProvider>);
  await waitFor(() => expect(utils.container.textContent).toContain('Alpha'));
  return utils;
}
/** The label of the column the card is in */
function columnOf(container: HTMLElement, name: string) {
  const card = Array.from(container.querySelectorAll('span')).find(s => s.textContent === name)!;
  return card.closest('.flex-1')!.querySelector('.uppercase')!.textContent;
}
function dropOn(container: HTMLElement, label: string, taskId: string) {
  const header = Array.from(container.querySelectorAll('.uppercase')).find(s => s.textContent === label)!;
  const column = header.closest('.flex-1')!;
  fireEvent.drop(column, { dataTransfer: { getData: () => taskId } });
}

describe('Sprint Board: moving a card', () => {
  it('moves at once, stays after a good save, and then follows the server again', async () => {
    let finish!: (v: unknown) => void;
    api.updateTask.mockImplementation(() => new Promise(r => { finish = r; }));
    const { container } = await setup();
    expect(columnOf(container, 'Alpha')).toBe('Todo');
    act(() => { dropOn(container, 'In Progress', 'a'); });
    expect(columnOf(container, 'Alpha')).toBe('In Progress'); // at once
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('s1', 'a', { status: 'in_progress' }));
    expect(columnOf(container, 'Alpha')).toBe('In Progress'); // still, while saving
    api.getSprintBoard.mockResolvedValue(board('in_progress'));
    await act(async () => { finish({}); });
    await waitFor(() => expect(vi.mocked(announce).mock.calls).toEqual([['"Alpha" moved to In Progress']]));
    expect(columnOf(container, 'Alpha')).toBe('In Progress');
    expect(container.querySelector('[data-testid="sprint-save-error"]')).toBeNull();
  });

  it('a move that does not save puts the card back and says so', async () => {
    api.updateTask.mockRejectedValue(NOPE);
    const { container } = await setup();
    act(() => { dropOn(container, 'In Progress', 'a'); });
    const msg = 'The move of "Alpha" was not saved: Nope. Please try again.';
    await waitFor(() => expect(container.textContent).toContain(msg));
    expect(columnOf(container, 'Alpha')).toBe('Todo');
    expect(announce).toHaveBeenCalledWith(msg);
    fireEvent.click(container.querySelector('button[aria-label="Dismiss error"]')!);
    expect(container.querySelector('[data-testid="sprint-save-error"]')).toBeNull();
  });
});

describe('Sprint Board: story points', () => {
  async function setPoints(container: HTMLElement) {
    fireEvent.click(Array.from(container.querySelectorAll('button')).find(s => s.textContent === '+ pts')!);
    const input = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.blur(input);
  }

  it('points that do not save say so', async () => {
    api.updateSprintTaskPoints.mockRejectedValue(NOPE);
    const { container } = await setup();
    await setPoints(container);
    await waitFor(() => expect(container.textContent).toContain('The story points for "Alpha" were not saved: Nope. Please try again.'));
  });

  it('points that save show no message', async () => {
    api.updateSprintTaskPoints.mockResolvedValue({});
    const { container } = await setup();
    await setPoints(container);
    await waitFor(() => expect(api.updateSprintTaskPoints).toHaveBeenCalledWith('sp1', 'a', 5));
    await act(async () => { await new Promise(r => setTimeout(r, 20)); });
    expect(container.querySelector('[data-testid="sprint-save-error"]')).toBeNull();
  });
});

// Audit 2 H7: the board works without a mouse — a Move menu on each card, and story points
// are a real button (they were a click-only <span>).
describe('Sprint Board: keyboard', () => {
  it('moves a card with the Move menu: arrows choose, Enter picks, focus follows the card', async () => {
    api.updateTask.mockResolvedValue({});
    const { container, getByRole, findByRole } = await setup();
    const move = getByRole('button', { name: 'Move "Alpha" to another column' });
    expect(move.getAttribute('aria-expanded')).toBe('false');
    move.focus();
    fireEvent.click(move); // Enter/Space on a <button> fire click
    const menu = await findByRole('menu', { name: 'Move "Alpha" to' });
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
    // every column but the one it is in
    expect(items.map(i => i.textContent)).toEqual(['In Progress', 'In Review', 'Testing', 'Done']);
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    api.getSprintBoard.mockResolvedValue(board('in_review')); // what the server has after the save
    fireEvent.click(items[1]);
    expect(columnOf(container, 'Alpha')).toBe('In Review');
    await waitFor(() => expect(api.updateTask).toHaveBeenCalledWith('s1', 'a', { status: 'in_review' }));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-move-for')).toBe('a'));
  });

  it('Escape closes the Move menu and puts focus back on the button, moving nothing', async () => {
    const { getByRole, findByRole, queryByRole } = await setup();
    const move = getByRole('button', { name: 'Move "Alpha" to another column' });
    fireEvent.click(move);
    const menu = await findByRole('menu');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(move);
    expect(api.updateTask).not.toHaveBeenCalled();
  });

  it('story points are a named button; Enter in the box saves', async () => {
    api.updateSprintTaskPoints.mockResolvedValue({});
    const { getByRole, getByLabelText } = await setup();
    const points = getByRole('button', { name: 'Story points for "Alpha": none. Edit' });
    fireEvent.click(points);
    const input = getByLabelText('Story points for Alpha') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(api.updateSprintTaskPoints).toHaveBeenCalledWith('sp1', 'a', 3));
  });

  it('a person who cannot change the sprint sees no Move button and no points button', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const utils = render(<QueryClientProvider client={qc}><SprintBoard sprintId="sp1" canEdit={false} /></QueryClientProvider>);
    await waitFor(() => expect(utils.container.textContent).toContain('Alpha'));
    expect(utils.queryByRole('button', { name: /Move "Alpha"/ })).toBeNull();
    expect(utils.queryByRole('button', { name: /Story points/ })).toBeNull();
  });

  it('the Swimlane switch says whether it is on', async () => {
    const { getByTitle } = await setup();
    const sw = getByTitle('Toggle swimlanes by assignee');
    expect(sw.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(sw);
    expect(sw.getAttribute('aria-pressed')).toBe('true');
  });
});
