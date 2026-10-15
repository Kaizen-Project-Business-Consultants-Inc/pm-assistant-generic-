import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ProjectReadinessBar } from '../../components/onboarding/ProjectReadinessBar';

const done = {
  tasks: [{ id: 't1', dependency: 't0' }],
  resources: [{ id: 'r1' }],
};

describe('ProjectReadinessBar', () => {
  beforeEach(() => { localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('hides itself 3s after every step is done, without crashing', () => {
    // Before the fix this threw React #300 ("rendered fewer hooks") and took down the project page
    const { container } = render(<ProjectReadinessBar projectId="p1" {...done} onTabChange={() => {}} />);
    expect(container.textContent).not.toBe('');
    act(() => { vi.advanceTimersByTime(3000); });
    expect(container.textContent).toBe('');
    expect(localStorage.getItem('readiness-dismissed-p1')).toBe('1');
  });

  it('stays hidden once dismissed', () => {
    localStorage.setItem('readiness-dismissed-p1', '1');
    const { container } = render(<ProjectReadinessBar projectId="p1" {...done} onTabChange={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('says what it is and how far along, so it is not read as a menu (U14)', () => {
    const onTabChange = vi.fn();
    render(<ProjectReadinessBar projectId="p2" tasks={[{ id: 't1' }]} resources={[]} onTabChange={onTabChange} />);
    expect(screen.getByRole('heading', { name: 'Set up this project: 1 of 3 done' })).toBeTruthy();
    // plain words for the linking step; each step says whether it's done
    expect(screen.getByRole('button', { name: /^Tasks: done/ })).toBeTruthy();
    screen.getByRole('button', { name: /^Link tasks: not done yet/ }).click();
    expect(onTabChange).toHaveBeenCalledWith('schedule');
    expect(screen.queryByText('Predecessors')).toBeNull();
  });
});
