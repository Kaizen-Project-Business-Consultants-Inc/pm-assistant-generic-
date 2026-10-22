// @vitest-environment happy-dom
/**
 * Kanban speed fixes (2026-10-11): the columns are worked out once per tasks change (one pass,
 * same order as before), cards are memoised so dragging over the board does not re-render every
 * card, and moving the pointer onto a card inside a column no longer clears and re-sets the
 * column highlight (two board renders per card edge).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, createEvent, screen } from '@testing-library/react';

const avatarRenders = vi.hoisted(() => ({ n: 0 }));
vi.mock('../../components/ui/Avatar', () => ({
  Avatar: ({ name }: { name: string }) => { avatarRenders.n++; return <span data-testid="avatar">{name}</span>; },
}));

import { KanbanBoard, groupTasksByStatus, type KanbanTask } from '../../components/schedule/KanbanBoard';

const TASKS: KanbanTask[] = [
  { id: 'a', name: 'Alpha', status: 'pending', priority: 'low', assignedTo: 'Ann' },
  { id: 'b', name: 'Bravo', status: 'pending', priority: 'urgent', assignedTo: 'Ben' },
  { id: 'c', name: 'Charlie', status: 'in_progress', assignedTo: 'Cy' },
  { id: 'd', name: 'Delta', status: 'pending', assignedTo: 'Di' },
  { id: 'e', name: 'Echo', status: 'pending', priority: 'medium', assignedTo: 'Ed' },
  { id: 'x', name: 'Odd', status: 'not_a_column' },
];

afterEach(() => { cleanup(); avatarRenders.n = 0; });

// a dragleave whose pointer went to `to` (the test DOM's DragEvent drops relatedTarget from its init)
function leave(from: HTMLElement, to: Element) {
  const ev = createEvent.dragLeave(from);
  Object.defineProperty(ev, 'relatedTarget', { value: to });
  fireEvent(from, ev);
}

describe('groupTasksByStatus', () => {
  it('matches the old filter + sort per column: priority order, ties keep plan order, unknown statuses left out', () => {
    const g = groupTasksByStatus(TASKS);
    expect(g.pending.map(t => t.id)).toEqual(['b', 'd', 'e', 'a']);
    expect(g.in_progress.map(t => t.id)).toEqual(['c']);
    expect(g.completed).toEqual([]);
    expect(Object.keys(g)).toEqual(['pending', 'in_progress', 'in_review', 'testing', 'completed', 'blocked', 'cancelled']);
    expect(Object.values(g).flat().some(t => t.id === 'x')).toBe(false);
  });
});

describe('KanbanBoard drag highlight and card re-renders', () => {
  const column = (container: HTMLElement, label: string) =>
    [...container.querySelectorAll('div.rounded-lg.border')].find(el => el.querySelector('span')?.textContent === label) as HTMLElement;

  it('dragging over a column highlights it without re-rendering the cards', () => {
    const { container } = render(<KanbanBoard tasks={TASKS} onTaskClick={() => {}} onStatusChange={() => {}} />);
    const before = avatarRenders.n;
    const col = column(container, 'Pending');
    fireEvent.dragOver(col, { dataTransfer: { dropEffect: '' } });
    expect(col.className).toContain('ring-primary-400');
    fireEvent.dragOver(col, { dataTransfer: { dropEffect: '' } });
    expect(avatarRenders.n).toBe(before);
  });

  it('moving onto a card inside the column keeps the highlight; leaving the column clears it', () => {
    const { container, getByText } = render(<KanbanBoard tasks={TASKS} onStatusChange={() => {}} />);
    const col = column(container, 'Pending');
    fireEvent.dragOver(col, { dataTransfer: { dropEffect: '' } });
    leave(col, getByText('Alpha'));
    expect(col.className).toContain('ring-primary-400');
    leave(col, document.body);
    expect(col.className).not.toContain('ring-primary-400');
  });

  it('a new onTaskClick each render does not re-render the cards, and the latest one is called', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, getByText } = render(<KanbanBoard tasks={TASKS} onTaskClick={first} />);
    const before = avatarRenders.n;
    rerender(<KanbanBoard tasks={TASKS} onTaskClick={second} />);
    expect(avatarRenders.n).toBe(before);
    fireEvent.click(getByText('Bravo'));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(TASKS[1]);
  });

  it('changing the active task re-renders only the cards whose look changes', () => {
    const { rerender } = render(<KanbanBoard tasks={TASKS} activeTaskId="a" />);
    const before = avatarRenders.n;
    rerender(<KanbanBoard tasks={TASKS} activeTaskId="b" />);
    expect(avatarRenders.n - before).toBe(2);
  });
});

/** Review 2026-10-11: the cards were click-only divs; now each is a button the keyboard can open */
describe('Kanban cards: keyboard', () => {
  it('a card is a named button in the Tab order with a focus ring; Enter and Space open it, other keys do not', () => {
    const onTaskClick = vi.fn();
    render(<KanbanBoard tasks={TASKS} onTaskClick={onTaskClick} onStatusChange={() => {}} />);
    const card = screen.getByRole('button', { name: /^Open Bravo, urgent priority, Ben$/ });
    expect(card.tabIndex).toBe(0);
    expect(card.className).toContain('focus-visible:ring-2');
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    fireEvent.keyDown(card, { key: 'a' });
    expect(onTaskClick.mock.calls.map(c => c[0].id)).toEqual(['b', 'b']);
    fireEvent.click(card);
    expect(onTaskClick).toHaveBeenCalledTimes(3);
  });

  it('a swimlane card is a button too', () => {
    const onTaskClick = vi.fn();
    render(<KanbanBoard tasks={TASKS} onTaskClick={onTaskClick} onStatusChange={() => {}} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Swimlane' }), { target: { value: 'assignee' } });
    const card = screen.getByRole('button', { name: 'Open Charlie' });
    expect(card.tabIndex).toBe(0);
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onTaskClick.mock.calls.map(c => c[0].id)).toEqual(['c']);
  });
});

describe('Overbooked people on the board (U65, 2026-10-21)', () => {
  it('a card that overbooks someone says who and when; the others say nothing', () => {
    render(<KanbanBoard tasks={TASKS} overbookedNotes={new Map([['b', ['Ben 140% (week of 3 Nov)']]])} />);
    expect(screen.getByText('Ben 140% (week of 3 Nov)')).toBeInTheDocument();
    expect(screen.queryAllByText(/%\s\(week of/)).toHaveLength(1);
    // a screen reader hears it too: the card's name carries the note
    expect(screen.getByRole('button', { name: /Open Bravo.*overbooked: Ben 140% \(week of 3 Nov\)/ })).toBeInTheDocument();
  });
});
