import { describe, it, expect, vi, beforeEach } from 'vitest';

/** hasFeature gives the same answer requireFeature enforces (used to hide "Analyse with AI", 2026-10-11) */
const users = vi.hoisted(() => ({ findById: vi.fn() }));
vi.mock('../../services/UserService', () => ({ userService: users }));
const pricing = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('../../services/PricingConfigService', () => ({ pricingConfigService: pricing }));
const orgs = vi.hoisted(() => ({ findByUserId: vi.fn() }));
vi.mock('../../database/OrganizationRepository', () => ({ organizationRepository: orgs }));

import { hasFeature, requireFeature } from '../../middleware/requireTier';

const req = (user: any) => ({ user }) as any;

describe('hasFeature / requireFeature', () => {
  beforeEach(() => { vi.clearAllMocks(); users.findById.mockResolvedValue({ subscriptionTier: 'consultant_basic' }); });

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
    users.findById.mockResolvedValue({ subscriptionTier: 'trial' });
    orgs.findByUserId.mockResolvedValue({ subscriptionTier: 'consultant_basic' });
    pricing.isFeatureEnabled.mockImplementation(async (tier: string) => tier !== 'consultant_basic');
    const viewer = req({ userId: 'v1', role: 'viewer' });
    expect(await hasFeature(viewer, 'ai_assistant')).toBe(false);
    await expect(requireFeature('ai_assistant')(viewer, {} as any)).rejects.toThrow(/paid plans/);
    orgs.findByUserId.mockResolvedValue({ subscriptionTier: 'consultant_pro' });
    expect(await hasFeature(viewer, 'ai_assistant')).toBe(true);
    expect(pricing.isFeatureEnabled).toHaveBeenLastCalledWith('consultant_pro', 'ai_assistant');
  });

  it('a viewer with no company falls back to their own plan; other roles never look up the company', async () => {
    users.findById.mockResolvedValue({ subscriptionTier: 'trial' });
    orgs.findByUserId.mockResolvedValue(null);
    pricing.isFeatureEnabled.mockResolvedValue(true);
    expect(await hasFeature(req({ userId: 'v2', role: 'viewer' }), 'ai_assistant')).toBe(true);
    expect(pricing.isFeatureEnabled).toHaveBeenLastCalledWith('trial', 'ai_assistant');
    orgs.findByUserId.mockClear();
    await hasFeature(req({ userId: 'u1', role: 'project_manager' }), 'ai_assistant');
    expect(orgs.findByUserId).not.toHaveBeenCalled();
  });
});
