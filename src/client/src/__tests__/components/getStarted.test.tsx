import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * First login (U42/U47/U48, approved mock 2026-10-19): the dashboard's Get started card with its
 * four steps in the user's order, the invite dialog (Free / Paid seat, what it does to the bill),
 * "Who's on it?", and an invited person's name check.
 */
const api = vi.hoisted(() => ({
  getGetStarted: vi.fn(),
  getSeatInfo: vi.fn(async () => ({ usedSeats: 1, paidSeats: 3, availableSeats: 2, billingModel: 'per_seat', seatPriceCents: 1900 })),
  inviteOrgMember: vi.fn(async () => ({ status: 'created' })),
  getOrgMembers: vi.fn(),
  addProjectMember: vi.fn(async () => ({})),
  updateProfile: vi.fn(async () => ({})),
  getNotificationPreferences: vi.fn(async () => ({ user: { timezone: 'UTC' } })),
}));
vi.mock('../../services/api', () => ({ apiService: api }));

import { useAuthStore } from '../../stores/authStore';
import { GetStartedCard } from '../../components/getStarted/GetStartedCard';
import { ChooseTeamDialog } from '../../components/getStarted/ChooseTeamDialog';
import { ConfirmYourName } from '../../components/getStarted/ConfirmYourName';

const owner = {
  id: 'u1', username: 'george', email: 'george@acme.test', fullName: 'George Bailoo', role: 'pmo', accountRole: 'project_manager',
  onboardingCompleted: false, organization: { id: 'o1', name: 'George Bailoo Co.', slug: 'gb', isOwner: true },
};
const nothingDone = { canInvite: true, invited: false, firstProjectId: null, projectHasPeople: false, projectHasTasks: false };

