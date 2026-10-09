/**
 * Backlog "Assign to Sprint" (2026-10-09). The sprint endpoint takes one task at a time and has
 * no list form, so the selected items are added one after another, in order, and the first one
 * the server refuses stops the rest (the loop is kept on purpose; see the eslint reason there).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  getSchedules: vi.fn(),
  getBacklogTasks: vi.fn(),
  getSprints: vi.fn(),
  getBulkReadiness: vi.fn(),
  addSprintTask: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { BacklogView } from '../../components/backlog/BacklogView';

const TASKS = ['Alpha', 'Beta', 'Gamma'].map((name, i) => ({
  id: `t${i}`, name, status: 'pending', priority: 'medium', assignedTo: null, dueDate: null, estimatedDays: null, progressPercentage: 0,
}));

beforeEach(() => {
  for (const f of Object.values(api)) f.mockReset();
  api.getSchedules.mockResolvedValue({ schedules: [{ id: 's1', name: 'Plan' }] });
  api.getBacklogTasks.mockResolvedValue({ tasks: TASKS });
  api.getSprints.mockResolvedValue({ data: [{ id: 'sp1', name: 'Sprint 1', status: 'planning' }] });
  api.getBulkReadiness.mockResolvedValue({ readiness: {} });
});
afterEach(() => { cleanup(); });

async function selectAllAndAssign() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const utils = render(<QueryClientProvider client={qc}><BacklogView projectId="p1" /></QueryClientProvider>);
  await waitFor(() => expect(utils.container.textContent).toContain('Gamma'));
  fireEvent.click(utils.getByLabelText('Select all items'));
  await waitFor(() => expect(utils.getByLabelText('Sprint to add the selected items to')).toBeTruthy());
  await waitFor(() => expect(utils.container.querySelector('option[value="sp1"]')).toBeTruthy());
  fireEvent.change(utils.getByLabelText('Sprint to add the selected items to'), { target: { value: 'sp1' } });
  act(() => { fireEvent.click(utils.getByText('Assign to Sprint')); });
  return utils;
}

describe('Backlog: Assign to Sprint', () => {
  it('adds each selected item, one after another, in order', async () => {
    const pending: Array<(v: unknown) => void> = [];
    api.addSprintTask.mockImplementation(() => new Promise(resolve => { pending.push(resolve); }));
    await selectAllAndAssign();
    await waitFor(() => expect(api.addSprintTask).toHaveBeenCalledTimes(1));
    expect(api.addSprintTask).toHaveBeenLastCalledWith('sp1', 't0');
    await act(async () => { pending[0]({}); });
    await waitFor(() => expect(api.addSprintTask).toHaveBeenCalledTimes(2));
    await act(async () => { pending[1]({}); });
    await waitFor(() => expect(api.addSprintTask).toHaveBeenCalledTimes(3));
    await act(async () => { pending[2]({}); });
    expect(api.addSprintTask.mock.calls).toEqual([['sp1', 't0'], ['sp1', 't1'], ['sp1', 't2']]);
  });

  it('stops at the first item the server refuses', async () => {
    api.addSprintTask.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('Nope')).mockResolvedValue({});
    await selectAllAndAssign();
    await waitFor(() => expect(api.addSprintTask).toHaveBeenCalledTimes(2));
    await act(async () => { await new Promise(r => { setTimeout(r, 20); }); });
    expect(api.addSprintTask).toHaveBeenCalledTimes(2);
  });
});
