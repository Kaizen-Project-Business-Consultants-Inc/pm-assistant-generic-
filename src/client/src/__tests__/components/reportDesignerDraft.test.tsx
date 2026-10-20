import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * 2026-10-20: a draft made from typed words opens in the designer (Edit), and the designer keeps
 * and shows the new "Overdue only" filter so saving from there doesn't drop it.
 */
const api = vi.hoisted(() => ({
  getProjects: vi.fn(async () => ({ data: [{ id: 'p-portal', name: 'Customer Portal Upgrade' }] })),
  getReportTemplate: vi.fn(),
  createReportTemplate: vi.fn(async () => ({})),
  updateReportTemplate: vi.fn(async () => ({})),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { ReportDesigner } from '../../components/reports/ReportDesigner';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('ReportDesigner with a draft', () => {
  it('opens the draft sections, keeps Overdue only ticked, and saves it', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={qc}>
        <ReportDesigner
          initialSections={[{ title: 'Overdue tasks by owner', type: 'table', dataSource: 'tasks', filters: { projectId: 'p-portal', overdue: true }, groupBy: 'assignee' }]}
          onClose={vi.fn()}
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    );
    const tick = await screen.findByLabelText(/Overdue only/);
    expect(tick).toBeChecked();
    expect(screen.getByDisplayValue('Overdue tasks by owner')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Template Name|Report Name|^Name/i), { target: { value: 'Portal weekly' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Template' }));
    await waitFor(() => expect(api.createReportTemplate).toHaveBeenCalled());
    const saved = (api.createReportTemplate.mock.calls[0] as unknown as [{ config: { sections: Array<{ filters: { overdue?: boolean } }> } }])[0];
    expect(saved.config.sections[0].filters.overdue).toBe(true);
  });
});
