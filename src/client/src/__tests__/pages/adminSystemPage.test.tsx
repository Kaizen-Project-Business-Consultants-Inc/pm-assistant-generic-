import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const api = vi.hoisted(() => ({ getAdminConfig: vi.fn() }));
vi.mock('../../services/api', () => ({ apiService: api }));
vi.mock('../../pages/admin/AdminPageWrapper', () => ({
  AdminPageWrapper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { AdminSystemPage } from '../../pages/admin/AdminSystemPage';
import { toCamelCaseKeys } from '../../../../server/utils/caseConverter';

/**
 * What GET /admin/config builds (routes/admin/admin.ts), passed through the same camelCasing the
 * server applies to every reply — the page once read `consultant_basic` and got undefined.
 */
function config(overrides: Record<string, unknown> = {}) {
  return toCamelCaseKeys({
    features: [],
    services: [],
    environment: {
      nodeVersion: 'v22', platform: 'linux', env: 'production', port: 3001, appUrl: 'https://kovarti.com',
      corsOrigin: '', logLevel: 'info', dbHost: 'localhost', dbName: 'pmassist', dbConnected: true,
      dbVersion: '11.8', dbPoolSize: 15, migrationCount: 136,
    },
    aiConfig: { model: 'm', fallbackModel: 'f', temperature: 0.3, maxTokens: 4096, monthlyTokenBudget: 1000000, pricingInput: 3, pricingOutput: 15 },
    agentConfig: {
      cronSchedule: '', delayThresholdDays: 3, budgetCpiThreshold: 0.9, budgetOverrunThreshold: 10,
      mcConfidenceLevel: 80, overdueScanMinutes: 15, totalAgents: 16, enabledAgents: 0,
    },
    storageConfig: { uploadDir: '/uploads', maxUploadSizeMB: 25 },
    tierBudgets: {
      trial: 10000, consultant_basic: 20000, consultant_pro: 30000, sme: 40000, smePerSeat: 50000, enterprise: 60000,
      topUpTokens: 70000, topUpPriceCents: 900,
    },
    ...overrides,
  });
}

/** The number shown on the card with this label */
function cardValue(label: string): string | null | undefined {
  return screen.getByText(label).parentElement?.parentElement?.lastElementChild?.textContent;
}

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AdminSystemPage /></QueryClientProvider>);
}

/** Admin → System (Oct 2026): the page crashed because it read the old plan names */
describe('Admin → System configuration', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('shows the AI budget for each current plan and the top-up', async () => {
    api.getAdminConfig.mockResolvedValue(config());
    show();
    await screen.findByText('Consultant Pro');
    const expected: Record<string, string> = {
      Trial: '10,000', 'Consultant Basic': '20,000', 'Consultant Pro': '30,000', 'SME (flat)': '40,000',
      'SME (per seat)': '50,000', Enterprise: '60,000', 'Top-up tokens': '70,000', 'Top-up price': '$9.00',
    };
    for (const [label, value] of Object.entries(expected)) expect(cardValue(label)).toBe(value);
  });

  it('a missing number shows a dash instead of crashing the page', async () => {
    api.getAdminConfig.mockResolvedValue(config({
      aiConfig: { model: 'm', fallbackModel: 'f', temperature: 0.3, pricingInput: 3, pricingOutput: 15 },
      tierBudgets: { trial: 10000 },
    }));
    show();
    expect(await screen.findByText('Trial')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(9);
  });
});
