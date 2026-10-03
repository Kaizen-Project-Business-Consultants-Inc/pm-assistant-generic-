import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  getSampleProject: vi.fn(),
  removeSampleProject: vi.fn(),
  loadSampleProject: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { SampleProjectTab } from '../../pages/settings/SampleProjectTab';

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SampleProjectTab /></QueryClientProvider>);
}

/** Settings → Sample project (Oct 2026): removing asks first, in the page; loading is one click */
describe('Settings → Sample project', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('Remove asks for confirmation in the page and only then removes', async () => {
    api.getSampleProject.mockResolvedValue({ loaded: true, canManage: true });
    api.removeSampleProject.mockResolvedValue({ loaded: false, removed: 40 });
    show();
    expect(await screen.findByText('Loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    expect(api.removeSampleProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Yes, remove sample data')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Remove…' }));
    fireEvent.click(screen.getByRole('button', { name: /Yes, remove sample data/ }));
    await waitFor(() => expect(api.removeSampleProject).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('status')).toBeTruthy();
  });

  it('when not loaded, offers Load', async () => {
    api.getSampleProject.mockResolvedValue({ loaded: false, canManage: true });
    api.loadSampleProject.mockResolvedValue({ loaded: true });
    show();
    expect(await screen.findByText('Not loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    await waitFor(() => expect(api.loadSampleProject).toHaveBeenCalledTimes(1));
  });

  it('a refusal shows the server message', async () => {
    api.getSampleProject.mockResolvedValue({ loaded: false, canManage: true });
    api.loadSampleProject.mockRejectedValue({ response: { data: { message: 'Only the company owner or an admin can load or remove the sample project.' } } });
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Load' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/company owner or an admin/);
  });
});
