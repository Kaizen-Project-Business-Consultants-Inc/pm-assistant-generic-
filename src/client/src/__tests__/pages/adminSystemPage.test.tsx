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

/** The shape GET /admin/config returns (routes/admin/admin.ts) */
function config(overrides: Record<string, unknown> = {}) {
  return {
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
      trial: 50000, consultant_basic: 0, consultant_pro: 500000, sme: 1500000, smePerSeat: 500000, enterprise: 5000000,
      topUpTokens: 250000, topUpPriceCents: 900,
    },
    ...overrides,
  };
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
    expect(await screen.findByText('Consultant Pro')).toBeTruthy();
    for (const label of ['Trial', 'Consultant Basic', 'SME (flat)', 'SME (per seat)', 'Enterprise', 'Top-up tokens']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByText((500000).toLocaleString()).length).toBe(2);
    expect(screen.getByText('$9.00')).toBeTruthy();
  });

  it('a missing number shows a dash instead of crashing the page', async () => {
    api.getAdminConfig.mockResolvedValue(config({
      aiConfig: { model: 'm', fallbackModel: 'f', temperature: 0.3, pricingInput: 3, pricingOutput: 15 },
      tierBudgets: { trial: 50000 },
    }));
    show();
    expect(await screen.findByText('Trial')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(9);
  });
});
