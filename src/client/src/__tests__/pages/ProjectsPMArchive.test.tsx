import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const projects = [
  { id: 'a1', name: 'Live build', status: 'active', canEdit: true },
  { id: 'z1', name: 'Old fit-out', status: 'completed', archivedAt: '2026-10-01 09:00:00', canEdit: true },
  { id: 'z2', name: 'Old survey', status: 'completed', archivedAt: '2026-10-10 09:00:00', canEdit: true },
];
vi.mock('../../services/api', () => ({
  apiService: {
    getProjects: vi.fn(async (_scope: string, archived: boolean) => ({ data: archived ? projects : projects.filter(p => !p.archivedAt) })),
    getDashboardPredictions: vi.fn(async () => ({})),
    getProjectGroups: vi.fn(async () => ({ groups: [] })),
  },
}));
vi.mock('../../components/templates/TemplatePicker', () => ({ TemplatePicker: () => null }));
vi.mock('../../components/projects/ProjectGroupManager', () => ({ ProjectGroupManager: () => null }));
vi.mock('../../hooks/useViewPreferences', () => ({ getViewPref: () => 'card', setViewPref: vi.fn() }));
vi.mock('../../hooks/useCanChangeData', () => ({ useCanChangeData: () => true, canChangeData: () => true }));
vi.mock('../../hooks/useCanManageClients', () => ({ useCanManageClients: () => false }));

import { ProjectsPM } from '../../pages/ProjectsPM';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ProjectsPM /></MemoryRouter></QueryClientProvider>);
}

describe('Projects page: archived projects leave the active list (U1)', () => {
  afterEach(cleanup);

  it('Show archived keeps the active cards and adds an Archived section, newest first', async () => {
    show();
    expect(await screen.findByText('Live build')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Show Archived/i }));
    expect(await screen.findByText(/1 active · 2 archived/, {}, { timeout: 4000 })).toBeTruthy();
    // archived ones are not cards in the active grid: folded away until opened
    expect(screen.queryByText('Old fit-out')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Archived \(2\)/ }));
    const names = screen.getAllByRole('row').slice(1).map(r => r.querySelector('a')?.textContent);
    expect(names).toEqual(['Old survey', 'Old fit-out']);
  });

  it('the Cards / List switch says which is on', async () => {
    show();
    await screen.findByText('Live build');
    expect(screen.getByRole('button', { name: 'Cards' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true');
  });
});