function show(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/dashboard" element={ui} />
          <Route path="/projects" element={<p>Projects page</p>} />
          <Route path="/project/:id" element={<p>Project page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Get started card', () => {
  beforeEach(() => { vi.clearAllMocks(); useAuthStore.setState({ user: owner } as never); });
  afterEach(cleanup);

  it('a new Team-plan owner sees the four steps in order; step 1 is next', async () => {
    api.getGetStarted.mockResolvedValue(nothingDone);
    show(<GetStartedCard />);
    const steps = await screen.findAllByRole('listitem');
    const titles = steps.map(li => li.querySelector('p')?.textContent);
    expect(titles.slice(0, 4)).toEqual(['Invite your people', 'Create your first project', 'Choose who’s on it', 'Build the plan']);
    expect(within(steps[0]).getByRole('button', { name: 'Invite' })).toBeTruthy();
    expect(within(steps[2]).queryByRole('button')).toBeNull(); // waits for the project
    expect(screen.getByRole('heading', { name: /Let’s get George Bailoo Co\. working/ })).toBeTruthy();
  });

  it('without the invite step (not a Team-plan owner), creating the project is first; done steps are ticked', async () => {
    api.getGetStarted.mockResolvedValue({ ...nothingDone, canInvite: false, firstProjectId: 'p1' });
    show(<GetStartedCard />);
    expect(await screen.findByText('Create your first project')).toBeTruthy();
    expect(screen.queryByText('Invite your people')).toBeNull();
    expect(screen.getByText('(done)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Choose' }));
    expect(await screen.findByText('Project page')).toBeTruthy();
  });

  it('Create goes to New Project', async () => {
    api.getGetStarted.mockResolvedValue(nothingDone);
    show(<GetStartedCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Projects page')).toBeTruthy();
  });

  it('"Hide this card" finishes setup and the card goes', async () => {
    api.getGetStarted.mockResolvedValue(nothingDone);
    show(<GetStartedCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hide this card' }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ completeOnboarding: true }));
    await waitFor(() => expect(screen.queryByText('Invite your people')).toBeNull());
  });

  it('nobody who finished setup, no viewer and no guest sees it', async () => {
    api.getGetStarted.mockResolvedValue(nothingDone);
    for (const u of [{ ...owner, onboardingCompleted: true }, { ...owner, role: 'viewer' }, { ...owner, isGuest: true }]) {
      useAuthStore.setState({ user: u } as never);
      const { unmount } = show(<GetStartedCard />);
      await new Promise(r => { setTimeout(r, 0); });
      expect(screen.queryByText('Invite your people')).toBeNull();
      unmount();
    }
    expect(api.getGetStarted).not.toHaveBeenCalled();
  });

  it('the invite dialog marks Free and Paid seat and says what it does to the bill', async () => {
    api.getGetStarted.mockResolvedValue(nothingDone);
    show(<GetStartedCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Invite' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'priya@acme.test' } });
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Priya Shah' } });
    expect(within(dialog).getByText('Paid seat')).toBeTruthy();
    expect(await within(dialog).findByText(/You have 3 seats and use 1\. These invites fit in your seats/)).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText('Access'), { target: { value: 'viewer' } });
    expect(within(dialog).getByText('Free')).toBeTruthy();
    expect(within(dialog).getByText(/Viewers are free, so your bill doesn't change/)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Send 1 invite' }));
    await waitFor(() => expect(api.inviteOrgMember).toHaveBeenCalledWith('priya@acme.test', 'viewer', 'Priya Shah'));
  });

  it('more paid invites than free seats: the extra cost is shown', async () => {
    api.getSeatInfo.mockResolvedValueOnce({ usedSeats: 3, paidSeats: 3, availableSeats: 0, billingModel: 'per_seat', seatPriceCents: 1900 });
    api.getGetStarted.mockResolvedValue(nothingDone);
    show(<GetStartedCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Invite' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: 'tom@acme.test' } });
    expect(await within(dialog).findByText(/These invites add 1 seat: \$19 more a month/)).toBeTruthy();
  });
});

describe("Who's on it?", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: owner } as never);
    api.getOrgMembers.mockResolvedValue({ members: [
      { id: 'u1', email: 'george@acme.test', fullName: 'George Bailoo', role: 'project_manager', isActive: true },
      { id: 'u2', email: 'priya@acme.test', fullName: 'Priya Shah', role: 'project_manager', isActive: true },
      { id: 'u3', email: 'cfo@acme.test', fullName: 'Ana Lopes', role: 'viewer', isActive: true },
    ] });
  });
  afterEach(cleanup);

  it('lists the company (not you): others ticked as Manager, company Viewers unticked; Add adds the ticked', async () => {
    const onClose = vi.fn();
    show(<ChooseTeamDialog projectId="p1" projectName="DBJ-LMS" isOpen onClose={onClose} />);
    expect(await screen.findByRole('heading', { name: "Who's on DBJ-LMS?" })).toBeTruthy();
    expect(screen.queryByText('George Bailoo')).toBeNull();
    expect((screen.getByRole('checkbox', { name: /Priya Shah/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: /Ana Lopes/ }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Add 1 person' }));
    await waitFor(() => expect(api.addProjectMember).toHaveBeenCalledWith('p1', { userId: 'u2', userName: 'Priya Shah', email: 'priya@acme.test', role: 'manager' }));
    expect(api.addProjectMember).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('opened by itself after creating a project, it stays closed when nobody else is in the company', async () => {
    api.getOrgMembers.mockResolvedValue({ members: [{ id: 'u1', email: 'george@acme.test', fullName: 'George', role: 'pmo', isActive: true }] });
    const onClose = vi.fn();
    show(<ChooseTeamDialog projectId="p1" projectName="X" isOpen quietIfNobody onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('an invited person checks their name', () => {
  beforeEach(() => { vi.clearAllMocks(); useAuthStore.setState({ user: { ...owner, fullName: 'priya', organization: { ...owner.organization, isOwner: false } } } as never); });
  afterEach(cleanup);

  it('"Yes" goes on; "Change it" saves the new name, then goes on', async () => {
    const onDone = vi.fn();
    show(<ConfirmYourName onDone={onDone} />);
    expect(screen.getByRole('heading', { name: "You've joined George Bailoo Co." })).toBeTruthy();
    expect(screen.getByText('priya')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change it' }));
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Priya Shah' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and continue' }));
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalledWith({ fullName: 'Priya Shah' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(useAuthStore.getState().user?.fullName).toBe('Priya Shah');
  });
});
