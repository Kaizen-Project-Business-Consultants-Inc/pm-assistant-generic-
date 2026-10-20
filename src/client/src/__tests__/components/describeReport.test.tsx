import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Report Builder in plain words (2026-10-20, approved mock https://claude.ai/artifact/5UUmYUEJesdXfuhx8V1B5m):
 * type → draft with figures → change it → nothing saved until Save report.
 */
const api = vi.hoisted(() => ({
  getProjects: vi.fn(async () => ({ data: [{ id: 'p-portal', name: 'Customer Portal Upgrade' }] })),
  draftReportFromWords: vi.fn(),
  previewReportSections: vi.fn(),
  createReportTemplate: vi.fn(async () => ({ template: { id: 't1' } })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { DescribeReport } from '../../components/reports/DescribeReport';

const OVERDUE = { title: 'Overdue tasks by owner', type: 'table', dataSource: 'tasks', filters: { projectId: 'p-portal', overdue: true }, groupBy: 'assignee' };
const BUDGET = { title: 'Budget: spent vs allocated', type: 'kpi_card', dataSource: 'budgets', filters: { projectId: 'p-portal' } };

function renderIt(resume?: Record<string, unknown>[]) {
  const onStartBlank = vi.fn(); const onEditByHand = vi.fn(); const onSaved = vi.fn(); const onDone = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><DescribeReport onStartBlank={onStartBlank} onEditByHand={onEditByHand} onSaved={onSaved} resume={resume} onDone={onDone} /></QueryClientProvider>);
  return { onStartBlank, onEditByHand, onSaved, onDone };
}

beforeEach(() => {
  api.draftReportFromWords.mockResolvedValue({ draft: { sections: [OVERDUE, BUDGET], notDone: ['Risks per owner needs its own section.'] } });
  api.previewReportSections.mockResolvedValue({ report: { sections: [
    { title: 'Overdue tasks by owner', type: 'table', data: { table: { headers: ['Person', 'Count', 'Most late (days)'], rows: [['Priya Nair', 3, 12]] } } },
    { title: 'Budget: spent vs allocated', type: 'kpi_card', data: { kpis: [{ label: 'Total Spent', value: 84500 }] } },
  ] } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function buildDraft() {
  fireEvent.change(screen.getByLabelText(/Say what to show/), { target: { value: 'Overdue tasks by owner for Customer Portal, plus budget' } });
  fireEvent.click(screen.getByRole('button', { name: 'Build draft' }));
  await screen.findByText('Draft — not saved.');
}

describe('DescribeReport', () => {
  it('builds a draft with figures, says how each part was built and what was left out — nothing saved', async () => {
    renderIt();
    await buildDraft();
    expect(api.draftReportFromWords).toHaveBeenCalledWith('Overdue tasks by owner for Customer Portal, plus budget', undefined);
    await waitFor(() => expect(api.previewReportSections).toHaveBeenCalledWith([OVERDUE, BUDGET]));
    expect(await screen.findByText('Priya Nair')).toBeInTheDocument();
    expect(screen.getByText('Table · Tasks · Customer Portal Upgrade · overdue only · grouped by person')).toBeInTheDocument();
    expect(screen.getByText('Risks per owner needs its own section.')).toBeInTheDocument();
    expect(api.createReportTemplate).not.toHaveBeenCalled();
  });

  it('Save report asks for a name, then saves the draft as a template', async () => {
    const { onSaved } = renderIt();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Save report' }));
    fireEvent.change(screen.getByLabelText('Report name'), { target: { value: 'Portal weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createReportTemplate).toHaveBeenCalledWith({ name: 'Portal weekly', config: { sections: [OVERDUE, BUDGET] } }));
    expect(onSaved).toHaveBeenCalled();
    // the draft is gone: no second Save to make a copy
    expect(await screen.findByRole('button', { name: 'Build draft' })).toBeInTheDocument();
    expect(screen.queryByText('Draft — not saved.')).toBeNull();
  });

  it('figures that arrive for an older draft are not shown under the new one', async () => {
    let finishOld!: (v: unknown) => void;
    api.previewReportSections.mockImplementationOnce(() => new Promise(r => { finishOld = r; }));
    renderIt();
    await buildDraft();
    // remove a section while the first figures are still loading: they are asked again for the new list
    api.previewReportSections.mockResolvedValueOnce({ report: { sections: [
      { title: 'Overdue tasks by owner', type: 'table', data: { table: { headers: ['Person', 'Count'], rows: [['Marcus Reed', 2]] } } },
    ] } });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Budget: spent vs allocated' }));
    expect(await screen.findByText('Marcus Reed')).toBeInTheDocument();
    // the old answer (2 sections) lands late: ignored
    finishOld({ report: { sections: [
      { title: 'Overdue tasks by owner', type: 'table', data: { table: { headers: ['Person', 'Count'], rows: [['Old figure', 9]] } } },
      { title: 'Budget', type: 'kpi_card', data: { kpis: [] } },
    ] } });
    await new Promise(r => { setTimeout(r, 0); });
    expect(screen.queryByText('Old figure')).toBeNull();
    expect(screen.getByText('Marcus Reed')).toBeInTheDocument();
  });

  it('back from Edit without saving, the draft is shown again with its figures', async () => {
    renderIt([OVERDUE, BUDGET]);
    expect(screen.getByText('Draft — not saved.')).toBeInTheDocument();
    await waitFor(() => expect(api.previewReportSections).toHaveBeenCalledWith([OVERDUE, BUDGET]));
    expect(await screen.findByText('Priya Nair')).toBeInTheDocument();
  });

  it('Discard tells the page the draft is gone', async () => {
    const { onDone } = renderIt();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('Remove drops a section; Edit opens the whole draft by hand; Discard saves nothing', async () => {
    const { onEditByHand } = renderIt();
    await buildDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Budget: spent vs allocated' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit Overdue tasks by owner' }));
    expect(onEditByHand).toHaveBeenCalledWith([OVERDUE]);
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(screen.getByRole('button', { name: 'Build draft' })).toBeInTheDocument();
    expect(api.createReportTemplate).not.toHaveBeenCalled();
  });

  it('Change it by typing sends the current draft with the change', async () => {
    renderIt();
    await buildDraft();
    fireEvent.change(screen.getByLabelText(/Change it by typing/), { target: { value: 'make the chart a pie' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update draft' }));
    await waitFor(() => expect(api.draftReportFromWords).toHaveBeenLastCalledWith('make the chart a pie', [OVERDUE, BUDGET]));
  });

  it("the server's reason is shown when a draft can't be made (no AI left)", async () => {
    api.draftReportFromWords.mockRejectedValueOnce({ response: { data: { message: "You've used this month's AI." } } });
    renderIt();
    fireEvent.change(screen.getByLabelText(/Say what to show/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Build draft' }));
    expect(await screen.findByText("You've used this month's AI.")).toBeInTheDocument();
  });

  it('Start from blank opens the hand-built path', () => {
    const { onStartBlank } = renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'Start from blank' }));
    expect(onStartBlank).toHaveBeenCalled();
  });
});
