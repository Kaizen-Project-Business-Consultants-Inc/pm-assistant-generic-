import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config', () => ({
  config: { APP_URL: 'https://pm.kpbc.ca' },
}));

vi.mock('../../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../database/OrganizationRepository', () => ({
  organizationRepository: { findByUserId: vi.fn() },
}));

vi.mock('../../database/PortalRepository', () => ({
  portalRepository: { findLinksByProject: vi.fn() },
}));

import { clientReportContext } from '../../utils/clientReportContext';
import { organizationRepository } from '../../database/OrganizationRepository';
import { portalRepository } from '../../database/PortalRepository';

const orgRepo = organizationRepository as unknown as { findByUserId: ReturnType<typeof vi.fn> };
const portalRepo = portalRepository as unknown as { findLinksByProject: ReturnType<typeof vi.fn> };

function link(over: Partial<Record<string, any>> = {}) {
  return {
    id: 'l1', projectId: 'p1', token: 'tok-1', label: null, permissions: {},
    expiresAt: null, isActive: true, createdBy: 'u1', createdAt: '2026-01-01',
    ...over,
  };
}

describe('what a report needs before it leaves for a client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    orgRepo.findByUserId.mockResolvedValue({ id: 'o1', name: 'Kaizen Consultants' });
    portalRepo.findLinksByProject.mockResolvedValue([]);
  });

  it('names the consultancy, so the client sees who it is from', async () => {
    const ctx = await clientReportContext('p1', 'u1');
    expect(ctx.senderName).toBe('Kaizen Consultants');
  });

  it('offers a portal link the client can open without an account', async () => {
    portalRepo.findLinksByProject.mockResolvedValue([link({ token: 'abc123' })]);

    const ctx = await clientReportContext('p1', 'u1');

    expect(ctx.portalUrl).toBe('https://pm.kpbc.ca/portal/abc123');
  });

  it('refuses an expired link — a dead link is worse than none', async () => {
    portalRepo.findLinksByProject.mockResolvedValue([
      link({ token: 'stale', expiresAt: '2020-01-01T00:00:00Z' }),
    ]);

    const ctx = await clientReportContext('p1', 'u1');

    expect(ctx.portalUrl).toBeUndefined();
  });

  it('refuses a disabled link', async () => {
    portalRepo.findLinksByProject.mockResolvedValue([link({ isActive: false })]);

    const ctx = await clientReportContext('p1', 'u1');

    expect(ctx.portalUrl).toBeUndefined();
  });

  it('picks the first link that still works, skipping ones that do not', async () => {
    portalRepo.findLinksByProject.mockResolvedValue([
      link({ token: 'revoked', isActive: false }),
      link({ token: 'good', expiresAt: '2099-01-01T00:00:00Z' }),
    ]);

    const ctx = await clientReportContext('p1', 'u1');

    expect(ctx.portalUrl).toContain('good');
  });

  it('still lets the report go out when the lookups fail', async () => {
    // A missing sender name is a far smaller problem than an unsent report.
    orgRepo.findByUserId.mockRejectedValue(new Error('control plane down'));
    portalRepo.findLinksByProject.mockRejectedValue(new Error('tenant down'));

    const ctx = await clientReportContext('p1', 'u1');

    expect(ctx).toEqual({});
  });
});
