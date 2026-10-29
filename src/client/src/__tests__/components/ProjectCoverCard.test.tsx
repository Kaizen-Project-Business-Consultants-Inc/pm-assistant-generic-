/**
 * Cover while a project's PM is away (2026-10-29): who sees the card, the plain confirmation when the
 * person picked can't normally edit, what gets sent, and the banner for the Owner and for the cover.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({
  getProjectCover: vi.fn(),
  startProjectCover: vi.fn(),
  endProjectCover: vi.fn(),
  reassignProjectOwner: vi.fn(),
  getOrgMembers: vi.fn(),
  getProjectMembers: vi.fn(),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { ProjectCoverCard, ProjectCoverBanner } from '../../pages/ProjectDetailPage/ProjectCoverCard';

const wrap = (ui: React.ReactElement) => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>,
);
const people = [
  { id: 'dana', fullName: 'Dana Reid', email: 'dana@x.io', role: 'project_manager', isActive: true },
  { id: 'sam', fullName: 'Sam Okafor', email: 'sam@x.io', role: 'viewer', isActive: true },
  { id: 'priya', fullName: 'Priya Nair', email: 'priya@x.io', role: 'project_manager', isActive: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getOrgMembers.mockResolvedValue({ members: people });
  api.getProjectMembers.mockResolvedValue({ members: [{ userId: 'dana', userName: 'Dana Reid', role: 'owner' }] });
  api.startProjectCover.mockResolvedValue({ cover: {} });
});
afterEach(() => { cleanup(); });

describe('ProjectCoverCard', () => {
  it('shows nothing to a person who may not manage cover when there is none', async () => {
    api.getProjectCover.mockResolvedValue({ cover: null, canManage: false, canHandOver: false });
    const { container } = wrap(<ProjectCoverCard projectId="p1" />);
    await waitFor(() => expect(api.getProjectCover).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('shows the current cover, read-only, to everyone else', async () => {
    api.getProjectCover.mockResolvedValue({
      cover: { id: 'c1', coverUserId: 'sam', coverUserName: 'Sam Okafor', startDate: '2026-11-02', endDate: '2026-11-12', active: true, ownerUserId: 'dana' },
      canManage: false, canHandOver: false,
    });
    wrap(<ProjectCoverCard projectId="p1" />);
    expect(await screen.findByText('Sam Okafor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /end cover now/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /start cover/i })).toBeNull();
  });

  it('says in plain words that a viewer will edit this project only, and sends the choice', async () => {
    api.getProjectCover.mockResolvedValue({ cover: null, canManage: true, canHandOver: false });
    wrap(<ProjectCoverCard projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start cover' }));
    const who = await screen.findByLabelText('Who covers?');
    await waitFor(() => expect(screen.getByRole('option', { name: /Sam Okafor/ })).toBeTruthy());
    expect(screen.queryByRole('option', { name: /Dana Reid/ })).toBeNull(); // the Owner can't cover for themselves
    fireEvent.change(who, { target: { value: 'sam' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-02' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-11-12' } });
    expect((await screen.findByRole('note')).textContent).toMatch(/Sam is a viewer.*this project only.*Up to 90 days/);
    fireEvent.click(screen.getByRole('button', { name: /Let Sam edit until/ }));
    await waitFor(() => expect(api.startProjectCover).toHaveBeenCalledWith('p1', { coverUserId: 'sam', startDate: '2026-11-02', endDate: '2026-11-12' }));
  });

  it('does not warn for someone who can already edit', async () => {
    api.getProjectCover.mockResolvedValue({ cover: null, canManage: true, canHandOver: false });
    wrap(<ProjectCoverCard projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start cover' }));
    await waitFor(() => expect(screen.getByRole('option', { name: /Priya Nair/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Who covers?'), { target: { value: 'priya' } });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start cover', hidden: false })).toBeTruthy();
  });

  it('shows the server\'s reason when cover is refused', async () => {
    api.getProjectCover.mockResolvedValue({ cover: null, canManage: true, canHandOver: false });
    api.startProjectCover.mockRejectedValue({ response: { data: { message: 'This project already has cover in those dates.' } } });
    wrap(<ProjectCoverCard projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start cover' }));
    await waitFor(() => expect(screen.getByRole('option', { name: /Priya Nair/ })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Who covers?'), { target: { value: 'priya' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Start cover', hidden: false }).closest('form')!);
    expect((await screen.findByRole('alert')).textContent).toMatch(/already has cover/);
  });

  it('ends cover now', async () => {
    api.getProjectCover.mockResolvedValue({
      cover: { id: 'c1', coverUserId: 'sam', coverUserName: 'Sam Okafor', startDate: '2026-11-02', endDate: '2026-11-12', active: true, ownerUserId: 'dana' },
      canManage: true, canHandOver: false,
    });
    api.endProjectCover.mockResolvedValue({});
    wrap(<ProjectCoverCard projectId="p1" />);
    fireEvent.click(await screen.findByRole('button', { name: /end cover now/i }));
    await waitFor(() => expect(api.endProjectCover).toHaveBeenCalledWith('p1'));
  });

  it('hands the project over only after a confirmation that names both people', async () => {
    api.getProjectCover.mockResolvedValue({ cover: null, canManage: true, canHandOver: true });
    api.reassignProjectOwner.mockResolvedValue({});
    wrap(<ProjectCoverCard projectId="p1" />);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Priya Nair' })).toBeTruthy());
    fireEvent.change(screen.getByLabelText('New Owner'), { target: { value: 'priya' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make Owner' }));
    expect(api.reassignProjectOwner).not.toHaveBeenCalled();
    expect(await screen.findByText(/Priya Nair becomes the Owner. Dana Reid becomes a Manager/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Make Owner' }).pop()!);
    await waitFor(() => expect(api.reassignProjectOwner).toHaveBeenCalledWith('p1', 'priya'));
  });
});

describe('ProjectCoverBanner', () => {
  const active = { cover: { id: 'c1', coverUserId: 'sam', coverUserName: 'Sam Okafor', startDate: '2026-11-02', endDate: '2026-11-12', active: true, ownerUserId: 'dana' }, canManage: false, canHandOver: false };

  it('tells everyone who is covering', async () => {
    api.getProjectCover.mockResolvedValue(active);
    wrap(<ProjectCoverBanner projectId="p1" acting={false} coverUntil={null} />);
    expect((await screen.findByRole('status')).textContent).toMatch(/Covered by Sam Okafor until/);
  });

  it('tells the cover person that they are covering, and what they cannot do', async () => {
    api.getProjectCover.mockResolvedValue(active);
    wrap(<ProjectCoverBanner projectId="p1" acting coverUntil="2026-11-12" />);
    expect((await screen.findByRole('status')).textContent).toMatch(/You are covering this project.*can't make or remove Owners/);
  });

  it('is absent when cover has not started or there is none', async () => {
    api.getProjectCover.mockResolvedValue({ ...active, cover: { ...active.cover, active: false } });
    const { container } = wrap(<ProjectCoverBanner projectId="p1" acting={false} coverUntil={null} />);
    await waitFor(() => expect(api.getProjectCover).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });
});
