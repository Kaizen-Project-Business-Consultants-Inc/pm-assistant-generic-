import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Every api call the form (or a panel inside it) might make resolves to an empty answer
vi.mock('../../services/api', () => ({
  apiService: new Proxy({}, { get: (_t, name) => (name === 'getResources' ? async () => ({ resources: [] }) : async () => ({})) }),
}));

import { TaskFormModal } from '../../components/schedule/TaskFormModal';

const base = { id: 't1', name: 'Build API', status: 'in_progress', startDate: '2026-10-12', endDate: '2026-10-16', progressPercentage: 40 };
function open(task: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={qc}><TaskFormModal task={task} allTasks={[task]} onClose={vi.fn()} onSave={vi.fn()} /></QueryClientProvider>);
}

/** % complete from approved hours: the edit form follows the server's answer while dates and people are as saved */
describe('task form — is % complete typed or from approved hours?', () => {
  afterEach(cleanup);

  it('locked when the server says so, even with nobody in "Assigned to" (an hours booking only)', () => {
    open({ ...base, progressFromHours: true });
    expect(screen.getByText(/From approved hours/)).toBeTruthy();
  });

  it('typed when the server says so, even though "Assigned to" holds an old name that is no resource', () => {
    open({ ...base, assignedTo: 'Old Name', progressFromHours: false });
    expect(screen.queryByText(/From approved hours/)).toBeNull();
  });

  it("once the dates change in the form, the screen's own rule decides (nobody planned → typed)", () => {
    open({ ...base, progressFromHours: true });
    expect(screen.getByText(/From approved hours/)).toBeTruthy();
    const start = document.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(start, { target: { value: '2026-10-13' } });
    expect(screen.queryByText(/From approved hours/)).toBeNull();
  });
});
