import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A sign-up the database was too busy to finish (2026-10-12): the account used to be kept without
 * a company — a dead end, and "an account with this email already exists" on the retry. Now the
 * whole sign-up is undone and the answer is 503 "busy, try again" (form and Google alike). Other
 * company-creation errors keep the old behaviour (account kept, error logged).
 */
const BUSY = () => new Error('Queue limit reached.');
vi.mock('../../utils/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('../../config', () => ({ config: { MULTI_TENANT_ENABLED: true } }));
vi.mock('../../services/UserService', () => ({
  userService: {
    findByUsername: vi.fn(async () => null),
    findByEmail: vi.fn(async () => null),
    create: vi.fn(async (u: any) => ({ ...u, id: 'u-new' })),
    update: vi.fn(async () => ({})),
    delete: vi.fn(async () => true),
  },
}));
vi.mock('../../services/StripeService', () => ({ stripeService: { createCustomer: vi.fn(async () => null) } }));
vi.mock('../../services/OrganizationService', () => ({
  organizationService: {
    createOrganization: vi.fn(async () => ({ id: 'org-new' })),
    getAllActiveProvisioned: vi.fn(async () => []),
  },
}));
vi.mock('../../services/InviteService', () => ({
  inviteService: { validateToken: vi.fn(async () => ({ valid: true, orgName: 'Acme' })), acceptInvite: vi.fn(async () => ({})) },
}));
vi.mock('../../services/PricingConfigService', () => ({ pricingConfigService: { trialLengthDays: vi.fn(async () => 7) } }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: { deleteUnbuiltOwnedBy: vi.fn(async () => {}) } }));
vi.mock('../../database/InviteTokenRepository', () => ({ inviteTokenRepository: { reopenAcceptedBy: vi.fn(async () => {}) } }));
vi.mock('../../database/connection', () => ({ databaseService: { query: vi.fn(async () => []) } }));
vi.mock('../../database/tenantProvisioner', () => ({ provisionTenantDatabase: vi.fn() }));
vi.mock('../../middleware/requestContext', () => ({ runWithTenantContext: vi.fn() }));
vi.mock('../../utils/stripePrices', () => ({ resolvePriceId: vi.fn() }));

import { createAccount } from '../../services/accountSignup';
import { userService } from '../../services/UserService';
import { organizationService } from '../../services/OrganizationService';
import { organizationRepository } from '../../database/OrganizationRepository';
import { inviteService } from '../../services/InviteService';
import { inviteTokenRepository } from '../../database/InviteTokenRepository';

const signUp = (over: object = {}) => createAccount({ email: 'jane@example.com', fullName: 'Jane', passwordHash: 'h', emailVerified: false, ...over });

describe('sign-up when the database is too busy to finish', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('company could not be made: the account is removed and the answer is "busy, try again"', async () => {
    vi.mocked(organizationService.createOrganization).mockRejectedValueOnce(BUSY());
    const res = await signUp();
    expect(res).toMatchObject({ ok: false, status: 503, error: 'Service busy' });
    expect(res.ok === false && res.message).toMatch(/busy/);
    expect(userService.delete).toHaveBeenCalledWith('u-new');
    // a company row may have been written before the failure: any unbuilt one of theirs goes too
    expect(organizationRepository.deleteUnbuiltOwnedBy).toHaveBeenCalledWith('u-new');
    expect(organizationService.getAllActiveProvisioned).not.toHaveBeenCalled(); // nothing linked to an undone account
  });

  it('company made, but joining it failed: both are removed', async () => {
    vi.mocked(userService.update)
      .mockResolvedValueOnce({} as never) // trial dates
      .mockRejectedValueOnce(BUSY()); // organizationId
    const res = await signUp();
    expect(res).toMatchObject({ ok: false, status: 503 });
    expect(organizationRepository.deleteUnbuiltOwnedBy).toHaveBeenCalledWith('u-new');
    expect(userService.delete).toHaveBeenCalledWith('u-new');
  });

  it('an invitation that could not be accepted (busy): undone too', async () => {
    vi.mocked(inviteService.acceptInvite).mockRejectedValueOnce(BUSY());
    const res = await signUp({ inviteToken: 'inv' });
    expect(res).toMatchObject({ ok: false, status: 503 });
    expect(userService.delete).toHaveBeenCalledWith('u-new');
    // the invitation may already be marked used: it is reopened, so the retry works
    expect(inviteTokenRepository.reopenAcceptedBy).toHaveBeenCalledWith('u-new');
  });

  it('a company error that is not "busy" keeps the old behaviour: the account stays', async () => {
    vi.mocked(organizationService.createOrganization).mockRejectedValueOnce(new Error('slug clash'));
    const res = await signUp();
    expect(res.ok).toBe(true);
    expect(userService.delete).not.toHaveBeenCalled();
  });

  it('a normal sign-up is unchanged: account, company, memberships linked', async () => {
    const res = await signUp();
    expect(res.ok).toBe(true);
    expect(organizationService.createOrganization).toHaveBeenCalledOnce();
    expect(organizationService.getAllActiveProvisioned).toHaveBeenCalledOnce();
    expect(userService.delete).not.toHaveBeenCalled();
  });
});
