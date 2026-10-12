import { describe, it, expect, vi, beforeEach } from 'vitest';

/** hasFeature gives the same answer requireFeature enforces (used to hide "Analyse with AI", 2026-10-11) */
const users = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../services/UserService', () => ({ userService: users }));
const pricing = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('../../services/PricingConfigService', () => ({ pricingConfigService: pricing }));
const orgs = vi.hoisted(() => ({ findByUserId: vi.fn() }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: orgs }));

import { hasFeature, requireFeature, requireTier } from '../../middleware/requireTier';

const req = (user: any) => ({ user }) as any;

describe('hasFeature / requireFeature', () => {
  beforeEach(() => { vi.clearAllMocks(); users.findById.mockResolvedValue({ subscriptionTier: 'consultant_basic', subscriptionStatus: 'active', trialEndsAt: null }); });

  it('plan without the feature: hasFeature false, requireFeature refuses with the upgrade message', async () => {
    pricing.isFeatureEnabled.mockResolvedValue(false);
    expect(await hasFeature(req({ userId: 'u1', role: 'project_manager' }), 'ai_assistant')).toBe(false);
    await expect(requireFeature('ai_assistant')(req({ userId: 'u1', role: 'project_manager' }), {} as any)).rejects.toThrow(/paid plans/);
    expect(pricing.isFeatureEnabled).toHaveBeenCalledWith('consultant_basic', 'ai_assistant');
  });

  it('plan with the feature: both say yes', async () => {
    pricing.isFeatureEnabled.mockResolvedValue(true);
    expect(await hasFeature(req({ userId: 'u1', role: 'project_manager' }), 'ai_assistant')).toBe(true);
    await expect(requireFeature('ai_assistant')(req({ userId: 'u1', role: 'project_manager' }), {} as any)).resolves.toBeUndefined();
  });

  it('no such user: hasFeature false, requireFeature asks to sign in', async () => {
    users.findById.mockResolvedValue(null);
    expect(await hasFeature(req({ userId: 'gone', role: 'project_manager' }), 'ai_assistant')).toBe(false);
    await expect(requireFeature('ai_assistant')(req({ userId: 'gone', role: 'project_manager' }), {} as any)).rejects.toThrow(/Authentication required/);
  });

  it('a viewer is judged by the company plan, not the trial plan on their own record', async () => {
    users.findById.mockResolvedValue({ subscriptionTier: 'trial', subscriptionStatus: 'none', trialEndsAt: null });
    orgs.findByUserId.mockResolvedValue({ subscriptionTier: 'consultant_basic', subscriptionStatus: 'active', trialEndsAt: null });
    pricing.isFeatureEnabled.mockImplementation(async (tier: string) => tier !== 'consultant_basic');
    const viewer = req({ userId: 'v1', role: 'viewer' });
    expect(await hasFeature(viewer, 'ai_assistant')).toBe(false);
    await expect(requireFeature('ai_assistant')(viewer, {} as any)).rejects.toThrow(/paid plans/);
    orgs.findByUserId.mockResolvedValue({ subscriptionTier: 'consultant_pro', subscriptionStatus: 'active', trialEndsAt: null });
    expect(await hasFeature(viewer, 'ai_assistant')).toBe(true);
    expect(pricing.isFeatureEnabled).toHaveBeenLastCalledWith('consultant_pro', 'ai_assistant');
  });

  it('a viewer with no company has no plan (orphan record); a paying member is not looked up again', async () => {
    users.findById.mockResolvedValue({ subscriptionTier: 'trial', subscriptionStatus: 'none', trialEndsAt: null });
    orgs.findByUserId.mockResolvedValue(null);
    pricing.isFeatureEnabled.mockResolvedValue(true);
    expect(await hasFeature(req({ userId: 'v2', role: 'viewer' }), 'ai_assistant')).toBe(false);
    orgs.findByUserId.mockClear();
    users.findById.mockResolvedValue({ subscriptionTier: 'consultant_pro', subscriptionStatus: 'active', trialEndsAt: null });
    await hasFeature(req({ userId: 'u1', role: 'project_manager' }), 'ai_assistant');
    expect(orgs.findByUserId).not.toHaveBeenCalled();
  });

  it('an ended trial or cancelled plan has no paid features; the company covers a member whose own record lags', async () => {
    pricing.isFeatureEnabled.mockResolvedValue(true);
    const pm = req({ userId: 'u1', role: 'project_manager' });
    users.findById.mockResolvedValue({ subscriptionTier: 'trial', subscriptionStatus: 'trialing', trialEndsAt: '2026-01-01 00:00:00' });
    orgs.findByUserId.mockResolvedValue(null);
    expect(await hasFeature(pm, 'resources')).toBe(false);
    users.findById.mockResolvedValue({ subscriptionTier: 'consultant_pro', subscriptionStatus: 'canceled', trialEndsAt: null });
    expect(await hasFeature(pm, 'resources')).toBe(false);
    // a team member invited after payment: own record 'none', the company pays
    users.findById.mockResolvedValue({ subscriptionTier: 'trial', subscriptionStatus: 'none', trialEndsAt: null });
    orgs.findByUserId.mockResolvedValue({ subscriptionTier: 'sme', subscriptionStatus: 'active', trialEndsAt: null });
    expect(await hasFeature(pm, 'resources')).toBe(true);
    // a viewer in a cancelled company
    orgs.findByUserId.mockResolvedValue({ subscriptionTier: 'trial', subscriptionStatus: 'canceled', trialEndsAt: null });
    expect(await hasFeature(req({ userId: 'v1', role: 'viewer' }), 'resources')).toBe(false);
  });

  it('requireTier: only the listed plans while in force; viewers go by the company', async () => {
    const gate = requireTier('consultant_pro', 'sme', 'enterprise');
    const pm = req({ userId: 'u1', role: 'project_manager' });
    const viewer = req({ userId: 'v1', role: 'viewer' });
    users.findById.mockResolvedValue({ subscriptionTier: 'consultant_pro', subscriptionStatus: 'active', trialEndsAt: null });
    await expect(gate(pm, {} as any)).resolves.toBeUndefined();
    users.findById.mockResolvedValue({ subscriptionTier: 'trial', subscriptionStatus: 'trialing', trialEndsAt: '2099-01-01 00:00:00' });
    await expect(gate(pm, {} as any)).rejects.toThrow(/paid plans/); // connectors are not on the trial (document limit 0)
    users.findById.mockResolvedValue({ subscriptionTier: 'consultant_basic', subscriptionStatus: 'active', trialEndsAt: null });
    await expect(gate(pm, {} as any)).rejects.toThrow(/paid plans/);
    users.findById.mockResolvedValue({ subscriptionTier: 'trial', subscriptionStatus: 'none', trialEndsAt: null });
    orgs.findByUserId.mockResolvedValue({ subscriptionTier: 'consultant_basic', subscriptionStatus: 'active', trialEndsAt: null });
    await expect(gate(viewer, {} as any)).rejects.toThrow(/paid plans/);
    orgs.findByUserId.mockResolvedValue({ subscriptionTier: 'enterprise', subscriptionStatus: 'active', trialEndsAt: null });
    await expect(gate(viewer, {} as any)).resolves.toBeUndefined();
    users.findById.mockResolvedValue({ subscriptionTier: 'consultant_pro', subscriptionStatus: 'canceled', trialEndsAt: null });
    orgs.findByUserId.mockResolvedValue(null);
    await expect(gate(pm, {} as any)).rejects.toThrow(/has ended/);
    await expect(gate(req({ userId: 'a1', role: 'admin' }), {} as any)).resolves.toBeUndefined();
  });

  it("a consultant's client viewer: the company plan is the owner's record on flat billing (the org row keeps its sign-up values)", async () => {
    pricing.isFeatureEnabled.mockResolvedValue(true);
    users.findById.mockImplementation(async (id: string) => id === 'owner1'
      ? { subscriptionTier: 'consultant_pro', subscriptionStatus: 'active', trialEndsAt: null }
      : { subscriptionTier: 'trial', subscriptionStatus: 'none', trialEndsAt: null });
    orgs.findByUserId.mockResolvedValue({ ownerUserId: 'owner1', billingModel: 'flat', subscriptionTier: 'trial', subscriptionStatus: 'trialing', trialEndsAt: '2026-01-01 00:00:00' });
    expect(await hasFeature(req({ userId: 'v1', role: 'viewer' }), 'resources')).toBe(true);
    expect(pricing.isFeatureEnabled).toHaveBeenLastCalledWith('consultant_pro', 'resources');
    // the owner cancels: their client viewers lose the paid features too
    users.findById.mockImplementation(async (id: string) => id === 'owner1'
      ? { subscriptionTier: 'consultant_pro', subscriptionStatus: 'canceled', trialEndsAt: null }
      : { subscriptionTier: 'trial', subscriptionStatus: 'none', trialEndsAt: null });
    expect(await hasFeature(req({ userId: 'v1', role: 'viewer' }), 'resources')).toBe(false);
    users.findById.mockReset();
  });

  it('per-seat billing: the organisation row is the plan', async () => {
    pricing.isFeatureEnabled.mockResolvedValue(true);
    users.findById.mockResolvedValue({ subscriptionTier: 'trial', subscriptionStatus: 'none', trialEndsAt: null });
    orgs.findByUserId.mockResolvedValue({ ownerUserId: 'owner1', billingModel: 'per_seat', subscriptionTier: 'sme', subscriptionStatus: 'active', trialEndsAt: null });
    expect(await hasFeature(req({ userId: 'm1', role: 'team_member' }), 'resources')).toBe(true);
  });

  it('awaiting payment gets nothing even if the company pays; the owner never falls back on the company row', async () => {
    pricing.isFeatureEnabled.mockResolvedValue(true);
    users.findById.mockResolvedValue({ subscriptionTier: 'trial', subscriptionStatus: 'incomplete', trialEndsAt: null });
    orgs.findByUserId.mockResolvedValue({ ownerUserId: 'owner1', billingModel: 'per_seat', subscriptionTier: 'sme', subscriptionStatus: 'active', trialEndsAt: null });
    expect(await hasFeature(req({ userId: 'm1', role: 'project_manager' }), 'resources')).toBe(false);
    users.findById.mockResolvedValue({ subscriptionTier: 'consultant_pro', subscriptionStatus: 'canceled', trialEndsAt: null });
    orgs.findByUserId.mockResolvedValue({ ownerUserId: 'owner1', billingModel: 'per_seat', subscriptionTier: 'sme', subscriptionStatus: 'active', trialEndsAt: null });
    expect(await hasFeature(req({ userId: 'owner1', role: 'project_manager' }), 'resources')).toBe(false);
  });

  it("an ended plan is told so, not that it's a paid-plan feature; the admin's support visit is not on a plan", async () => {
    pricing.isFeatureEnabled.mockResolvedValue(true);
    users.findById.mockResolvedValue({ subscriptionTier: 'trial', subscriptionStatus: 'trialing', trialEndsAt: '2026-01-01 00:00:00' });
    orgs.findByUserId.mockResolvedValue(null);
    await expect(requireFeature('resources')(req({ userId: 'u1', role: 'project_manager' }), {} as any)).rejects.toThrow(/has ended/);
    const visit = { user: { userId: 'admin1', role: 'executive' }, supportSession: { organizationId: 'o1' } } as any;
    users.findById.mockResolvedValue({ subscriptionTier: 'trial', subscriptionStatus: 'none', trialEndsAt: null });
    expect(await hasFeature(visit, 'resources')).toBe(true);
  });
});
