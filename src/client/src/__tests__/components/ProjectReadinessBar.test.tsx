import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, act } from '@testing-library/react';
import { ProjectReadinessBar } from '../../components/onboarding/ProjectReadinessBar';

const done = {
  tasks: [{ id: 't1', dependency: 't0' }],
  teamCount: 2,
  budgetSet: true,
  riskCount: 1,
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
    render(<ProjectReadinessBar projectId="p2" tasks={[{ id: 't1' }]} teamCount={0} budgetSet={false} riskCount={0} onTabChange={onTabChange} />);
    expect(screen.getByRole('heading', { name: 'Set up this project: 1 of 5 done' })).toBeTruthy();
    // plain words for the linking step; each step says whether it's done
    expect(screen.getByRole('button', { name: /^Tasks: done/ })).toBeTruthy();
    screen.getByRole('button', { name: /^Link tasks: not done yet/ }).click();
    expect(onTabChange).toHaveBeenCalledWith('schedule');
    expect(screen.queryByText('Predecessors')).toBeNull();
  });

  it('one list (the separate "Get Started" card is gone): team, budget and risks steps go where you do them', () => {
    const onTabChange = vi.fn();
    const onEditProject = vi.fn();
    render(<ProjectReadinessBar projectId="p3" tasks={[]} teamCount={1} budgetSet={false} riskCount={0} onTabChange={onTabChange} onEditProject={onEditProject} />);
    expect(screen.getByRole('button', { name: /^Team: done/ })).toBeTruthy();
    screen.getByRole('button', { name: /^Budget: not done yet/ }).click();
    expect(onEditProject).toHaveBeenCalled();
    screen.getByRole('button', { name: /^Risks: not done yet/ }).click();
    expect(onTabChange).toHaveBeenCalledWith('raid');
  });
});
