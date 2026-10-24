import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * Admin AI cost screens (C1/C2, mock https://claude.ai/artifact/Jm71aXWc68EfH4sQ5LVjSC, approved 2026-10-23):
 * the per-company cost table and a company's own AI allowance.
 */
const api = vi.hoisted(() => ({ getAdminAiUsageByCompany: vi.fn(), updateAdminTenant: vi.fn() }));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../utils/announce', () => ({ announce: vi.fn() }));

import { CompanyCostView } from '../../components/admin/CompanyCostView';
import { CompanyAiAllowanceDialog, type AllowanceCompany } from '../../components/admin/CompanyAiAllowanceDialog';

const REPORT = {
  month: '2026-10',
  summary: { cost: 33.18, tokens: 6_310_529, calls: 3000, capUsd: 100 },
  companies: [
    { id: 'o1', name: 'George Bailoo Co.', plan: 'sme', billingModel: 'per_seat', seats: 3, tokens: 1_509_364, cost: 30.1, calls: 300, allowance: 1_500_000, allowanceSource: 'plan', planDefault: 1_500_000, percentUsed: 101, status: 'blocked', lastCall: '2026-10-23 18:40:16' },
    { id: 'o3', name: 'Solo Consulting', plan: 'consultant_pro', billingModel: 'flat', seats: 1, tokens: 900_000, cost: 5, calls: 20, allowance: 500_000, allowanceSource: 'per-person', planDefault: 500_000, percentUsed: 180, status: 'combined', lastCall: null },
    { id: 'o2', name: 'Quiet Co', plan: 'sme', billingModel: 'per_seat', seats: 1, tokens: 1000, cost: 0.02, calls: 2, allowance: 2_000_000, allowanceSource: 'company', planDefault: 500_000, percentUsed: 0, status: 'ok', lastCall: null },
  ],
  other: [{ bucket: 'background', label: 'Background jobs (no one asked)', tokens: 1000, cost: 0.5, calls: 4, lastCall: null }],
  features: [
    { feature: 'AutoRescheduleService', cost: 28.28, calls: 1967, today: 9.4, normal: 0.6, unusual: true },
    { feature: 'chat-tools', cost: 1.34, calls: 40, today: 1.3, normal: 1, unusual: false },
  ],
};

const wrap = (ui: React.ReactNode) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
};

afterEach(() => cleanup());

describe('Admin → AI usage → By company', () => {
  beforeEach(() => { api.getAdminAiUsageByCompany.mockResolvedValue(REPORT); });

  it('shows each company with its allowance, how much is used, and whether AI is paused', async () => {
    wrap(<CompanyCostView />);
    expect(await screen.findByText('George Bailoo Co.')).toBeInTheDocument();
    const row = screen.getByText('George Bailoo Co.').closest('tr')!;
    expect(row).toHaveTextContent('1,509,364');
    expect(row).toHaveTextContent('1,500,000');
    expect(row).toHaveTextContent('Plan default');
    expect(row).toHaveTextContent('101%');
    expect(row).toHaveTextContent('AI paused');
    expect(row).toHaveTextContent('sme · 3 seats');
    // the owner's own number is labelled as such
    expect(screen.getByText('Quiet Co').closest('tr')).toHaveTextContent('Your setting');
    // a company billed per person: no company-wide verdict, and the note that top-ups are not counted
    const solo = screen.getByText('Solo Consulting').closest('tr')!;
    expect(solo).toHaveTextContent('Per person');
    expect(solo).not.toHaveTextContent('AI paused');
    expect(solo).toHaveTextContent('top-ups not included');
    // usage that belongs to no company is listed, without an allowance
    expect(screen.getByText('Background jobs (no one asked)')).toBeInTheDocument();
  });

  it('shows the month against the account limit and flags a feature far above its normal day', async () => {
    wrap(<CompanyCostView />);
    await screen.findByText('George Bailoo Co.');
    expect(screen.getByText(/33% of the \$100 account limit/)).toBeInTheDocument();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('AutoRescheduleService');
    expect(alert).toHaveTextContent('normal $0.60');
    expect(screen.getAllByText('Far above a normal day').length).toBeGreaterThan(0);
  });

  it('every used-% bar has a text name for screen readers', async () => {
    wrap(<CompanyCostView />);
    await screen.findByText('George Bailoo Co.');
    expect(screen.getByRole('progressbar', { name: 'George Bailoo Co. has used 101% of its allowance' })).toHaveAttribute('aria-valuenow', '100');
  });
});

