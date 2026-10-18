import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  proposeScheduleFixes: vi.fn(),
  applyScheduleFixes: vi.fn(),
  undoScheduleFixProposal: vi.fn(),
  rejectScheduleFixProposal: vi.fn(),
  previewScheduleFixes: vi.fn(async () => ({ tasksMoved: 0, finishBefore: null, finishAfter: null, finishShiftDays: 0, projectEnd: null, scoreBefore: 22, scoreAfter: 30 })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { ScheduleFixProposalPanel } from '../../components/schedule/review/ScheduleFixProposalPanel';

const link = (i: number, severity: string) => ({
  id: `d${i}`, type: 'add_dependency', confidence: 0.75, reason: 'seq', defaultChecked: true, severity,
  taskId: `b${i}`, taskName: `Build ${i}`, dependsOnTaskId: `a${i}`, dependsOnTaskName: `Design ${i}`,
});
const rename = {
  id: 'r1', type: 'rename_task', confidence: 0.6, reason: 'code', defaultChecked: true, severity: 'low',
  taskId: 'h1', taskName: 'T1', newName: 'Task 1 – Kick-Off Meeting',
};
const PROPOSAL = {
  id: 'prop-1', source: 'rules',
  proposalData: { fixes: [link(1, 'critical'), ...[2, 3, 4, 5, 6, 7].map(i => link(i, 'high')), rename] },
};

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ScheduleFixProposalPanel scheduleId="s1" projectId="p1" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => { api.proposeScheduleFixes.mockResolvedValue(PROPOSAL); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ScheduleFixProposalPanel', () => {
  it('groups by level, Critical first, with nothing ticked and Apply disabled', async () => {
    renderPanel();
    const sections = await screen.findAllByRole('region');
    expect(sections.map(s => s.getAttribute('aria-label'))).toEqual(['Critical fixes', 'High fixes', 'Low fixes']);
    expect(screen.getAllByRole('checkbox').every(c => !(c as HTMLInputElement).checked)).toBe(true);
    expect(screen.getByRole('button', { name: /Apply 0 fixes/ })).toBeDisabled();
    // a long group shows five rows and offers the rest
    expect(screen.getByRole('button', { name: 'Show 1 more' })).toBeInTheDocument();
  });

  it('Select all in a level ticks that level only; the Apply button counts by level', async () => {
    renderPanel();
    const high = await screen.findByLabelText('Select all in High');
    fireEvent.click(high);
    expect(screen.getByRole('button', { name: 'Apply 6 fixes (6 high)' })).toBeEnabled();
    fireEvent.click(screen.getByLabelText(/Select: Link 'Build 1'/));
    expect(screen.getByRole('button', { name: 'Apply 7 fixes (1 critical, 6 high)' })).toBeInTheDocument();
    // partly selected level shows as indeterminate
    fireEvent.click(screen.getByLabelText(/Select: Link 'Build 2'/));
    expect((screen.getByLabelText('Select all in High') as HTMLInputElement).indeterminate).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));
    expect(screen.getByRole('button', { name: /Apply 0 fixes/ })).toBeDisabled();
  });

  it('sends the edited name for a selected rename; an empty name cannot be applied', async () => {
    api.applyScheduleFixes.mockResolvedValue({
      beforeScore: 22, afterScore: 48, appliedCount: 1, datesMoved: 0, dateDeltas: [],
      skipped: [{ fixId: 'x1', reason: 'task not found' }, { fixId: 'x2', reason: 'task not found' }],
      afterCounts: { critical: 1, high: 17, medium: 0, low: 3 },
    });
    renderPanel();
    const box = await screen.findByLabelText('New name for T1');
    expect(box).toHaveValue('Task 1 – Kick-Off Meeting');
    fireEvent.change(box, { target: { value: '' } });
    expect(screen.getByLabelText("Select: rename 'T1'")).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Apply 7 fixes (1 critical, 6 high)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }));

    fireEvent.change(box, { target: { value: '  Task 1 – Kick-off  ' } });
    fireEvent.click(screen.getByLabelText("Select: rename 'T1'"));
    fireEvent.click(screen.getByRole('button', { name: 'Apply 1 fix (1 low)' }));
    await waitFor(() => expect(api.applyScheduleFixes).toHaveBeenCalledWith('s1', 'prop-1', ['r1'], { r1: 'Task 1 – Kick-off' }));

    // the result leads with the score, then what is left
    expect(await screen.findByText(/22 → 48/)).toBeInTheDocument();
    expect(screen.getByText('Applied 1 fix · score up 26 points')).toBeInTheDocument();
    expect(screen.getByText('Still to do: 1 critical · 17 high · 3 low')).toBeInTheDocument();
    expect(screen.getByText('2 skipped: task not found.')).toBeInTheDocument();
  });

  it('emptying a ticked rename unticks it, and typing again does not tick it back', async () => {
    renderPanel();
    const box = await screen.findByLabelText('New name for T1');
    const tick = screen.getByLabelText("Select: rename 'T1'") as HTMLInputElement;
    fireEvent.click(tick);
    expect(tick.checked).toBe(true);
    fireEvent.change(box, { target: { value: '' } });
    fireEvent.change(box, { target: { value: 'Task 1 – Kick-off' } });
    expect(tick.checked).toBe(false);
    expect(screen.getByRole('button', { name: /Apply 0 fixes/ })).toBeDisabled();
  });

  it('more than 200 ticked: Apply is off and says why', async () => {
    api.proposeScheduleFixes.mockResolvedValue({
      id: 'prop-2', source: 'rules', proposalData: { fixes: Array.from({ length: 201 }, (_, i) => link(i, 'low')) },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Select all' }));
    expect(screen.getByRole('button', { name: 'Apply up to 200 fixes at a time' })).toBeDisabled();
  });
});
