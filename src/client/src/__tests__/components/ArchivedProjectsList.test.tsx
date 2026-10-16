import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

const unarchive = vi.fn(async (_id: string) => ({}));
vi.mock('../../services/api', () => ({ apiService: { unarchiveProject: (id: string) => unarchive(id) } }));

import { ArchivedProjectsList } from '../../components/pm/ArchivedProjectsList';
import type { ProjectSummaryPM } from '../../types/pm';

const project = (n: number): ProjectSummaryPM => ({
  id: `p${n}`, name: `Old project ${n}`, client: n === 1 ? 'Acme' : '', code: `PRJ-${n}`, status: 'completed', priority: 'medium',
  projectType: 'construction', methodology: 'waterfall', healthScore: 80, progress: 100, budgetAllocated: 0, budgetSpent: 0,
  endDate: '2026-11-21', archivedAt: '2026-10-15 10:00:00', canEdit: true,
} as ProjectSummaryPM);

function show(projects: ProjectSummaryPM[], canRestore = true) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ArchivedProjectsList projects={projects} canRestore={canRestore} /></MemoryRouter></QueryClientProvider>);
}

describe('archived projects as compact rows (U1)', () => {
  afterEach(() => { cleanup(); unarchive.mockClear(); });

  it('starts folded with the count; opening shows one row per project with its client, type and dates', () => {
    show([project(1), project(2)]);
    const toggle = screen.getByRole('button', { name: /Archived \(2\)/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('table')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getAllByRole('row')).toHaveLength(3); // heading + 2
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.getAllByText('Construction').length).toBeGreaterThan(0);
  });

  it('Restore brings a project back; hidden for someone who cannot change data or does not manage that project', async () => {
    show([project(1)]);
    fireEvent.click(screen.getByRole('button', { name: /Archived/ }));
    fireEvent.click(screen.getByRole('button', { name: /Restore Old project 1/ }));
    await waitFor(() => expect(unarchive).toHaveBeenCalledWith('p1'));
    cleanup();
    show([project(1)], false);
    fireEvent.click(screen.getByRole('button', { name: /Archived/ }));
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
    cleanup();
    show([{ ...project(1), canEdit: false }]);
    fireEvent.click(screen.getByRole('button', { name: /Archived/ }));
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
    expect(screen.getByRole('link', { name: /Open Old project 1/ })).toBeTruthy();
  });

  it('25 to a page', () => {
    show(Array.from({ length: 30 }, (_, i) => project(i + 1)));
    fireEvent.click(screen.getByRole('button', { name: /Archived \(30\)/ }));
    expect(screen.getAllByRole('row')).toHaveLength(26);
    expect(screen.getByText('1–25 of 30')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  it('nothing archived: nothing shown', () => {
    const { container } = show([]);
    expect(container.textContent).toBe('');
  });
});