describe('Company AI allowance dialog', () => {
  const company = (extra: Partial<AllowanceCompany> = {}): AllowanceCompany => ({
    id: 'o1', name: 'George Bailoo Co.', billingModel: 'per_seat', seatCount: 3, subscriptionTier: 'sme',
    aiAllowanceOverride: null, aiAllowanceOverrideAt: null, aiAllowanceOverrideByName: null, ...extra,
  });
  beforeEach(() => { api.updateAdminTenant.mockReset().mockResolvedValue({}); api.getAdminAiUsageByCompany.mockResolvedValue(REPORT); });

  it('explains the plan default (per seat × seats) and this month\'s use', async () => {
    wrap(<CompanyAiAllowanceDialog company={company()} onClose={() => {}} />);
    expect(await screen.findByText(/500,000 per seat × 3 seats/)).toBeInTheDocument();
    expect(screen.getByText(/Used this month:/)).toHaveTextContent('1,509,364');
  });

  it('saves a number (commas and spaces allowed), a blank puts the plan default back', async () => {
    const onClose = vi.fn();
    wrap(<CompanyAiAllowanceDialog company={company({ aiAllowanceOverride: 3_000_000, aiAllowanceOverrideAt: '2026-10-23 19:00:00', aiAllowanceOverrideByName: 'Michael' })} onClose={onClose} />);
    const field = screen.getByLabelText(/AI allowance for this company/);
    expect(field).toHaveValue('3000000');
    expect(screen.getByText(/set by Michael on/)).toBeInTheDocument();

    fireEvent.change(field, { target: { value: '4,000,000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateAdminTenant).toHaveBeenCalledWith('o1', { aiAllowanceOverride: 4_000_000 }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateAdminTenant).toHaveBeenLastCalledWith('o1', { aiAllowanceOverride: null }));
  });

  it('"Reset to plan default" sends null; something that is not a number is refused with a plain message', async () => {
    wrap(<CompanyAiAllowanceDialog company={company({ aiAllowanceOverride: 3_000_000, aiAllowanceOverrideAt: '2026-10-23 19:00:00' })} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/AI allowance for this company/), { target: { value: 'lots' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/whole number of tokens/);
    expect(api.updateAdminTenant).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reset to plan default' }));
    await waitFor(() => expect(api.updateAdminTenant).toHaveBeenCalledWith('o1', { aiAllowanceOverride: null }));
  });

  it('0 turns AI off, so it asks for a second Save and says so in plain words', async () => {
    wrap(<CompanyAiAllowanceDialog company={company()} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/AI allowance for this company/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/0 turns AI off for this company/);
    expect(api.updateAdminTenant).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateAdminTenant).toHaveBeenCalledWith('o1', { aiAllowanceOverride: 0 }));
  });

  it('a company billed per person has no field: each person has their own allowance', () => {
    wrap(<CompanyAiAllowanceDialog company={company({ billingModel: 'flat', seatCount: 1 })} onClose={() => {}} />);
    expect(screen.getByText(/billed per person/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/AI allowance for this company/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('shows the server\'s refusal', async () => {
    api.updateAdminTenant.mockRejectedValueOnce({ response: { data: { message: 'Only a per-seat company shares one AI allowance.' } } });
    wrap(<CompanyAiAllowanceDialog company={company()} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/AI allowance for this company/), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/Only a per-seat company/);
  });
});
